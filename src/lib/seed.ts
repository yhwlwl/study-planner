import type { AppState, Assignment, TaskGroup } from '../types'
import { dateRange } from './date'
import { uid } from './id'
import { autoConfigureDayTypes, replanState } from './planner'

const START = '2026-07-28'
const END = '2026-08-25'
const CORE = '2026-08-08'
const CHEM = '2026-08-20'

function group(input: Omit<TaskGroup, 'id'>): TaskGroup {
  return { ...input, id: uid('group') }
}

function assignmentsForGroup(g: TaskGroup): Assignment[] {
  if (g.recurring && g.recurrenceStart && g.recurrenceEnd) {
    return dateRange(g.recurrenceStart, g.recurrenceEnd).map((date, i) => ({
      id: uid('task'), groupId: g.id, index: i + 1, title: `${g.title} · ${date.slice(5).replace('-', '.')}`,
      scheduledDate: date, estimatedMinutes: g.unitMinutes, actualMinutes: 0, progress: 0,
      status: 'todo', locked: true, timeEntries: []
    }))
  }
  return Array.from({ length: g.quantity }, (_, i) => ({
    id: uid('task'), groupId: g.id, index: i + 1,
    title: g.quantity > 1 ? `${g.title} ${String(i + 1).padStart(2, '0')}` : g.title,
    estimatedMinutes: g.unitMinutes, actualMinutes: 0, progress: 0,
    status: 'todo', locked: false, timeEntries: []
  }))
}

export function buildInitialState(): AppState {
  const groups: TaskGroup[] = [
    group({ subject: '物理', title: '完成暑假作业', priority: 5, quantity: 10, unitMinutes: 30, targetDate: CORE, dueDate: END, countInStats: true }),
    group({ subject: '化学', title: '预习', priority: 5, quantity: 15, unitMinutes: 60, targetDate: CHEM, dueDate: END, dailyMax: 1, countInStats: true, notes: '每天最多完成 1 个；最晚 8 月 20 日完成。' }),
    group({ subject: '化学', title: '75分钟任务（待确认名称）', priority: 5, quantity: 2, unitMinutes: 75, targetDate: CORE, dueDate: END, countInStats: true, sourceLabel: '照片中任务名字迹不清，可在任务页修改。' }),
    group({ subject: '化学', title: '章末复习', priority: 5, quantity: 4, unitMinutes: 75, targetDate: CORE, dueDate: END, countInStats: true }),
    group({ subject: '语文', title: '背诵', priority: 5, quantity: 14, unitMinutes: 30, targetDate: CORE, dueDate: END, countInStats: true, flexibleDuration: true, notes: '不限定固定时长，背完后再勾选；30 分钟仅作初始估计。' }),
    group({ subject: '语文', title: '默写', priority: 5, quantity: 4, unitMinutes: 30, targetDate: CORE, dueDate: END, countInStats: true }),
    group({ subject: '语文', title: '文言文', priority: 5, quantity: 28, unitMinutes: 10, targetDate: CORE, dueDate: END, countInStats: true }),
    group({ subject: '数学', title: '套卷', priority: 5, quantity: 8, unitMinutes: 120, targetDate: CORE, dueDate: END, countInStats: true }),
    group({ subject: '英语', title: '暑假任务（待确认名称）', priority: 5, quantity: 30, unitMinutes: 20, targetDate: CORE, dueDate: END, countInStats: true, sourceLabel: '照片中名称不清，可在任务页修改。' }),
    group({ subject: '英语', title: '单词打卡', priority: 5, quantity: dateRange(START, END).length, unitMinutes: 20, targetDate: END, dueDate: END, recurring: true, recurrenceStart: START, recurrenceEnd: END, countInStats: false, notes: '默认不计入每日计划总时长，可在设置中开启。' }),

    group({ subject: '语文', title: '读后感', priority: 3, quantity: 1, unitMinutes: 40, targetDate: '2026-08-18', dueDate: END, countInStats: true }),
    group({ subject: '化学', title: '复习必修二', priority: 3, quantity: 2, unitMinutes: 60, targetDate: '2026-08-20', dueDate: END, countInStats: true }),
    group({ subject: '生物', title: '遗传补充', priority: 3, quantity: 5, unitMinutes: 60, targetDate: '2026-08-22', dueDate: END, countInStats: true }),
    group({ subject: '生物', title: '复习必修一', priority: 3, quantity: 2, unitMinutes: 60, targetDate: '2026-08-22', dueDate: END, countInStats: true }),

    group({ subject: '生物', title: '读论文', priority: 2, quantity: 1, unitMinutes: 60, targetDate: '2026-08-24', dueDate: END, countInStats: true }),
    group({ subject: '生物', title: '上网课', priority: 2, quantity: 10, unitMinutes: 60, targetDate: '2026-08-24', dueDate: END, countInStats: true }),
    group({ subject: '数学', title: '数学练习', priority: 2, quantity: 20, unitMinutes: 10, targetDate: '2026-08-24', dueDate: END, countInStats: true, sourceLabel: '照片中具体任务名待确认。' }),
    group({ subject: '英语', title: '补笔记 / 视频（待确认）', priority: 2, quantity: 1, unitMinutes: 120, targetDate: '2026-08-24', dueDate: END, countInStats: true }),

    group({ subject: '数学', title: '解析练习', priority: 1, quantity: 20, unitMinutes: 20, targetDate: END, dueDate: END, countInStats: true }),
    group({ subject: '英语', title: '整理笔记（待确认）', priority: 1, quantity: 1, unitMinutes: 60, targetDate: END, dueDate: END, countInStats: true }),

    group({ subject: '物理', title: '预习', priority: 0, quantity: 1, unitMinutes: 60, targetDate: END, dueDate: END, countInStats: true, hidden: true }),
    group({ subject: '数学', title: '预解析几何', priority: 0, quantity: 1, unitMinutes: 60, targetDate: END, dueDate: END, countInStats: true, hidden: true }),
    group({ subject: '生物', title: '遗传书', priority: 0, quantity: 1, unitMinutes: 60, targetDate: END, dueDate: END, countInStats: true, hidden: true }),
    group({ subject: '物理', title: '整理笔记', priority: 0, quantity: 1, unitMinutes: 60, targetDate: END, dueDate: END, countInStats: true, hidden: true }),
    group({ subject: '物理', title: '电一', priority: 0, quantity: 2, unitMinutes: 60, targetDate: END, dueDate: END, countInStats: true, hidden: true }),
    group({ subject: '物理', title: '电二', priority: 0, quantity: 1, unitMinutes: 90, targetDate: END, dueDate: END, countInStats: true, hidden: true })
  ]

  const dayConfigs = Object.fromEntries(dateRange(START, END).map(date => [date, { date, type: 'regular' as const }]))
  let state: AppState = {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      planName: '高一升高二暑假计划', startDate: START, endDate: END,
      coreTargetDate: CORE, chemistryTargetDate: CHEM, bufferDays: 1,
      regularMinutes: 210, studyMinutes: 360, travelMinutes: 20,
      countWordsTime: false, showWarnings: true, optionalReview: true,
      sidebarCollapsed: false
    },
    dayConfigs,
    taskGroups: groups,
    assignments: groups.flatMap(assignmentsForGroup),
    timer: { accumulatedSeconds: 0, running: false }
  }
  state = autoConfigureDayTypes(state)
  state = replanState(state, START).nextState
  return state
}

export function createAssignmentsForGroup(g: TaskGroup): Assignment[] {
  return assignmentsForGroup(g)
}
