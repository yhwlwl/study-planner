import { addDays, format } from 'date-fns'
import type {
  AppSettings, AppState, Assignment, CalendarConstraint, Goal, GoalCondition, IntakeBatch, IntakeTaskGroupDraft,
  TaskActivityType, TaskGroup,
} from '../types'
import { SCHEMA_VERSION } from '../types'
import { dateRange, shiftDate, todayISO } from './date'
import { uid } from './id'
import { updateGoalAndGroupLifecycle } from './goals'
import { safeExecutionDate } from './execution'

const DEFAULT_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '其他']

function inferActivity(subject: TaskGroup['subject'], title: string): TaskActivityType {
  const text = `${subject}${title}`
  if (subject === '语文' && /默写|听写/.test(text)) return 'classical-dictation'
  if (/背诵|默背/.test(text)) return 'recitation'
  if (subject === '语文' && /文言文|古文|古诗文/.test(text)) return 'classical-study'
  if (subject === '化学' && /预习|微课/.test(text)) return 'chem-preview'
  if (subject === '数学' && /套卷|试卷|周练|真题|模拟卷/.test(text)) return 'math-paper'
  return 'normal'
}

export function defaultSettings(input: Partial<AppSettings> = {}): AppSettings {
  const start = todayISO()
  const defaults: AppSettings = {
    planName: '学习计划',
    startDate: start,
    endDate: shiftDate(start, 30),
    coreTargetDate: shiftDate(start, 14),
    chemistryTargetDate: shiftDate(start, 21),
    bufferDays: 1,
    regularMinutes: 210,
    studyMinutes: 360,
    travelMinutes: 20,
    countWordsTime: false,
    showWarnings: true,
    optionalReview: true,
    sidebarCollapsed: false,
    theme: 'system',
    notificationsEnabled: false,
    planningMode: 'balanced',
    freezeDays: 2,
    regularOverbookMinutes: 0,
    studyOverbookMinutes: 0,
    regularMaxTasks: 7,
    studyMaxTasks: 10,
    subjectShareLimit: 0.6,
    highLoadThreshold: 0.85,
    highLoadStreak: 3,
    keepOfflineOnLogout: false,
    targetUtilization: 0.85,
    nearFullThreshold: 0.9,
    bufferUtilization: 0.3,
    localRepairRadius: 3,
    maxNewTasksPerDay: 2,
    maxLoadChangeRatio: 0.15,
    longTaskThresholdMinutes: 90,
    longTaskMaxPerDay: 2,
    longTaskMaxPerDayLight: 1,
    customSubjects: DEFAULT_SUBJECTS,
    duration: { enabled: true, windowSize: 10, minimumSamples: 3, deviationThreshold: 0.2, outlierRule: 'iqr' },
    setupProgress: { currentStep: 1, availabilityConfirmed: false },
  }
  return {
    ...defaults,
    ...input,
    customSubjects: Array.from(new Set([...(input.customSubjects ?? defaults.customSubjects), ...DEFAULT_SUBJECTS])),
    duration: { ...defaults.duration, ...(input.duration ?? {}) },
  }
}

function group(input: Omit<TaskGroup, 'id'>): TaskGroup {
  const now = new Date().toISOString()
  return { ...input, id: uid('group'), status: input.status ?? 'active', createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now }
}

function expectedAutomaticTitle(taskGroup: TaskGroup, index: number): string {
  if (taskGroup.recurring) return taskGroup.title
  return taskGroup.quantity > 1 ? `${taskGroup.title} ${String(index).padStart(2, '0')}` : taskGroup.title
}

