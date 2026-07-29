import { addDays, format } from 'date-fns'
import type { AppSettings, AppState, Assignment, TaskActivityType, TaskGroup } from '../types'
import { dateRange } from './date'
import { uid } from './id'
import { generateReplanScenario } from './planner'

function group(input: Omit<TaskGroup, 'id'>): TaskGroup {
  return { ...input, id: uid('group') }
}

function inferActivity(subject: TaskGroup['subject'], title: string): TaskActivityType {
  const text = `${subject}${title}`
  if (subject === '语文' && /默写|听写/.test(text)) return 'classical-dictation'
  if (/背诵|默背/.test(text)) return 'recitation'
  if (subject === '语文' && /文言文|古文|古诗文/.test(text)) return 'classical-study'
  if (subject === '化学' && /预习|微课/.test(text)) return 'chem-preview'
  if (subject === '数学' && /套卷|试卷|周练|真题|模拟卷/.test(text)) return 'math-paper'
  return 'normal'
}

function defaultSettings(input: Partial<AppSettings> = {}): AppSettings {
  const start = format(new Date(), 'yyyy-MM-dd')
  return {
    planName: '学习计划',
    startDate: start,
    endDate: format(addDays(new Date(), 30), 'yyyy-MM-dd'),
    coreTargetDate: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
    chemistryTargetDate: format(addDays(new Date(), 21), 'yyyy-MM-dd'),
    bufferDays: 1,
    regularMinutes: 210,
    studyMinutes: 360,
    travelMinutes: 20,
    countWordsTime: false,
    showWarnings: true,
    optionalReview: true,
    sidebarCollapsed: false,
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
    ...input
  }
}

function assignmentsForGroup(taskGroup: TaskGroup): Assignment[] {
  if (taskGroup.recurring && taskGroup.recurrenceStart && taskGroup.recurrenceEnd) {
    return dateRange(taskGroup.recurrenceStart, taskGroup.recurrenceEnd).map((date, index) => ({
      id: uid('task'),
      groupId: taskGroup.id,
      index: index + 1,
      title: `${taskGroup.title} · ${date.slice(5).replace('-', '.')}`,
      scheduledDate: date,
      estimatedMinutes: taskGroup.unitMinutes,
      actualMinutes: 0,
      progress: 0,
      status: 'todo',
      locked: true,
      timeEntries: [],
      scheduleSource: 'recurring',
      intentStrength: 'locked'
    }))
  }
  return Array.from({ length: taskGroup.quantity }, (_, index) => ({
    id: uid('task'),
    groupId: taskGroup.id,
    index: index + 1,
    title: taskGroup.quantity > 1 ? `${taskGroup.title} ${String(index + 1).padStart(2, '0')}` : taskGroup.title,
    estimatedMinutes: taskGroup.unitMinutes,
    actualMinutes: 0,
    progress: 0,
    status: 'todo',
    locked: false,
    timeEntries: [],
    scheduleSource: 'system',
    intentStrength: 'normal'
  }))
}

function createBaseState(settings: AppSettings, groups: TaskGroup[], templateKind: AppState['templateKind']): AppState {
  return {
    version: 4,
    updatedAt: new Date().toISOString(),
    settings,
    dayConfigs: Object.fromEntries(dateRange(settings.startDate, settings.endDate).map(date => [date, { date, type: 'regular' as const, userSet: false }])),
    taskGroups: groups,
    assignments: groups.flatMap(assignmentsForGroup),
    timer: { accumulatedSeconds: 0, running: false },
    replanHistory: [],
    templateKind
  }
}

