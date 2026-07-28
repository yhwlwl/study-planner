import { addDays, format } from 'date-fns'
import type { AppSettings, AppState, Assignment, TaskGroup } from '../types'
import { dateRange } from './date'
import { uid } from './id'
import { generateReplanBundle } from './planner'

function group(input: Omit<TaskGroup, 'id'>): TaskGroup {
  return { ...input, id: uid('group') }
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
    regularOverbookMinutes: 30,
    studyOverbookMinutes: 60,
    regularMaxTasks: 6,
    studyMaxTasks: 8,
    subjectShareLimit: 0.6,
    highLoadThreshold: 0.85,
    highLoadStreak: 3,
    keepOfflineOnLogout: false,
    ...input
  }
}

function assignmentsForGroup(g: TaskGroup): Assignment[] {
  if (g.recurring && g.recurrenceStart && g.recurrenceEnd) {
    return dateRange(g.recurrenceStart, g.recurrenceEnd).map((date, i) => ({
      id: uid('task'), groupId: g.id, index: i + 1, title: `${g.title} · ${date.slice(5).replace('-', '.')}`,
      scheduledDate: date, estimatedMinutes: g.unitMinutes, actualMinutes: 0, progress: 0,
      status: 'todo', locked: true, timeEntries: [], scheduleSource: 'recurring', intentStrength: 'locked'
    }))
  }
  return Array.from({ length: g.quantity }, (_, i) => ({
    id: uid('task'), groupId: g.id, index: i + 1,
    title: g.quantity > 1 ? `${g.title} ${String(i + 1).padStart(2, '0')}` : g.title,
    estimatedMinutes: g.unitMinutes, actualMinutes: 0, progress: 0,
    status: 'todo', locked: false, timeEntries: [], scheduleSource: 'system', intentStrength: 'normal'
  }))
}

function createBaseState(settings: AppSettings, groups: TaskGroup[], templateKind: AppState['templateKind']): AppState {
  return {
    version: 3,
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
  const start = format(new Date(), 'yyyy-MM-dd')
  const end = format(addDays(new Date(), 9), 'yyyy-MM-dd')
  const core = format(addDays(new Date(), 6), 'yyyy-MM-dd')
  const chem = format(addDays(new Date(), 8), 'yyyy-MM-dd')
  const groups: TaskGroup[] = [
    group({ subject: '数学', title: '周练', priority: 5, quantity: 2, unitMinutes: 100, targetDate: core, dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '化学', title: '预习', priority: 5, quantity: 3, unitMinutes: 55, targetDate: chem, dueDate: end, dailyMax: 1, countInStats: true }),
    group({ subject: '语文', title: '背诵', priority: 5, quantity: 3, unitMinutes: 25, targetDate: core, dueDate: end, countInStats: true, flexibleDuration: true, allowSplit: true, memoryTask: true }),
    group({ subject: '物理', title: '错题整理', priority: 3, quantity: 2, unitMinutes: 45, targetDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'), dueDate: end, countInStats: true, allowSplit: true }),
    group({ subject: '英语', title: '阅读训练', priority: 3, quantity: 4, unitMinutes: 25, targetDate: format(addDays(new Date(), 8), 'yyyy-MM-dd'), dueDate: end, countInStats: true }),
    group({ subject: '英语', title: '单词打卡', priority: 5, quantity: 10, unitMinutes: 15, targetDate: end, dueDate: end, recurring: true, recurrenceStart: start, recurrenceEnd: end, countInStats: false, memoryTask: true })
  ]
  const state = createBaseState(defaultSettings({ planName: '功能演示计划', startDate: start, endDate: end, coreTargetDate: core, chemistryTargetDate: chem }), groups, 'demo')
  state.dayConfigs[start] = { date: start, type: 'regular', userSet: true, note: '可体验完成、计时和手动改期' }
  state.dayConfigs[format(addDays(new Date(), 1), 'yyyy-MM-dd')] = { date: format(addDays(new Date(), 1), 'yyyy-MM-dd'), type: 'study', userSet: true }
  state.dayConfigs[format(addDays(new Date(), 4), 'yyyy-MM-dd')] = { date: format(addDays(new Date(), 4), 'yyyy-MM-dd'), type: 'travel', userSet: true, note: '演示旅游日' }
  const bundle = generateReplanBundle(state, { mode: 'full', fromDate: start, freezeDays: 0 })
  const next = bundle.scenarios.find(x => x.strategy === 'balanced')?.nextState ?? state
  const partial = next.assignments.find(a => next.taskGroups.find(g => g.id === a.groupId)?.title === '物理错题整理')
  if (partial) {
    partial.status = 'partial'
    partial.progress = 45
    partial.actualMinutes = 22
    partial.remainingMinutes = 30
  }
  return next
}

export function buildBlankState(): AppState {
  const start = format(new Date(), 'yyyy-MM-dd')
  const end = format(addDays(new Date(), 30), 'yyyy-MM-dd')
  return createBaseState(defaultSettings({ planName: '我的学习计划', startDate: start, endDate: end, coreTargetDate: format(addDays(new Date(), 14), 'yyyy-MM-dd'), chemistryTargetDate: format(addDays(new Date(), 21), 'yyyy-MM-dd') }), [], 'blank')
}

export function normalizeState(raw: AppState): AppState {
  const state = structuredClone(raw)
  state.version = 3
  state.settings = defaultSettings(state.settings ?? {})
  state.replanHistory = state.replanHistory ?? []
  state.conflictBackups = ((state.conflictBackups ?? []) as unknown[]).map(item => typeof item === 'string' ? item : JSON.stringify(item))
  state.templateKind = state.templateKind ?? 'blank'
  state.dayConfigs = state.dayConfigs ?? {}
  for (const date of dateRange(state.settings.startDate, state.settings.endDate)) {
    const existingDay = state.dayConfigs[date]
    state.dayConfigs[date] = { ...(existingDay ?? { type: 'regular' as const }), date, userSet: existingDay?.userSet ?? false }
  }
  state.taskGroups = (state.taskGroups ?? []).map(g => ({
    ...g,
    allowSplit: g.allowSplit ?? Boolean(g.flexibleDuration || /套卷|作文|报告|整理|复习/.test(g.title)),
    memoryTask: g.memoryTask ?? /背诵|默写|文言文|单词/.test(g.title)
  }))
  const recurringIds = new Set(state.taskGroups.filter(g => g.recurring).map(g => g.id))
  state.assignments = (state.assignments ?? []).map(a => ({
    ...a,
    timeEntries: a.timeEntries ?? [],
    scheduleSource: a.scheduleSource ?? (recurringIds.has(a.groupId) ? 'recurring' : 'system'),
    intentStrength: a.intentStrength ?? (a.locked ? 'locked' : 'normal'),
    locked: Boolean(a.locked)
  }))
  for (const g of state.taskGroups.filter(g => g.flexibleDuration && g.unitMinutes > 60)) {
    g.unitMinutes = 30
    for (const a of state.assignments.filter(a => a.groupId === g.id && !a.manuallyEstimated && a.estimatedMinutes > 60)) a.estimatedMinutes = 30
  }
  state.timer = state.timer ?? { accumulatedSeconds: 0, running: false }
  state.updatedAt = state.updatedAt ?? new Date().toISOString()
  return state
}

export const buildInitialState = buildGuestDemoState

export function createAssignmentsForGroup(g: TaskGroup): Assignment[] {
  return assignmentsForGroup(g)
}