function assignmentsForGroup(taskGroup: TaskGroup): Assignment[] {
  const now = new Date().toISOString()
  if (taskGroup.recurring && taskGroup.recurrenceStart && taskGroup.recurrenceEnd) {
    const recurrenceDates = dateRange(taskGroup.recurrenceStart, taskGroup.recurrenceEnd)
      .filter(date => !taskGroup.recurrenceWeekdays?.length || taskGroup.recurrenceWeekdays.includes(new Date(`${date}T12:00:00`).getDay()))
    return recurrenceDates.map((date, index) => ({
      id: uid('task'), groupId: taskGroup.id, index: index + 1,
      title: `${taskGroup.title} · ${date.slice(5).replace('-', '.')}`,
      titleCustomized: false, durationCustomized: false, standalone: false,
      scheduledDate: date, estimatedMinutes: taskGroup.unitMinutes, actualMinutes: 0, progress: 0,
      status: 'todo', locked: true, timeEntries: [], scheduleSource: 'recurring', intentStrength: 'locked',
      createdAt: now, updatedAt: now, createdBy: 'template',
    }))
  }
  const sourceQuantity = Math.max(1, taskGroup.sourceQuantity ?? taskGroup.quantity)
  const splitMinutes = taskGroup.allowSplit && taskGroup.splitSessionMinutes && taskGroup.splitSessionMinutes < taskGroup.unitMinutes
    ? taskGroup.splitSessionMinutes
    : undefined
  if (splitMinutes) {
    const result: Assignment[] = []
    for (let sourceIndex = 1; sourceIndex <= sourceQuantity; sourceIndex += 1) {
      const splitTotal = Math.ceil(taskGroup.unitMinutes / splitMinutes)
      for (let splitPart = 1; splitPart <= splitTotal; splitPart += 1) {
        const consumed = (splitPart - 1) * splitMinutes
        const estimatedMinutes = Math.min(splitMinutes, taskGroup.unitMinutes - consumed)
        const sourceLabel = sourceQuantity > 1 ? ` ${String(sourceIndex).padStart(2, '0')}` : ''
        result.push({
          id: uid('task'), groupId: taskGroup.id, index: result.length + 1,
          title: `${taskGroup.title}${sourceLabel} · 第 ${splitPart}/${splitTotal} 段`, titleCustomized: false,
          estimatedMinutes, durationCustomized: false, standalone: Boolean(taskGroup.hiddenStandalone),
          actualMinutes: 0, progress: 0, status: 'todo', locked: false, timeEntries: [],
          scheduleSource: 'system', intentStrength: 'normal', createdAt: now, updatedAt: now, createdBy: 'template',
          splitSourceIndex: sourceIndex, splitPart, splitTotal,
        })
      }
    }
    return result
  }
  return Array.from({ length: sourceQuantity }, (_, index) => ({
    id: uid('task'), groupId: taskGroup.id, index: index + 1,
    title: expectedAutomaticTitle({ ...taskGroup, quantity: sourceQuantity }, index + 1), titleCustomized: false,
    estimatedMinutes: taskGroup.unitMinutes, durationCustomized: false, standalone: Boolean(taskGroup.hiddenStandalone),
    actualMinutes: 0, progress: 0, status: 'todo', locked: false, timeEntries: [],
    scheduleSource: 'system', intentStrength: 'normal', createdAt: now, updatedAt: now, createdBy: 'template',
  }))
}

function createBaseState(settings: AppSettings, groups: TaskGroup[], templateKind: AppState['templateKind']): AppState {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    version: SCHEMA_VERSION,
    dataRevision: 1,
    updatedAt: now,
    settings,
    dayConfigs: Object.fromEntries(dateRange(settings.startDate, settings.endDate).map(date => [date, { date, type: 'regular' as const, userSet: false }])),
    taskGroups: groups,
    assignments: groups.flatMap(assignmentsForGroup),
    goals: [],
    calendarConstraints: [],
    acceptedConstraintExceptions: [],
    timer: { accumulatedSeconds: 0, running: false },
    reviewRecords: [],
    changeEvents: [],
    intakeBatches: [],
    dailyPlanBaselines: [],
    guestModified: false,
    replanHistory: [],
    planVersions: [],
    conflictBackups: [],
    templateKind,
  }
}

function condition(groupId: string, mode: GoalCondition['mode'], value?: number): GoalCondition {
  return { id: uid('condition'), groupId, mode, value }
}