export function buildGuestDemoState(): AppState {
  const now = new Date()
  const today = format(now, 'yyyy-MM-dd')
  const start = format(addDays(now, -1), 'yyyy-MM-dd')
  const end = format(addDays(now, 27), 'yyyy-MM-dd')
  const core = format(addDays(now, 10), 'yyyy-MM-dd')
  const chemistry = format(addDays(now, 21), 'yyyy-MM-dd')
  const lateTarget = format(addDays(now, 24), 'yyyy-MM-dd')

  // 数量级、日期跨度和时长接近一份真实暑假计划，但课程名称和内容全部使用演示素材。
  const groups: TaskGroup[] = [
    group({ subject: '数学', title: '函数综合训练卷', priority: 5, quantity: 8, unitMinutes: 115, targetDate: core, dueDate: end, countInStats: true, activityType: 'math-paper', highIntensity: true, allowSplit: false, notes: '演示长任务、套卷每日上限和预计用时校准。' }),
    group({ subject: '物理', title: '运动学限时小练', priority: 5, quantity: 10, unitMinutes: 30, targetDate: core, dueDate: end, countInStats: true }),
    group({ subject: '化学', title: '实验专题预习微课', priority: 5, quantity: 15, unitMinutes: 55, targetDate: chemistry, dueDate: end, dailyMax: 1, countInStats: true, activityType: 'chem-preview' }),
    group({ subject: '化学', title: '物质结构章末复盘', priority: 5, quantity: 4, unitMinutes: 75, targetDate: core, dueDate: end, countInStats: true, highIntensity: true }),
    group({ subject: '化学', title: '方程式专题整理', priority: 3, quantity: 5, unitMinutes: 45, targetDate: chemistry, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '语文', title: '古诗文精读', priority: 5, quantity: 28, unitMinutes: 8, targetDate: core, dueDate: end, dailyMax: 4, countInStats: true, flexibleDuration: true, memoryTask: true, activityType: 'classical-study' }),
    group({ subject: '语文', title: '名篇默写', priority: 5, quantity: 2, unitMinutes: 25, targetDate: core, dueDate: end, dailyMax: 1, countInStats: true, memoryTask: true, activityType: 'classical-dictation' }),
    group({ subject: '语文', title: '散文段落背诵', priority: 5, quantity: 10, unitMinutes: 25, targetDate: core, dueDate: end, dailyMax: 1, countInStats: true, flexibleDuration: true, memoryTask: true, activityType: 'recitation' }),
    group({ subject: '语文', title: '现代文阅读批注', priority: 3, quantity: 8, unitMinutes: 30, targetDate: lateTarget, dueDate: end, countInStats: true }),
    group({ subject: '英语', title: '阅读与语法小练', priority: 3, quantity: 30, unitMinutes: 20, targetDate: lateTarget, dueDate: end, countInStats: true }),
    group({ subject: '英语', title: '作文句型整理', priority: 2, quantity: 6, unitMinutes: 30, targetDate: lateTarget, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '物理', title: '错题回看与订正', priority: 3, quantity: 8, unitMinutes: 40, targetDate: lateTarget, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '数学', title: '易错题专题整理', priority: 3, quantity: 12, unitMinutes: 35, targetDate: lateTarget, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '生物', title: '必修知识图谱', priority: 2, quantity: 12, unitMinutes: 35, targetDate: lateTarget, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '其他', title: '阶段复盘', priority: 1, quantity: 4, unitMinutes: 20, targetDate: lateTarget, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '英语', title: '词汇打卡', priority: 5, quantity: 29, unitMinutes: 15, targetDate: end, dueDate: end, recurring: true, recurrenceStart: start, recurrenceEnd: end, countInStats: false, memoryTask: true })
  ]

  const state = createBaseState(defaultSettings({
    planName: '完整功能演示计划',
    startDate: start,
    endDate: end,
    coreTargetDate: core,
    chemistryTargetDate: chemistry,
    regularMinutes: 210,
    studyMinutes: 360
  }), groups, 'demo')

  for (const date of dateRange(start, end)) {
    const offset = Math.max(0, Math.round((Date.parse(date) - Date.parse(today)) / 86400000))
    if ([0, 1, 2, 6, 7, 8].includes(offset)) state.dayConfigs[date] = { date, type: 'study', userSet: true }
  }
  const bufferDate = format(addDays(now, 5), 'yyyy-MM-dd')
  state.dayConfigs[bufferDate] = {
    date: bufferDate,
    type: 'regular',
    userSet: true,
    isBufferDay: true,
    availableMinutes: 60,
    bufferReason: '演示：当天有活动，只能学习 1 小时',
    bufferPreference: 'preserve',
    bufferProtected: true
  }
  const travelDate = format(addDays(now, 13), 'yyyy-MM-dd')
  state.dayConfigs[travelDate] = { date: travelDate, type: 'travel', userSet: true, note: '演示外出日' }

  const next = generateReplanScenario(state, {
    mode: 'full',
    fromDate: today,
    freezeDays: 0,
    todayExtraMinutes: 0,
    strategy: 'balanced'
  }, 'balanced').nextState

  const findSample = (title: string) => {
    const taskGroup = next.taskGroups.find(item => item.title === title)
    return taskGroup ? next.assignments.find(item => item.groupId === taskGroup.id && item.status !== 'done') : undefined
  }
  const timedDone = findSample('运动学限时小练')
  const inferredDone = findSample('古诗文精读')
  const partial = findSample('实验专题预习微课')
  const lightToday = findSample('阅读与语法小练')
  const tomorrowPaper = findSample('函数综合训练卷')
  const nowIso = new Date().toISOString()
  if (timedDone) {
    timedDone.scheduledDate = today
    timedDone.status = 'done'
    timedDone.progress = 100
    timedDone.actualMinutes = 31
    timedDone.completedAt = nowIso
    timedDone.timeEntries = [{ id: uid('time'), minutes: 31, createdAt: nowIso, source: 'timer' }]
  }
  if (inferredDone) {
    inferredDone.scheduledDate = today
    inferredDone.status = 'done'
    inferredDone.progress = 100
    inferredDone.actualMinutes = 0
    inferredDone.completedAt = nowIso
    inferredDone.timeEntries = []
  }
  if (partial) {
    partial.scheduledDate = today
    partial.status = 'partial'
    partial.progress = 45
    partial.actualMinutes = 22
    partial.remainingMinutes = Math.max(10, Math.round(partial.estimatedMinutes * 0.55))
    partial.timeEntries = [{ id: uid('time'), minutes: 22, createdAt: nowIso, source: 'manual' }]
  }
  if (lightToday) lightToday.scheduledDate = today
  if (tomorrowPaper) tomorrowPaper.scheduledDate = format(addDays(now, 1), 'yyyy-MM-dd')
  next.updatedAt = new Date().toISOString()
  return next
}