export function buildGuestDemoState(): AppState {
  const today = todayISO()
  const start = shiftDate(today, -1)
  const end = shiftDate(today, 27)
  const core = shiftDate(today, 10)
  const chemistryDate = shiftDate(today, 21)
  const lateTarget = shiftDate(today, 24)
  const groups: TaskGroup[] = [
    group({ subject: '数学', title: '函数综合训练卷', priority: 5, quantity: 8, unitMinutes: 115, targetDate: core, dueDate: end, countInStats: true, activityType: 'math-paper', highIntensity: true, allowSplit: false, notes: '演示长任务、套卷每日上限和预计用时校准。' }),
    group({ subject: '物理', title: '运动学限时小练', priority: 5, quantity: 10, unitMinutes: 30, targetDate: core, dueDate: end, countInStats: true }),
    group({ subject: '化学', title: '实验专题预习微课', priority: 5, quantity: 15, unitMinutes: 55, targetDate: chemistryDate, dueDate: end, dailyMax: 1, countInStats: true, activityType: 'chem-preview' }),
    group({ subject: '化学', title: '物质结构章末复盘', priority: 5, quantity: 4, unitMinutes: 75, targetDate: core, dueDate: end, countInStats: true, highIntensity: true }),
    group({ subject: '语文', title: '古诗文精读', priority: 5, quantity: 28, unitMinutes: 8, targetDate: core, dueDate: end, dailyMax: 4, countInStats: true, flexibleDuration: true, memoryTask: true, activityType: 'classical-study' }),
    group({ subject: '语文', title: '名篇默写', priority: 5, quantity: 2, unitMinutes: 25, targetDate: core, dueDate: end, dailyMax: 1, countInStats: true, memoryTask: true, activityType: 'classical-dictation' }),
    group({ subject: '语文', title: '散文段落背诵', priority: 5, quantity: 10, unitMinutes: 25, targetDate: core, dueDate: end, dailyMax: 1, countInStats: true, flexibleDuration: true, memoryTask: true, activityType: 'recitation' }),
    group({ subject: '英语', title: '阅读与语法小练', priority: 3, quantity: 30, unitMinutes: 20, targetDate: lateTarget, dueDate: end, countInStats: true }),
    group({ subject: '物理', title: '错题回看与订正', priority: 3, quantity: 8, unitMinutes: 40, targetDate: lateTarget, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '数学', title: '易错题专题整理', priority: 3, quantity: 12, unitMinutes: 35, targetDate: lateTarget, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '生物', title: '必修知识图谱', priority: 2, quantity: 12, unitMinutes: 35, targetDate: lateTarget, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '英语', title: '词汇打卡', priority: 5, quantity: 29, unitMinutes: 15, targetDate: end, dueDate: end, recurring: true, recurrenceStart: start, recurrenceEnd: end, countInStats: false, memoryTask: true }),
  ]
  let state = createBaseState(defaultSettings({ planName: '完整功能演示计划', startDate: start, endDate: end, coreTargetDate: core, chemistryTargetDate: chemistryDate }), groups, 'demo')
  state.settings.setupProgress = { currentStep: 4, availabilityConfirmed: true }
  const days = dateRange(today, end)
  const schedulable = state.assignments.filter(item => item.scheduleSource !== 'recurring')
  schedulable.forEach((item, index) => { item.scheduledDate = days[index % Math.min(days.length, 23)] })
  for (const date of dateRange(start, end)) {
    const offset = Math.round((Date.parse(date) - Date.parse(today)) / 86400000)
    if ([0, 1, 2, 6, 7, 8].includes(offset)) state.dayConfigs[date] = { date, type: 'study', userSet: true }
  }
  state.dayConfigs[shiftDate(today, 5)] = { date: shiftDate(today, 5), type: 'regular', userSet: true, isBufferDay: true, availableMinutes: 60, bufferReason: '演示：当天有活动，只能学习 1 小时', bufferPreference: 'preserve', bufferProtected: true }
  state.dayConfigs[shiftDate(today, 13)] = { date: shiftDate(today, 13), type: 'travel', userSet: true, note: '演示外出日' }
  const now = new Date().toISOString()
  const chemistry = groups.find(item => item.title === '实验专题预习微课')!
  const mainGroups = groups.filter(item => ['函数综合训练卷', '运动学限时小练', '古诗文精读'].includes(item.title))
  state.goals = [
    { id: uid('goal'), title: '完成暑假核心学习任务', priority: 5, description: '优先完成数学、物理和古诗文核心任务。', desiredDate: core, latestDate: end, status: 'active', completionConditions: mainGroups.map(item => condition(item.id, 'all')), linkedTaskGroupIds: mainGroups.map(item => item.id), linkedAssignmentIds: [], createdAt: now, updatedAt: now },
    { id: uid('goal'), title: '化学阶段检查准备', priority: 5, description: '老师检查前完成至少一半化学预习。', desiredDate: shiftDate(today, 10), latestDate: shiftDate(today, 15), status: 'active', completionConditions: [condition(chemistry.id, 'percentage', 50)], linkedTaskGroupIds: [chemistry.id], linkedAssignmentIds: [], createdAt: now, updatedAt: now },
  ]
  state.calendarConstraints = [
    { id: uid('constraint'), startDate: shiftDate(today, 13), endDate: shiftDate(today, 13), kind: 'unavailable', capacityMinutes: 0, protected: true, reason: '演示外出日', preference: 'spread', createdAt: now, updatedAt: now },
    { id: uid('constraint'), startDate: shiftDate(today, 5), endDate: shiftDate(today, 5), kind: 'protected-buffer', capacityMinutes: 60, protected: true, reason: '演示：当天有活动，只能学习 1 小时', preference: 'preserve', createdAt: now, updatedAt: now },
  ]
  const sampleTasks = state.assignments.filter(item => item.scheduleSource !== 'recurring').slice(0, 8)
  sampleTasks.forEach((item, index) => {
    item.scheduledDate = today
    if (index < 5) {
      item.status = 'done'; item.progress = 100; item.actualMinutes = Math.max(5, item.estimatedMinutes + [-10, -5, 0, 5, -8][index]); item.completedAt = now
      item.timeEntries = [{ id: uid('time'), minutes: item.actualMinutes, createdAt: now, source: 'timer', countInStatistics: true }]
    } else if (index === 5) {
      item.status = 'partial'; item.progress = 45; item.actualMinutes = 22; item.remainingMinutes = Math.max(10, Math.round(item.estimatedMinutes * 0.55)); item.timeEntries = [{ id: uid('time'), minutes: 22, createdAt: now, source: 'manual' }]
    }
  })
  state.updatedAt = now
  return updateGoalAndGroupLifecycle(state)
}

export function buildBlankState(): AppState {
  const start = todayISO()
  return createBaseState(defaultSettings({ planName: '我的学习计划', startDate: start, endDate: shiftDate(start, 30), coreTargetDate: shiftDate(start, 14), chemistryTargetDate: shiftDate(start, 21) }), [], 'blank')
}

function compactSnapshot(item: unknown): string | undefined {
  try {
    const parsed = typeof item === 'string' ? JSON.parse(item) as Partial<AppState> : item as Partial<AppState>
    if (!parsed || typeof parsed !== 'object') return undefined
    return JSON.stringify({ ...parsed, replanHistory: [], conflictBackups: [], planVersions: [] })
  } catch {
    return typeof item === 'string' && item.length <= 1_000_000 ? item : undefined
  }
}

function normalizeGroup(raw: Partial<TaskGroup>, now: string): TaskGroup {
  const title = String(raw.title ?? '未命名任务组')
  return {
    id: raw.id ?? uid('group'), subject: String(raw.subject ?? '其他'), title,
    priority: ([0, 1, 2, 3, 5].includes(Number(raw.priority)) ? Number(raw.priority) : 1) as TaskGroup['priority'],
    quantity: Math.max(0, Math.round(Number(raw.quantity ?? 0))), sourceQuantity: raw.sourceQuantity ? Math.max(1, Math.round(Number(raw.sourceQuantity))) : undefined, unitMinutes: Math.max(1, Math.round(Number(raw.unitMinutes ?? 30))),
    targetDate: String(raw.targetDate ?? ''), dueDate: String(raw.dueDate ?? raw.targetDate ?? ''), dailyMax: raw.dailyMax,
    recurring: Boolean(raw.recurring), recurrenceStart: raw.recurrenceStart, recurrenceEnd: raw.recurrenceEnd,
    recurrenceWeekdays: Array.isArray(raw.recurrenceWeekdays) ? raw.recurrenceWeekdays.map(Number).filter(day => day >= 0 && day <= 6) : undefined,
    countInStats: raw.countInStats ?? true, hidden: raw.hidden, hiddenStandalone: raw.hiddenStandalone,
    flexibleDuration: raw.flexibleDuration, allowSplit: raw.allowSplit ?? Boolean(raw.flexibleDuration || /作文|报告|整理|复习/.test(title)),
    splitSessionMinutes: raw.splitSessionMinutes ? Math.max(5, Math.round(Number(raw.splitSessionMinutes))) : undefined,
    prerequisiteGroupIds: Array.from(new Set((raw.prerequisiteGroupIds ?? []).map(String))),
    memoryTask: raw.memoryTask ?? /背诵|默写|文言文|古诗文|单词|词汇/.test(title),
    activityType: raw.activityType ?? inferActivity(String(raw.subject ?? '其他'), title),
    highIntensity: raw.highIntensity ?? /套卷|试卷|章末|综合|模拟/.test(title), notes: raw.notes, sourceLabel: raw.sourceLabel,
    status: raw.status ?? 'active', createdAt: raw.createdAt ?? now, updatedAt: raw.updatedAt ?? now, completedAt: raw.completedAt,
  }
}