export function buildBlankState(): AppState {
  const start = format(new Date(), 'yyyy-MM-dd')
  const end = format(addDays(new Date(), 30), 'yyyy-MM-dd')
  return createBaseState(defaultSettings({
    planName: '我的学习计划',
    startDate: start,
    endDate: end,
    coreTargetDate: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
    chemistryTargetDate: format(addDays(new Date(), 21), 'yyyy-MM-dd')
  }), [], 'blank')
}

function compactConflictBackup(item: unknown): string | undefined {
  try {
    const parsed = typeof item === 'string' ? JSON.parse(item) as AppState : item as AppState
    if (!parsed || typeof parsed !== 'object') return undefined
    const portable = {
      ...parsed,
      replanHistory: [],
      conflictBackups: []
    }
    return JSON.stringify(portable)
  } catch {
    return typeof item === 'string' && item.length <= 1_000_000 ? item : undefined
  }
}

export function normalizeState(raw: AppState): AppState {
  // Clone only the active plan. History snapshots are immutable strings and can be
  // copied by reference; cloning them on every normalization caused large pauses.
  const rawHistory = raw.replanHistory ?? []
  const rawBackups = raw.conflictBackups ?? []
  const state = structuredClone({ ...raw, replanHistory: [], conflictBackups: [] }) as AppState
  state.version = 4
  state.settings = defaultSettings(state.settings ?? {})
  state.replanHistory = [...rawHistory].slice(-10)
  state.conflictBackups = (rawBackups as unknown[])
    .map(compactConflictBackup)
    .filter((item): item is string => Boolean(item))
    .slice(-3)
  state.templateKind = state.templateKind ?? 'blank'
  state.dayConfigs = state.dayConfigs ?? {}
  for (const date of dateRange(state.settings.startDate, state.settings.endDate)) {
    const existing = state.dayConfigs[date]
    state.dayConfigs[date] = {
      ...(existing ?? { type: 'regular' as const }),
      date,
      userSet: existing?.userSet ?? false,
      bufferProtected: existing?.bufferProtected ?? Boolean(existing?.isBufferDay && existing?.userSet)
    }
  }
  state.taskGroups = (state.taskGroups ?? []).map(taskGroup => ({
    ...taskGroup,
    allowSplit: taskGroup.allowSplit ?? Boolean(taskGroup.flexibleDuration || /作文|报告|整理|复习/.test(taskGroup.title)),
    memoryTask: taskGroup.memoryTask ?? /背诵|默写|文言文|古诗文|单词|词汇/.test(taskGroup.title),
    activityType: taskGroup.activityType ?? inferActivity(taskGroup.subject, taskGroup.title),
    highIntensity: taskGroup.highIntensity ?? /套卷|试卷|章末|综合|模拟/.test(taskGroup.title)
  }))
  const recurringIds = new Set(state.taskGroups.filter(taskGroup => taskGroup.recurring).map(taskGroup => taskGroup.id))
  state.assignments = (state.assignments ?? []).map(assignment => ({
    ...assignment,
    timeEntries: assignment.timeEntries ?? [],
    scheduleSource: assignment.scheduleSource ?? (recurringIds.has(assignment.groupId) ? 'recurring' : 'system'),
    intentStrength: assignment.intentStrength ?? (assignment.locked ? 'locked' : 'normal'),
    locked: Boolean(assignment.locked)
  }))
  state.timer = state.timer ?? { accumulatedSeconds: 0, running: false }
  state.updatedAt = state.updatedAt ?? new Date().toISOString()
  return state
}

export const buildInitialState = buildGuestDemoState

export function createAssignmentsForGroup(taskGroup: TaskGroup): Assignment[] {
  return assignmentsForGroup(taskGroup)
}