function normalizeAssignment(raw: Partial<Assignment>, group: TaskGroup | undefined, now: string): Assignment {
  const index = Math.max(1, Math.round(Number(raw.index ?? 1)))
  const expected = group ? (group.quantity > 1 ? `${group.title} ${String(index).padStart(2, '0')}` : group.title) : String(raw.title ?? '未命名任务')
  const estimate = Math.max(1, Math.round(Number(raw.estimatedMinutes ?? group?.unitMinutes ?? 30)))
  const status = raw.status === 'done' || raw.status === 'partial' ? raw.status : 'todo'
  const timeEntries = Array.isArray(raw.timeEntries) ? raw.timeEntries.map(entry => ({
    ...entry,
    id: entry.id ?? uid('time'),
    minutes: Math.max(0, Math.round(Number(entry.minutes ?? 0))),
    date: safeExecutionDate(entry.date) ?? safeExecutionDate(entry.createdAt) ?? safeExecutionDate(raw.completedAt) ?? safeExecutionDate(raw.scheduledDate) ?? todayISO(),
    createdAt: entry.createdAt ?? now,
    updatedAt: entry.updatedAt,
    originalCreatedAt: entry.originalCreatedAt,
  })) : []
  const statusHistory = Array.isArray(raw.statusHistory)
    ? raw.statusHistory.filter(event => event && safeExecutionDate(event.date)).map(event => ({
      id: event.id ?? uid('status'),
      date: safeExecutionDate(event.date)!,
      createdAt: event.createdAt ?? now,
      status: (event.status === 'done' || event.status === 'partial' ? event.status : 'todo') as Assignment['status'],
      progress: event.status === 'done' ? 100 : Math.max(0, Math.min(99, Math.round(Number(event.progress ?? 0)))),
      source: event.source === 'completion' || event.source === 'partial' || event.source === 'reopen' ? event.source : 'migration' as const,
    }))
    : raw.completedAt && safeExecutionDate(raw.completedAt)
      ? [{ id: uid('status'), date: safeExecutionDate(raw.completedAt)!, createdAt: raw.completedAt, status: 'done' as const, progress: 100, source: 'migration' as const }]
      : raw.status === 'partial' && safeExecutionDate(raw.updatedAt)
        ? [{ id: uid('status'), date: safeExecutionDate(raw.updatedAt)!, createdAt: raw.updatedAt!, status: 'partial' as const, progress: Math.max(1, Math.min(99, Math.round(Number(raw.progress ?? 1)))), source: 'migration' as const }]
        : []
  return {
    id: raw.id ?? uid('task'), groupId: String(raw.groupId ?? group?.id ?? ''), index, title: String(raw.title ?? expected),
    scheduledDate: raw.scheduledDate, estimatedMinutes: estimate, actualMinutes: Math.max(0, Math.round(Number(raw.actualMinutes ?? 0))),
    progress: status === 'done' ? 100 : Math.min(99, Math.max(0, Math.round(Number(raw.progress ?? 0)))), status,
    locked: Boolean(raw.locked), completedAt: raw.completedAt, notes: raw.notes,
    timeEntries,
    statusHistory,
    scheduleSource: raw.scheduleSource ?? (group?.recurring ? 'recurring' : 'system'),
    intentStrength: raw.intentStrength ?? (raw.locked ? 'locked' : raw.scheduleSource === 'manual' ? 'manual' : 'normal'),
    previousDate: raw.previousDate, lastManualMoveAt: raw.lastManualMoveAt, remainingMinutes: raw.remainingMinutes,
    manuallyEstimated: raw.manuallyEstimated, titleCustomized: raw.titleCustomized ?? String(raw.title ?? expected) !== expected,
    durationCustomized: raw.durationCustomized ?? Boolean(raw.manuallyEstimated || estimate !== (group?.unitMinutes ?? estimate)),
    standalone: raw.standalone ?? Boolean(group?.hiddenStandalone), createdAt: raw.createdAt ?? now, updatedAt: raw.updatedAt ?? now, createdBy: raw.createdBy ?? 'migration',
    splitSourceIndex: raw.splitSourceIndex, splitPart: raw.splitPart, splitTotal: raw.splitTotal,
  }
}

function normalizeIntakeTask(raw: Partial<IntakeTaskGroupDraft>, now: string): IntakeTaskGroupDraft {
  const recurring = Boolean(raw.recurring)
  const recurrenceStart = raw.recurrenceStart
  const recurrenceEnd = raw.recurrenceEnd && recurrenceStart && raw.recurrenceEnd < recurrenceStart ? recurrenceStart : raw.recurrenceEnd
  return {
    id: raw.id ?? uid('intake-item'),
    kind: raw.kind === 'single' ? 'single' : 'group',
    title: String(raw.title ?? '').trim(),
    subject: String(raw.subject ?? '其他'),
    priority: ([0, 1, 2, 3, 5].includes(Number(raw.priority)) ? Number(raw.priority) : 3) as IntakeTaskGroupDraft['priority'],
    unitMinutes: Math.max(1, Math.round(Number(raw.unitMinutes ?? 30))),
    activityType: raw.activityType ?? inferActivity(String(raw.subject ?? '其他'), String(raw.title ?? '')),
    dailyMax: raw.dailyMax ? Math.max(1, Math.round(Number(raw.dailyMax))) : undefined,
    highIntensity: Boolean(raw.highIntensity),
    countInStats: raw.countInStats ?? true,
    quantity: Math.max(1, Math.round(Number(raw.quantity ?? 1))),
    notes: raw.notes,
    goalIds: Array.from(new Set((raw.goalIds ?? []).map(String))),
    goalTitle: raw.goalTitle ? String(raw.goalTitle).trim() : undefined,
    desiredDate: raw.desiredDate,
    latestDate: raw.latestDate,
    preferredDate: raw.preferredDate,
    fixedDate: raw.fixedDate,
    recurring,
    recurrenceStart,
    recurrenceEnd,
    recurrenceWeekdays: Array.isArray(raw.recurrenceWeekdays) ? Array.from(new Set(raw.recurrenceWeekdays.map(Number).filter(day => day >= 0 && day <= 6))).sort() : undefined,
    allowSplit: Boolean(raw.allowSplit),
    splitSessionMinutes: raw.splitSessionMinutes ? Math.max(5, Math.round(Number(raw.splitSessionMinutes))) : undefined,
    prerequisiteGroupIds: Array.from(new Set((raw.prerequisiteGroupIds ?? []).map(String))),
    prerequisiteGroupTitles: Array.from(new Set((raw.prerequisiteGroupTitles ?? []).map(String).filter(Boolean))),
    numberingChoice: raw.numberingChoice,
    source: raw.source === 'paste' || raw.source === 'csv' || raw.source === 'xlsx' ? raw.source : 'manual',
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
    appliedAt: raw.appliedAt,
    appliedGroupId: raw.appliedGroupId,
    appliedAssignmentId: raw.appliedAssignmentId,
  }
}

function normalizeIntakeBatch(raw: Partial<IntakeBatch>, now: string): IntakeBatch {
  const taskGroups = (raw.taskGroups ?? []).map(item => normalizeIntakeTask(item, now))
  const sourceKinds = new Set(taskGroups.map(item => item.source))
  const source = raw.source === 'mixed' || sourceKinds.size > 1
    ? 'mixed'
    : raw.source === 'paste' || raw.source === 'csv' || raw.source === 'xlsx'
      ? raw.source
      : taskGroups[0]?.source ?? 'manual'
  const status = raw.status === 'pending' || raw.status === 'applied' || raw.status === 'archived' ? raw.status : 'editing'
  return {
    id: raw.id ?? uid('intake'),
    name: String(raw.name ?? '未命名录入批次').trim() || '未命名录入批次',
    status,
    source,
    taskGroups,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
    lastEditedItemId: raw.lastEditedItemId,
    formDraft: raw.formDraft ? structuredClone(raw.formDraft) : undefined,
    archivedAt: raw.archivedAt,
  }
}

function migrateLegacyGoals(raw: Partial<AppState>, groups: TaskGroup[], now: string): Goal[] {
  const existing = Array.isArray(raw.goals) ? raw.goals : []
  if (existing.length > 0) return existing.map(goal => ({ ...goal, priority: goal.priority ?? 3, linkedTaskGroupIds: Array.from(new Set(goal.linkedTaskGroupIds ?? [])), linkedAssignmentIds: Array.from(new Set(goal.linkedAssignmentIds ?? [])), completionConditions: goal.completionConditions ?? [], createdAt: goal.createdAt ?? now, updatedAt: goal.updatedAt ?? now }))
  const goals: Goal[] = []
  const coreDate = raw.settings?.coreTargetDate
  const chemistryDate = raw.settings?.chemistryTargetDate
  const coreGroups = groups.filter(group => group.priority === 5 && group.subject !== '化学' && !group.hiddenStandalone)
  const chemistryGroups = groups.filter(group => group.subject === '化学' && !group.hiddenStandalone)
  if (coreDate && coreGroups.length) goals.push({ id: uid('goal'), title: '迁移：核心任务目标', priority: 5, description: '由 v0.7 全局核心目标日期迁移；迁移本身不会改变原排期。', desiredDate: coreDate, latestDate: coreGroups.map(group => group.dueDate || coreDate).sort().at(-1) ?? coreDate, status: 'active', completionConditions: coreGroups.map(group => condition(group.id, 'all')), linkedTaskGroupIds: coreGroups.map(group => group.id), linkedAssignmentIds: [], migratedFromLegacy: true, createdAt: now, updatedAt: now })
  if (chemistryDate && chemistryGroups.length) goals.push({ id: uid('goal'), title: '迁移：化学任务目标', priority: 5, description: '由 v0.7 化学目标日期迁移；迁移本身不会改变原排期。', desiredDate: chemistryDate, latestDate: chemistryGroups.map(group => group.dueDate || chemistryDate).sort().at(-1) ?? chemistryDate, status: 'active', completionConditions: chemistryGroups.map(group => condition(group.id, 'all')), linkedTaskGroupIds: chemistryGroups.map(group => group.id), linkedAssignmentIds: [], migratedFromLegacy: true, createdAt: now, updatedAt: now })
  const covered = new Set(goals.flatMap(goal => goal.linkedTaskGroupIds))
  for (const groupItem of groups) {
    if (covered.has(groupItem.id) || groupItem.hiddenStandalone || !(groupItem.targetDate || groupItem.dueDate)) continue
    const desired = groupItem.targetDate || groupItem.dueDate
    const latest = groupItem.dueDate || desired
    goals.push({ id: uid('goal'), title: `迁移：${groupItem.title}`, priority: groupItem.priority, description: '由 v0.7 任务组目标日期迁移。', desiredDate: desired, latestDate: latest < desired ? desired : latest, status: 'active', completionConditions: [condition(groupItem.id, 'all')], linkedTaskGroupIds: [groupItem.id], linkedAssignmentIds: [], migratedFromLegacy: true, createdAt: now, updatedAt: now })
  }
  return goals
}

function migrateConstraints(raw: Partial<AppState>, now: string): CalendarConstraint[] {
  if (Array.isArray(raw.calendarConstraints) && raw.calendarConstraints.length) return raw.calendarConstraints.map(item => ({ ...item, endDate: item.endDate || item.startDate, protected: Boolean(item.protected), createdAt: item.createdAt ?? now, updatedAt: item.updatedAt ?? now }))
  const result: CalendarConstraint[] = []
  for (const config of Object.values(raw.dayConfigs ?? {})) {
    if (!config?.userSet) continue
    if (config.type === 'travel') result.push({ id: uid('constraint'), startDate: config.date, endDate: config.date, kind: 'unavailable', capacityMinutes: Math.max(0, config.availableMinutes ?? raw.settings?.travelMinutes ?? 0), protected: true, reason: config.note || config.bufferReason || '由 v0.7 外出日迁移', preference: config.bufferPreference, createdAt: now, updatedAt: now })
    else if (config.isBufferDay) result.push({ id: uid('constraint'), startDate: config.date, endDate: config.date, kind: 'protected-buffer', capacityMinutes: config.availableMinutes, protected: config.bufferProtected ?? true, reason: config.bufferReason || config.note || '由 v0.7 缓冲日迁移', preference: config.bufferPreference, createdAt: now, updatedAt: now })
    else if (typeof config.availableMinutes === 'number' || config.type === 'custom') result.push({ id: uid('constraint'), startDate: config.date, endDate: config.date, kind: 'special-capacity', capacityMinutes: config.availableMinutes ?? config.customMinutes, protected: false, reason: config.note || '由 v0.7 自定义容量迁移', createdAt: now, updatedAt: now })
  }
  return result
}

export function normalizeState(rawInput: AppState): AppState {
  const raw = (rawInput ?? {}) as Partial<AppState>
  const now = new Date().toISOString()
  const settings = defaultSettings(raw.settings ?? {})
  const rawVersions = raw.planVersions ?? []
  const rawHistory = raw.replanHistory ?? []
  const rawBackups = raw.conflictBackups ?? []
  let taskGroups = (raw.taskGroups ?? []).map(item => normalizeGroup(item, now))
  const groupById = new Map(taskGroups.map(item => [item.id, item]))
  let assignments = (raw.assignments ?? []).map(item => normalizeAssignment(item, groupById.get(item.groupId), now))
  // 清理无依赖的孤立隐藏组；有历史或任务依赖的组继续保留。
  const usedGroupIds = new Set(assignments.map(item => item.groupId))
  taskGroups = taskGroups.filter(item => !item.hiddenStandalone || usedGroupIds.has(item.id))
  taskGroups = taskGroups.map(item => ({ ...item, quantity: assignments.filter(task => task.groupId === item.id).length }))
  const validGroupIds = new Set(taskGroups.map(item => item.id))
  taskGroups = taskGroups.map(item => ({ ...item, prerequisiteGroupIds: (item.prerequisiteGroupIds ?? []).filter(id => id !== item.id && validGroupIds.has(id)) }))
  assignments = assignments.filter(item => validGroupIds.has(item.groupId))
  const goals = migrateLegacyGoals(raw, taskGroups, now)
    .map(goal => ({ ...goal, desiredDate: goal.desiredDate && goal.desiredDate > goal.latestDate ? goal.latestDate : goal.desiredDate, linkedTaskGroupIds: goal.linkedTaskGroupIds.filter(id => validGroupIds.has(id)), linkedAssignmentIds: goal.linkedAssignmentIds.filter(id => assignments.some(item => item.id === id)), completionConditions: goal.completionConditions.filter(item => validGroupIds.has(item.groupId)) }))
  const dayConfigs = { ...(raw.dayConfigs ?? {}) }
  for (const date of dateRange(settings.startDate, settings.endDate)) {
    const existing = dayConfigs[date]
    dayConfigs[date] = { ...(existing ?? { type: 'regular' as const }), date, userSet: existing?.userSet ?? false, bufferProtected: existing?.bufferProtected ?? Boolean(existing?.isBufferDay && existing?.userSet) }
  }
  const state: AppState = {
    schemaVersion: SCHEMA_VERSION, version: SCHEMA_VERSION, dataRevision: Math.max(1, Math.round(Number(raw.dataRevision ?? 1))), updatedAt: raw.updatedAt ?? now, settings, dayConfigs,
    taskGroups, assignments, goals, calendarConstraints: migrateConstraints(raw, now),
    acceptedConstraintExceptions: (raw.acceptedConstraintExceptions ?? []).filter(item => item?.date && item?.key).slice(-100),
    timer: raw.timer ?? { accumulatedSeconds: 0, running: false }, reviewRecords: raw.reviewRecords ?? [], changeEvents: raw.changeEvents ?? [],
    intakeBatches: (raw.intakeBatches ?? []).map(item => normalizeIntakeBatch(item, now)).slice(-30),
    dailyPlanBaselines: (raw.dailyPlanBaselines ?? []).filter(item => item?.date && Array.isArray(item.assignments)).map(item => ({
      id: item.id ?? uid('baseline'), date: item.date, capturedAt: item.capturedAt ?? now,
      assignments: item.assignments.map(assignment => ({
        assignmentId: String(assignment.assignmentId), groupId: String(assignment.groupId), title: String(assignment.title),
        estimatedMinutes: Math.max(1, Math.round(Number(assignment.estimatedMinutes ?? 0))),
        statusAtCapture: (assignment.statusAtCapture === 'done' || assignment.statusAtCapture === 'partial' ? assignment.statusAtCapture : assignment.statusAtCapture === 'todo' ? 'todo' : undefined) as Assignment['status'] | undefined,
        progressAtCapture: assignment.progressAtCapture === undefined ? undefined : Math.max(0, Math.min(100, Math.round(Number(assignment.progressAtCapture)))),
      })),
    })).slice(-400),
    guestModified: raw.guestModified ?? false, lastCloudSyncAt: raw.lastCloudSyncAt, templateKind: raw.templateKind ?? 'blank',
    replanHistory: [...rawHistory].slice(-10), planVersions: [...rawVersions].slice(-10),
    conflictBackups: (rawBackups as unknown[]).map(compactSnapshot).filter((item): item is string => Boolean(item)).slice(-3),
  }
  return updateGoalAndGroupLifecycle(state)
}

export const buildInitialState = buildGuestDemoState
export function createAssignmentsForGroup(taskGroup: TaskGroup): Assignment[] { return assignmentsForGroup(taskGroup) }
