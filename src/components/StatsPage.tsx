import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ChevronRight,
  Clock3, Flame, Focus, Maximize2, Pencil, Table2, Target, Trash2, TrendingUp, X
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { getDay, parseISO } from 'date-fns'
import { useApp } from '../AppContext'
import type { Assignment, DailyPlanBaseline, Subject, TaskGroup, TimeEntry } from '../types'
import { dateRange, fmtDate, fmtWeekday, minutesText, shiftDate, todayISO } from '../lib/date'
import { allDurationSuggestions, predictCompletion } from '../lib/planner'
import { allGoalProgress } from '../lib/goals'
import { aggregateDaily, type DailyRow } from '../lib/stats'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

type StatsTab = 'overview' | 'trend' | 'subjects' | 'quality'
type RangePreset = 'today' | '7d' | 'week' | 'all' | 'custom'
type HeatMetric = 'minutes' | 'completion'
type ViewMode = 'chart' | 'table'

interface StatsPageProps {
  onOpenReplan?: (date: string) => void
}
interface SubjectRow {
  subject: Subject
  planned: number
  actual: number
  done: number
  total: number
  completion: number
  accuracy?: number
  sampleSize: number
  groups: Array<{
    id: string
    title: string
    done: number
    total: number
    planned: number
    actual: number
    accuracy?: number
  }>
}

interface InsightItem {
  tone: 'positive' | 'warning' | 'neutral'
  title: string
  detail: string
  action?: 'replan' | 'subjects'
}

interface LedgerRow {
  assignmentId: string
  assignmentTitle: string
  groupTitle: string
  subject: Subject
  entry: TimeEntry
}

const SUBJECTS: Subject[] = ['语文', '数学', '英语', '物理', '化学', '生物', '其他']
const SUBJECT_COLORS: Record<Subject, string> = {
  语文: '#8b5cf6', 数学: '#2563eb', 英语: '#f59e0b', 物理: '#0891b2',
  化学: '#16a34a', 生物: '#db2777', 其他: '#64748b'
}

function safeDate(value?: string) {
  if (!value) return undefined
  const date = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
}

function progressFraction(assignment: Assignment) {
  if (assignment.status === 'done') return 1
  if (assignment.status === 'partial') return Math.max(0, Math.min(1, assignment.progress / 100))
  return 0
}

function isActiveGroup(group?: TaskGroup) {
  return Boolean(group && !group.hidden)
}

function isCountedGroup(group: TaskGroup | undefined, countWordsTime: boolean) {
  return Boolean(group && !group.hidden && (group.countInStats || countWordsTime))
}

function within(date: string | undefined, start: string, end: string) {
  return Boolean(date && date >= start && date <= end)
}

function percent(value: number) {
  return `${Math.round(value)}%`
}

function calculateStreak(rows: DailyRow[], predicate: (row: DailyRow) => boolean) {
  const today = todayISO()
  const byDate = new Map(rows.map(row => [row.date, row]))
  let cursor = today
  let count = 0
  while (true) {
    const row = byDate.get(cursor)
    if (!row || !predicate(row)) break
    count += 1
    cursor = shiftDate(cursor, -1)
  }
  return count
}

function rangeForPreset(preset: RangePreset, planStart: string, planEnd: string, customStart: string, customEnd: string) {
  const today = todayISO()
  let start = planStart
  let end = planEnd
  if (preset === 'today') start = end = today
  if (preset === '7d') { start = shiftDate(today, -6); end = today }
  if (preset === 'week') {
    const offset = (getDay(parseISO(today)) + 6) % 7
    start = shiftDate(today, -offset)
    end = shiftDate(start, 6)
  }
  if (preset === 'custom') { start = customStart || planStart; end = customEnd || planEnd }
  if (start > end) [start, end] = [end, start]
  return { start, end }
}

function aggregateSubjects(assignments: Assignment[], groupList: TaskGroup[], baselines: DailyPlanBaseline[], countWordsTime: boolean, start: string, end: string, subjectNames: Subject[] = SUBJECTS): SubjectRow[] {
  const rangeBaselines = baselines.filter(item => within(item.date, start, end))
  const capturedDates = new Set(rangeBaselines.map(item => item.date))
  const baselineItems = rangeBaselines.flatMap(item => item.assignments)
  const plannedForGroups = (groupIds: Set<string>) => baselineItems
    .filter(item => groupIds.has(item.groupId))
    .reduce((sum, item) => sum + item.estimatedMinutes, 0)
    + assignments.reduce((sum, item) => sum + (groupIds.has(item.groupId) && within(item.scheduledDate, start, end) && !capturedDates.has(item.scheduledDate!) ? item.estimatedMinutes : 0), 0)
  return subjectNames.map(subject => {
    const subjectGroups = groupList.filter(group => group.subject === subject && !group.hidden)
    const groupIds = new Set(subjectGroups.map(group => group.id))
    const items = assignments.filter(item => groupIds.has(item.groupId))
    const countedIds = new Set(subjectGroups.filter(group => group.countInStats || countWordsTime).map(group => group.id))
    const completedForAccuracy = items.filter(item => item.status === 'done' && item.actualMinutes > 0 && countedIds.has(item.groupId))
    const estimatedAccuracy = completedForAccuracy.reduce((sum, item) => sum + item.estimatedMinutes, 0)
    const actualAccuracy = completedForAccuracy.reduce((sum, item) => sum + item.actualMinutes, 0)
    const accuracy = completedForAccuracy.length >= 3 && estimatedAccuracy > 0
      ? (actualAccuracy - estimatedAccuracy) / estimatedAccuracy * 100
      : undefined
    const actualInRange = (item: Assignment) => {
      if (!countedIds.has(item.groupId)) return 0
      let total = 0
      let recorded = 0
      for (const entry of item.timeEntries ?? []) {
        const minutes = Math.max(0, Number(entry.minutes) || 0)
        recorded += minutes
        if (within(safeDate(entry.createdAt), start, end)) total += minutes
      }
      const residual = Math.max(0, item.actualMinutes - recorded)
      const fallbackDate = safeDate(item.completedAt) ?? item.scheduledDate
      if (residual > 0 && within(fallbackDate, start, end)) total += residual
      return total
    }
    const groups = subjectGroups.map(group => {
      const groupItems = items.filter(item => item.groupId === group.id)
      const completed = groupItems.filter(item => item.status === 'done' && item.actualMinutes > 0)
      const est = completed.reduce((sum, item) => sum + item.estimatedMinutes, 0)
      const act = completed.reduce((sum, item) => sum + item.actualMinutes, 0)
      return {
        id: group.id,
        title: group.title,
        done: groupItems.filter(item => item.status === 'done').length,
        total: groupItems.length,
        planned: group.countInStats || countWordsTime ? plannedForGroups(new Set([group.id])) : 0,
        actual: groupItems.reduce((sum, item) => sum + actualInRange(item), 0),
        accuracy: completed.length >= 3 && est > 0 ? (act - est) / est * 100 : undefined
      }
    })
    return {
      subject,
      planned: plannedForGroups(countedIds),
      actual: items.reduce((sum, item) => sum + actualInRange(item), 0),
      done: items.filter(item => item.status === 'done').length,
      total: items.length,
      completion: items.length ? items.reduce((sum, item) => sum + progressFraction(item), 0) / items.length * 100 : 0,
      accuracy,
      sampleSize: completedForAccuracy.length,
      groups
    }
  }).filter(item => item.total > 0 || item.planned > 0 || item.actual > 0)
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return <div className="stats-tooltip"><strong>{label}</strong>{payload.map((item: any) => <span key={item.dataKey} style={{ color: item.color }}>{item.name}：{item.dataKey?.includes('Completion') || item.dataKey === 'completion' ? `${Math.round(item.value)}%` : minutesText(Number(item.value))}</span>)}</div>
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'default' }: { icon: any; label: string; value: string; detail: string; tone?: 'default' | 'success' | 'warning' }) {
  return <article className={`stats-kpi ${tone}`}><div className="stats-kpi-icon"><Icon size={19}/></div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (value: ViewMode) => void }) {
  return <div className="stats-view-toggle"><button className={value === 'chart' ? 'active' : ''} onClick={() => onChange('chart')}><BarChart3 size={14}/>图表</button><button className={value === 'table' ? 'active' : ''} onClick={() => onChange('table')}><Table2 size={14}/>表格</button></div>
}

function ChartPanel({ title, subtitle, children, onExpand, actions }: { title: string; subtitle?: string; children: any; onExpand?: () => void; actions?: any }) {
  return <section className="stats-panel"><header><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div><div className="stats-panel-actions">{actions}{onExpand && <button className="icon-button subtle" onClick={onExpand} title="放大查看" aria-label={`放大查看${title}`}><Maximize2 size={16}/></button>}</div></header>{children}</section>
}

function DailyTable({ rows, onSelect }: { rows: DailyRow[]; onSelect: (date: string) => void }) {
  return <div className="stats-table-wrap"><table className="stats-table"><thead><tr><th>日期</th><th>计划</th><th>实际</th><th>任务完成</th><th>工作量完成</th><th>延期</th></tr></thead><tbody>{rows.map(row => <tr key={row.date} onClick={() => onSelect(row.date)}><td>{row.shortLabel}</td><td>{minutesText(row.planned)}</td><td>{minutesText(row.actual)}</td><td>{percent(row.taskCompletion)}</td><td>{percent(row.workloadCompletion)}</td><td>{row.lateTasks}</td></tr>)}</tbody></table></div>
}

function actualMinutesForDate(assignments: Assignment[], date: string) {
  const result = new Map<string, number>()
  for (const assignment of assignments) {
    let recorded = 0
    let onDate = 0
    for (const entry of assignment.timeEntries ?? []) {
      const minutes = Math.max(0, Number(entry.minutes) || 0)
      recorded += minutes
      if (safeDate(entry.createdAt) === date) onDate += minutes
    }
    const residual = Math.max(0, assignment.actualMinutes - recorded)
    const fallbackDate = safeDate(assignment.completedAt) ?? assignment.scheduledDate
    if (residual > 0 && fallbackDate === date) onDate += residual
    if (onDate > 0) result.set(assignment.id, onDate)
  }
  return result
}

function DayDetail({ date, assignments, groups, baselines, countWordsTime, onClose }: { date?: string; assignments: Assignment[]; groups: Map<string, TaskGroup>; baselines: DailyPlanBaseline[]; countWordsTime: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!date) return
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.setTimeout(() => dialogRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      activeElement?.focus()
    }
  }, [date, onClose])
  if (!date) return null
  const baseline = baselines.find(item => item.date === date)
  const assignmentMap = new Map(assignments.map(item => [item.id, item]))
  const plannedItems = baseline?.assignments ?? assignments
    .filter(item => item.scheduledDate === date && isActiveGroup(groups.get(item.groupId)))
    .map(item => ({ assignmentId: item.id, groupId: item.groupId, title: item.title, estimatedMinutes: item.estimatedMinutes }))
  const plannedIds = new Set(plannedItems.map(item => item.assignmentId))
  const actualByAssignment = actualMinutesForDate(assignments, date)
  const actualOnly = assignments.filter(item => (actualByAssignment.get(item.id) ?? 0) > 0 && !plannedIds.has(item.id) && isActiveGroup(groups.get(item.groupId)))
  const planned = plannedItems.reduce((sum, item) => sum + (isCountedGroup(groups.get(item.groupId), countWordsTime) ? item.estimatedMinutes : 0), 0)
  const actual = assignments.reduce((sum, item) => sum + (isCountedGroup(groups.get(item.groupId), countWordsTime) ? actualByAssignment.get(item.id) ?? 0 : 0), 0)
  return <div className="stats-detail-backdrop" onMouseDown={onClose}><section ref={dialogRef} tabIndex={-1} className="stats-day-detail" role="dialog" aria-modal="true" aria-label={`${fmtDate(date)}执行详情`} onMouseDown={event => event.stopPropagation()}><header><div><span>{fmtWeekday(date)}</span><h2>{fmtDate(date, 'M月d日')}</h2><p>原计划 {minutesText(planned)} · 当日实际 {minutesText(actual)}</p></div><button className="icon-button" aria-label="关闭日期详情" onClick={onClose}><X size={18}/></button></header>{baseline && <p className="stats-baseline-note">原计划来自 {new Date(baseline.capturedAt).toLocaleString()} 保存的不可变快照。</p>}<div className="stats-day-task-list">{plannedItems.length ? plannedItems.map(plannedItem => { const task = assignmentMap.get(plannedItem.assignmentId); const group = groups.get(plannedItem.groupId); const actualMinutes = actualByAssignment.get(plannedItem.assignmentId) ?? 0; return <article key={plannedItem.assignmentId}><div><span className={`subject-pill subject-${group?.subject ?? '其他'}`}>{group?.subject ?? '其他'}</span><strong>{plannedItem.title}</strong></div><div className="stats-day-task-numbers"><span>原计划 {minutesText(plannedItem.estimatedMinutes)}</span><span>当日实际 {minutesText(actualMinutes)}</span><span>{task?.status === 'done' ? '当前已完成' : task?.status === 'partial' ? `当前进度 ${task.progress}%` : task ? '当前未完成' : '任务已移除'}</span></div></article> }) : <p className="muted-text">当天没有原计划任务。</p>}</div>{actualOnly.length > 0 && <div className="stats-day-extra"><h3>计划外执行</h3><p>这些任务当天有学习流水，但不在当天原计划中。</p>{actualOnly.map(task => { const group = groups.get(task.groupId); return <article key={task.id}><div><span className={`subject-pill subject-${group?.subject ?? '其他'}`}>{group?.subject ?? '其他'}</span><strong>{task.title}</strong></div><span>当日实际 {minutesText(actualByAssignment.get(task.id) ?? 0)}</span></article> })}</div>}</section></div>
}

function FullscreenChart({ title, rows, onClose, onSelect }: { title: string; rows: DailyRow[]; onClose: () => void; onSelect: (date: string) => void }) {
  const [mode, setMode] = useState<ViewMode>('chart')
  return <div className="stats-fullscreen" role="dialog" aria-modal="true" aria-label={`${title}全屏详情`}><header><div><span>统计详情</span><h2>{title}</h2></div><div><ViewToggle value={mode} onChange={setMode}/><button className="icon-button" aria-label="关闭全屏统计" onClick={onClose}><X size={19}/></button></div></header><main>{mode === 'table' ? <DailyTable rows={rows} onSelect={onSelect}/> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} onClick={(event: any) => event?.activePayload?.[0] && onSelect(event.activePayload[0].payload.date)}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="shortLabel"/><YAxis tickFormatter={(value: number) => `${Math.round(value / 60)}h`}/><Tooltip content={<ChartTooltip/>}/><Legend/><Bar dataKey="actual" name="实际" fill="#2563eb" radius={[6, 6, 0, 0]}/><Line type="monotone" dataKey="planned" name="计划" stroke="#94a3b8" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="movingAverage" name="7日均值" stroke="#8b5cf6" strokeWidth={2} dot={false}/></ComposedChart></ResponsiveContainer>}</main></div>
}

export function StatsPage({ onOpenReplan }: StatsPageProps) {
  const { state, updateTimeEntry, deleteTimeEntry } = useApp()
  const [tab, setTab] = useState<StatsTab>('overview')
  const [preset, setPreset] = useState<RangePreset>(() => {
    const saved = window.localStorage.getItem('study-planner:stats-range')
    return saved === 'today' || saved === '7d' || saved === 'week' || saved === 'all' || saved === 'custom' ? saved : '7d'
  })
  const [customStart, setCustomStart] = useState(state.settings.startDate)
  const [customEnd, setCustomEnd] = useState(state.settings.endDate)
  const [heatMetric, setHeatMetric] = useState<HeatMetric>('minutes')
  const [trendView, setTrendView] = useState<ViewMode>('chart')
  const [selectedDate, setSelectedDate] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [expandedSubjects, setExpandedSubjects] = useState<Set<Subject>>(new Set())
  const [planPerspective, setPlanPerspective] = useState<'current'|'history'>('current')
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [ledgerStart, setLedgerStart] = useState(state.settings.startDate)
  const [ledgerEnd, setLedgerEnd] = useState(todayISO())
  const [ledgerEdit, setLedgerEdit] = useState<{ assignmentId: string; entryId: string; minutes: number; date: string }>()

  useEffect(() => { window.localStorage.setItem('study-planner:stats-range', preset) }, [preset])

  const groupMap = useMemo(() => new Map(state.taskGroups.map(group => [group.id, group])), [state.taskGroups])
  const range = rangeForPreset(preset, state.settings.startDate, state.settings.endDate, customStart, customEnd)
  const daily = useMemo(() => aggregateDaily(state.assignments, groupMap, state.settings.countWordsTime, range.start, range.end, state.dailyPlanBaselines), [state.assignments, groupMap, state.settings.countWordsTime, range.start, range.end, state.dailyPlanBaselines])
  const allDaily = useMemo(() => aggregateDaily(state.assignments, groupMap, state.settings.countWordsTime, state.settings.startDate, state.settings.endDate, state.dailyPlanBaselines), [state.assignments, groupMap, state.settings.countWordsTime, state.settings.startDate, state.settings.endDate, state.dailyPlanBaselines])
  const subjectNames = useMemo(() => Array.from(new Set([...SUBJECTS, ...state.settings.customSubjects, ...state.taskGroups.map(group => group.subject)])), [state.settings.customSubjects, state.taskGroups])
  const subjects = useMemo(() => aggregateSubjects(state.assignments, state.taskGroups, state.dailyPlanBaselines, state.settings.countWordsTime, range.start, range.end, subjectNames), [state.assignments, state.taskGroups, state.dailyPlanBaselines, state.settings.countWordsTime, range.start, range.end, subjectNames])
  const goalRows = useMemo(() => allGoalProgress(state), [state.goals, state.assignments, state.taskGroups])
  const durationSuggestions = useMemo(() => allDurationSuggestions(state), [state.assignments, state.taskGroups, state.settings.duration])
  const ledgerRows = useMemo<LedgerRow[]>(() => state.assignments.flatMap(assignment => {
    const group = groupMap.get(assignment.groupId)
    if (!group) return []
    return (assignment.timeEntries ?? []).map(entry => ({ assignmentId: assignment.id, assignmentTitle: assignment.title, groupTitle: group.title, subject: group.subject, entry }))
  }).filter(item => within(safeDate(item.entry.createdAt), ledgerStart, ledgerEnd)).sort((a, b) => b.entry.createdAt.localeCompare(a.entry.createdAt)), [state.assignments, groupMap, ledgerStart, ledgerEnd])

  const totals = useMemo(() => {
    const planned = daily.reduce((sum, row) => sum + row.planned, 0)
    const actual = daily.reduce((sum, row) => sum + row.actual, 0)
    const extra = daily.reduce((sum, row) => sum + row.extraActual, 0)
    const timer = daily.reduce((sum, row) => sum + row.timerActual, 0)
    const manual = daily.reduce((sum, row) => sum + row.manualActual, 0)
    const legacy = daily.reduce((sum, row) => sum + row.legacyActual, 0)
    const tasks = daily.reduce((sum, row) => sum + row.plannedTasks, 0)
    const completed = daily.reduce((sum, row) => sum + row.completedEquivalent, 0)
    const plannedWork = daily.reduce((sum, row) => sum + row.planned, 0)
    const completedWork = daily.reduce((sum, row) => sum + row.planned * row.workloadCompletion / 100, 0)
    return {
      planned, actual, extra, timer, manual, legacy,
      taskCompletion: tasks ? completed / tasks * 100 : 0,
      workloadCompletion: plannedWork ? completedWork / plannedWork * 100 : 0,
      late: daily.reduce((sum, row) => sum + row.lateTasks, 0),
      focusSessions: daily.reduce((sum, row) => sum + row.focusSessions, 0)
    }
  }, [daily])

  const todayRow = allDaily.find(row => row.date === todayISO())
  const learningStreak = calculateStreak(allDaily, row => row.actual >= 30)
  const targetStreak = calculateStreak(allDaily, row => row.planned > 0 ? row.actual >= row.planned * .5 : row.actual >= 30)
  const corePrediction = predictCompletion(state, group => group.priority === 5)
  const overallPrediction = predictCompletion(state)

  const completedCounted = state.assignments.filter(item => {
    const group = groupMap.get(item.groupId)
    return isCountedGroup(group, state.settings.countWordsTime) && item.status === 'done' && item.completedAt && item.scheduledDate
  })
  const onTime = completedCounted.filter(item => safeDate(item.completedAt)! <= item.scheduledDate!).length
  const onTimeRate = completedCounted.length ? onTime / completedCounted.length * 100 : 0
  const changedTasks = state.assignments.filter(item => item.previousDate && isActiveGroup(groupMap.get(item.groupId))).length
  const activeTasks = state.assignments.filter(item => isActiveGroup(groupMap.get(item.groupId))).length
  const changeRate = activeTasks ? changedTasks / activeTasks * 100 : 0
  const carryovers = state.assignments.filter(item => item.scheduleSource === 'carryover' && isActiveGroup(groupMap.get(item.groupId))).length

  const timerEntries = state.assignments.flatMap(item => {
    const group = groupMap.get(item.groupId)
    if (!isCountedGroup(group, state.settings.countWordsTime)) return []
    return (item.timeEntries ?? []).filter(entry => entry.source === 'timer' && entry.minutes >= 1).map(entry => entry.minutes)
  })
  const averageFocus = timerEntries.length ? Math.round(timerEntries.reduce((sum, value) => sum + value, 0) / timerEntries.length) : 0
  const longestFocus = timerEntries.length ? Math.max(...timerEntries) : 0

  const priorityData = [5, 3, 2, 1, 0].map(priority => {
    const ids = new Set(state.taskGroups.filter(group => group.priority === priority && !group.hidden).map(group => group.id))
    const items = state.assignments.filter(item => ids.has(item.groupId))
    return { priority: priority === 5 ? '核心' : priority === 3 ? '高' : priority === 2 ? '中' : priority === 1 ? '低' : '可选', completion: items.length ? items.reduce((sum, item) => sum + progressFraction(item), 0) / items.length * 100 : 0 }
  }).filter(item => item.completion > 0 || item.priority !== '可选')

  const insights = useMemo<InsightItem[]>(() => {
    const result: InsightItem[] = []
    const recent = allDaily.filter(row => row.date <= todayISO()).slice(-7)
    const previous = allDaily.filter(row => row.date <= shiftDate(todayISO(), -7)).slice(-7)
    const recentCompletion = recent.length ? recent.reduce((sum, row) => sum + row.workloadCompletion, 0) / recent.length : 0
    const previousCompletion = previous.length ? previous.reduce((sum, row) => sum + row.workloadCompletion, 0) / previous.length : 0
    const change = recentCompletion - previousCompletion
    if (previous.length && Math.abs(change) >= 5) result.push({ tone: change > 0 ? 'positive' : 'warning', title: `近7天工作量完成率${change > 0 ? '提高' : '下降'} ${Math.abs(Math.round(change))}%`, detail: `当前均值 ${Math.round(recentCompletion)}%，上一个7天均值 ${Math.round(previousCompletion)}%。`, action: change < 0 ? 'replan' : undefined })
    const underestimated = subjects.filter(item => item.accuracy !== undefined && item.accuracy > 10).sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0]
    if (underestimated) result.push({ tone: 'warning', title: `${underestimated.subject}任务平均低估 ${Math.round(underestimated.accuracy!)}%`, detail: `基于 ${underestimated.sampleSize} 个已完成任务，后续排期应预留更多时间。`, action: 'subjects' })
    const weakDays = recent.slice(-3).filter(row => row.planned > 0 && row.actual < row.planned * .5)
    if (weakDays.length >= 2) result.push({ tone: 'warning', title: '最近3天有多天实际学习不足计划一半', detail: `${weakDays.map(row => row.shortLabel).join('、')} 的执行差距较大，建议查看计划调整方案。`, action: 'replan' })
    const riskyGoal = goalRows.find(item => item.latestRisk || item.desiredRisk)
    if (riskyGoal) {
      const goal = state.goals.find(item => item.id === riskyGoal.goalId)
      if (goal) result.push({ tone: 'warning', title: `目标“${goal.title}”存在日期风险`, detail: `预计完成 ${riskyGoal.expectedCompletion ? fmtDate(riskyGoal.expectedCompletion, 'M月d日') : '尚无法判断'}；期望 ${goal.desiredDate ? fmtDate(goal.desiredDate, 'M月d日') : '未设置'}，最晚 ${fmtDate(goal.latestDate, 'M月d日')}。`, action: 'replan' })
    }
    const totalSubjectActual = subjects.reduce((sum, item) => sum + item.actual, 0)
    const dominant = subjects.filter(item => totalSubjectActual > 0 && item.actual / totalSubjectActual > state.settings.subjectShareLimit).sort((a, b) => b.actual - a.actual)[0]
    if (dominant) result.push({ tone: 'neutral', title: `${dominant.subject}占当前范围有效学习时间 ${Math.round(dominant.actual / totalSubjectActual * 100)}%`, detail: '投入较集中，可结合剩余高优先级任务判断是否需要平衡。', action: 'subjects' })
    return result.slice(0, 4)
  }, [allDaily, subjects, state.settings.subjectShareLimit, goalRows, state.goals])

  const positiveHeatMinutes = allDaily.map(row => row.actual).filter(value => value > 0).sort((a, b) => a - b)
  const maxHeatMinutes = positiveHeatMinutes.length ? Math.max(1, positiveHeatMinutes[Math.min(positiveHeatMinutes.length - 1, Math.floor(positiveHeatMinutes.length * .9))]) : 1
  const heatOffset = (getDay(parseISO(state.settings.startDate)) + 6) % 7
  const heatCells: Array<DailyRow | undefined> = [...Array.from({ length: heatOffset }, () => undefined), ...allDaily]
  const subjectRanking = [...subjects].sort((a, b) => b.actual - a.actual)
  const heatLevel = (row: DailyRow) => {
    const value = heatMetric === 'minutes' ? row.actual / maxHeatMinutes : row.workloadCompletion / 100
    if (value <= 0) return 0
    if (value < .25) return 1
    if (value < .5) return 2
    if (value < .75) return 3
    return 4
  }

  const toggleSubject = (subject: Subject) => setExpandedSubjects(current => {
    const next = new Set(current)
    if (next.has(subject)) next.delete(subject)
    else next.add(subject)
    return next
  })

  const rangeLabel = preset === 'today' ? '今日' : preset === '7d' ? '近7天' : preset === 'week' ? '本周' : preset === 'all' ? '全部计划' : `${fmtDate(range.start, 'M.d')}—${fmtDate(range.end, 'M.d')}`

  return <div className="stats-page">
    <section className="plan-perspective-bar"><div className="segmented-control"><button className={planPerspective === 'current' ? 'active' : ''} onClick={() => setPlanPerspective('current')}>目标概览</button><button className={planPerspective === 'history' ? 'active' : ''} onClick={() => setPlanPerspective('history')}>版本概览</button></div><div className="plan-perspective-actions"><span>{planPerspective === 'current' ? '查看当前目标、负载和预计' : `本机保存 ${state.planVersions.length} 个重大版本`}</span><button className="secondary-button" onClick={() => { setLedgerStart(range.start); setLedgerEnd(range.end > todayISO() ? todayISO() : range.end); setLedgerOpen(true) }}><Clock3 size={16}/>时间账本</button></div></section>
    {planPerspective === 'current' ? <section className="stats-goal-overview"><header><div><h2>当前目标概览</h2><p>全局时间与完成总数按任务去重；每个目标仍独立计算自己的条件。</p></div><span>时长建议 {durationSuggestions.length}</span></header><div>{goalRows.length ? goalRows.map(row => { const goal = state.goals.find(item => item.id === row.goalId)!; return <article key={row.goalId}><strong>{goal.title}</strong><span>{row.completedCount}/{row.requiredCount} · {Math.round(row.progress*100)}%</span><small>预计 {row.expectedCompletion ? fmtDate(row.expectedCompletion) : row.completed ? '已完成' : '无法预计'} · 剩余 {minutesText(row.estimatedRemainingMinutes)}</small><em className={row.latestRisk ? 'risk' : row.desiredRisk ? 'warning' : ''}>{row.latestRisk ? '最晚日期风险' : row.desiredRisk ? '期望日期风险' : '正常'}</em></article> }) : <p className="muted-text">暂无目标。</p>}</div></section> : <section className="stats-version-overview"><header><h2>历史计划演变</h2><p>展示重大版本的目标、任务量、负载和移动历史；完整快照仅保存在当前设备。</p></header>{state.planVersions.length ? <div>{[...state.planVersions].reverse().map(version => <article key={version.id}><div><strong>{version.reason}</strong><span>{new Date(version.timestamp).toLocaleString()}</span></div><div><span>目标 {version.summary.goalCount}</span><span>任务组 {version.summary.groupCount}</span><span>任务 {version.summary.assignmentCount}</span><span>完成 {version.summary.completedCount}</span><span>移动 {version.summary.movedTaskCount}</span><span>计划负载 {minutesText(version.summary.scheduledMinutes)}</span></div></article>)}</div> : <p className="muted-text">尚无重大版本。</p>}</section>}
    <section className="stats-toolbar">
      <div className="stats-tabs">{([['overview', '概览'], ['trend', '趋势'], ['subjects', '科目'], ['quality', '执行状态']] as const).map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}</div>
      <div className="stats-range-controls"><select value={preset} onChange={event => setPreset(event.target.value as RangePreset)}><option value="today">今日</option><option value="7d">近7天</option><option value="week">本周</option><option value="all">全部</option><option value="custom">自定义</option></select>{preset === 'custom' && <><input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)}/><span>至</span><input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)}/></>}<em>{rangeLabel}</em></div>
    </section>

    {tab === 'overview' && <>
      <section className="stats-kpi-grid">
        <MetricCard icon={Clock3} label="今日有效学习" value={minutesText(todayRow?.actual ?? 0)} detail={`计划 ${minutesText(todayRow?.planned ?? 0)} · 额外 ${minutesText(todayRow?.extraActual ?? 0)}`} tone={(todayRow?.actual ?? 0) >= (todayRow?.planned ?? Infinity) ? 'success' : 'default'}/>
        <MetricCard icon={CheckCircle2} label={`${rangeLabel}完成率`} value={`${Math.round(totals.taskCompletion)}% / ${Math.round(totals.workloadCompletion)}%`} detail="任务数 / 时间加权" tone={totals.workloadCompletion >= 80 ? 'success' : totals.workloadCompletion < 50 ? 'warning' : 'default'}/>
        <MetricCard icon={Activity} label="累计有效学习" value={minutesText(allDaily.reduce((sum, row) => sum + row.actual, 0))} detail={`当前范围 ${minutesText(totals.actual)} · 不计入统计 ${minutesText(totals.extra)}`}/>
        <MetricCard icon={Target} label="预计完成" value={overallPrediction === '已完成' ? '全部完成' : overallPrediction ? fmtDate(overallPrediction, 'M月d日') : '存在未排期'} detail={`优先级5：${corePrediction === '已完成' ? '已完成' : corePrediction ? fmtDate(corePrediction, 'M月d日') : '待排期'}`} tone={goalRows.some(row => row.latestRisk) ? 'warning' : 'success'}/>
      </section>

      <details className="stats-overview-more"><summary>查看连续记录和学习热力图</summary><div className="stats-overview-more-body">
      <section className="stats-streak-row"><div><Flame size={20}/><strong>{learningStreak} 天</strong><span>连续学习（每天至少30分钟）</span></div><div><Target size={20}/><strong>{targetStreak} 天</strong><span>连续达标（完成计划50%）</span></div><div><Focus size={20}/><strong>{totals.focusSessions} 次</strong><span>{rangeLabel}有效专注 · 平均 {minutesText(averageFocus)}</span></div></section>

      <section className="stats-insights"><header><div><TrendingUp size={20}/><div><h3>本周洞察</h3><p>只展示能影响下一步行动的数据变化。</p></div></div></header><div>{insights.length ? insights.map((item, index) => <article key={index} className={item.tone}><div>{item.tone === 'warning' ? <AlertTriangle size={18}/> : item.tone === 'positive' ? <CheckCircle2 size={18}/> : <Activity size={18}/>}<span><strong>{item.title}</strong><small>{item.detail}</small></span></div>{item.action && <button className="secondary-button" onClick={() => item.action === 'replan' ? onOpenReplan?.(todayISO()) : setTab('subjects')}>{item.action === 'replan' ? '查看调整建议' : '查看科目分析'}<ChevronRight size={15}/></button>}</article>) : <p className="muted-text">积累更多实际记录后，这里会自动产生趋势洞察。</p>}</div></section>

      <ChartPanel title="学习热力图" subtitle={`${state.settings.startDate.slice(5).replace('-', '.')}—${state.settings.endDate.slice(5).replace('-', '.')}，点击日期查看任务`} actions={<div className="stats-segmented"><button className={heatMetric === 'minutes' ? 'active' : ''} onClick={() => setHeatMetric('minutes')}>学习时间</button><button className={heatMetric === 'completion' ? 'active' : ''} onClick={() => setHeatMetric('completion')}>完成率</button></div>}>
        <div className="stats-heatmap-shell"><div className="stats-heat-weekdays"><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span>日</span></div><div className="stats-heatmap">{heatCells.map((row, index) => row ? <button key={row.date} className={`level-${heatLevel(row)}`} onClick={() => setSelectedDate(row.date)} title={`${row.label} · ${heatMetric === 'minutes' ? minutesText(row.actual) : percent(row.workloadCompletion)}`}><span>{Number(row.date.slice(8))}</span><small>{row.date.endsWith('-01') || index === heatOffset ? `${Number(row.date.slice(5, 7))}月` : ''}</small></button> : <i className="heat-empty" key={`empty-${index}`}/>)}</div></div>
        <div className="stats-heat-legend"><span>少</span>{[0,1,2,3,4].map(level => <i key={level} className={`level-${level}`}/>)}<span>多</span></div>
      </ChartPanel>
      </div></details>

      <ChartPanel title="每日计划与实际" subtitle="柱形为真实学习时间，灰线为计划，紫线为7日移动平均" onExpand={() => setExpanded(true)} actions={<ViewToggle value={trendView} onChange={setTrendView}/>}>
        {trendView === 'table' ? <DailyTable rows={daily} onSelect={setSelectedDate}/> : <div className="stats-chart-lg"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={daily} onClick={(event: any) => event?.activePayload?.[0] && setSelectedDate(event.activePayload[0].payload.date)}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="shortLabel" minTickGap={22}/><YAxis tickFormatter={(value: number) => `${Math.round(value / 60)}h`}/><Tooltip content={<ChartTooltip/>}/><Legend/><Bar dataKey="actual" name="实际" fill="#2563eb" radius={[6,6,0,0]}/><Line type="monotone" dataKey="planned" name="计划" stroke="#94a3b8" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="movingAverage" name="7日均值" stroke="#8b5cf6" strokeWidth={2} dot={false}/></ComposedChart></ResponsiveContainer></div>}
      </ChartPanel>
    </>}

    {tab === 'trend' && <>
      <section className="stats-kpi-grid stats-kpi-grid-three"><MetricCard icon={Clock3} label="范围内实际" value={minutesText(totals.actual)} detail={`计划 ${minutesText(totals.planned)}`}/><MetricCard icon={Focus} label="计时与补录" value={`${minutesText(totals.timer)} / ${minutesText(totals.manual)}`} detail={`旧记录未标来源 ${minutesText(totals.legacy)}`}/><MetricCard icon={Activity} label="不计入统计的学习" value={minutesText(totals.extra)} detail="例如默认不计时的单词打卡"/></section>
      <ChartPanel title="学习时间趋势" subtitle="点击数据点查看当天任务" onExpand={() => setExpanded(true)} actions={<ViewToggle value={trendView} onChange={setTrendView}/>}>
        {trendView === 'table' ? <DailyTable rows={daily} onSelect={setSelectedDate}/> : <div className="stats-chart-xl"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={daily} onClick={(event: any) => event?.activePayload?.[0] && setSelectedDate(event.activePayload[0].payload.date)}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="shortLabel" minTickGap={18}/><YAxis/><Tooltip content={<ChartTooltip/>}/><Legend/><Bar dataKey="actual" name="实际" fill="#2563eb" radius={[6,6,0,0]}/><Bar dataKey="extraActual" name="额外学习" fill="#cbd5e1" radius={[6,6,0,0]}/><Line type="monotone" dataKey="planned" name="计划" stroke="#64748b" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="movingAverage" name="7日均值" stroke="#8b5cf6" strokeWidth={2.4} dot={false}/></ComposedChart></ResponsiveContainer></div>}
      </ChartPanel>
      <section className="stats-two-column"><ChartPanel title="完成率趋势" subtitle="同时保留任务数和预计工作量两个口径"><div className="stats-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={daily}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="shortLabel" minTickGap={18}/><YAxis domain={[0,100]} tickFormatter={(value: number) => `${value}%`}/><Tooltip content={<ChartTooltip/>}/><Legend/><Line type="monotone" dataKey="taskCompletion" name="任务完成率" stroke="#2563eb" strokeWidth={2}/><Line type="monotone" dataKey="workloadCompletion" name="工作量完成率" stroke="#16a34a" strokeWidth={2}/></LineChart></ResponsiveContainer></div></ChartPanel><ChartPanel title="专注次数与时长" subtitle="只有新版计时器产生、且不少于1分钟的记录计为有效专注"><div className="stats-chart"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={daily}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="shortLabel" minTickGap={18}/><YAxis yAxisId="time"/><YAxis yAxisId="count" orientation="right" allowDecimals={false}/><Tooltip/><Legend/><Bar yAxisId="time" dataKey="timerActual" name="专注分钟" fill="#8b5cf6" radius={[5,5,0,0]}/><Line yAxisId="count" type="monotone" dataKey="focusSessions" name="专注次数" stroke="#f59e0b" strokeWidth={2}/></ComposedChart></ResponsiveContainer></div></ChartPanel></section>
    </>}

    {tab === 'subjects' && <>
      <ChartPanel title="各科投入排名" subtitle="横向长度更适合手机比较；计划与实际采用同一统计口径"><div className="stats-chart-subject"><ResponsiveContainer width="100%" height="100%"><BarChart data={subjectRanking} layout="vertical" margin={{ left: 6, right: 18 }}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number"/><YAxis type="category" dataKey="subject" width={42}/><Tooltip formatter={(value: number) => minutesText(value)}/><Legend/><Bar dataKey="planned" name="计划" fill="#cbd5e1" radius={[0,6,6,0]}/><Bar dataKey="actual" name="实际" fill="#2563eb" radius={[0,6,6,0]}>{subjectRanking.map(item => <Cell key={item.subject} fill={SUBJECT_COLORS[item.subject] ?? '#64748b'}/>)}</Bar></BarChart></ResponsiveContainer></div></ChartPanel>
      <section className="subject-analytics-list">{subjectRanking.map(item => <article key={item.subject} className="subject-analytics-card"><button className="subject-analytics-head" onClick={() => toggleSubject(item.subject)}><div><span className={`subject-pill subject-${item.subject}`}>{item.subject}</span><strong>{item.done}/{item.total} 已完成</strong></div><div><span>实际 {minutesText(item.actual)}</span><span>计划 {minutesText(item.planned)}</span><span>完成 {Math.round(item.completion)}%</span>{item.accuracy !== undefined && <em className={item.accuracy > 10 ? 'under' : item.accuracy < -10 ? 'over' : 'accurate'}>{item.accuracy > 0 ? `低估 ${Math.round(item.accuracy)}%` : item.accuracy < 0 ? `高估 ${Math.abs(Math.round(item.accuracy))}%` : '预计准确'}</em>}<ChevronRight size={17}/></div></button><div className="subject-progress"><i style={{ width: `${Math.min(100,item.completion)}%`, background: SUBJECT_COLORS[item.subject] ?? '#64748b' }}/></div>{expandedSubjects.has(item.subject) && <div className="subject-group-breakdown">{item.groups.map(group => { const suggestion = durationSuggestions.find(candidate => candidate.groupId === group.id); const sourceGroup = state.taskGroups.find(candidate => candidate.id === group.id); return <div key={group.id}><span><strong>{group.title}</strong><small>{group.done}/{group.total} · 计划 {minutesText(group.planned)} · 实际 {minutesText(group.actual)}</small></span><div className="subject-group-actions">{group.accuracy !== undefined && <em>{group.accuracy > 0 ? `平均低估 ${Math.round(group.accuracy)}%` : `平均高估 ${Math.abs(Math.round(group.accuracy))}%`}</em>}{suggestion && sourceGroup && <span className="muted-text">建议 {suggestion.suggestedEstimate} 分钟（{suggestion.sampleCount} 个有效样本）；可在任务组详情或每日复盘生成可预览方案。</span>}</div></div> })}</div>}</article>)}</section>
      <ChartPanel title="预计时长准确度" subtitle="仅使用至少3个已完成且有实际用时的任务作为正式样本"><div className="accuracy-list">{subjects.filter(item => item.accuracy !== undefined).sort((a,b)=>Math.abs(b.accuracy!)-Math.abs(a.accuracy!)).map(item => <article key={item.subject}><span className={`subject-pill subject-${item.subject}`}>{item.subject}</span><div><strong>{item.accuracy! > 0 ? `平均低估 ${Math.round(item.accuracy!)}%` : `平均高估 ${Math.abs(Math.round(item.accuracy!))}%`}</strong><small>{item.sampleSize} 个已完成任务样本</small></div><div className="accuracy-axis"><i style={{ left: `${Math.max(2,Math.min(98,50+item.accuracy!/2))}%` }}/></div></article>)}{!subjects.some(item => item.accuracy !== undefined) && <p className="muted-text">每个科目至少完成3个有实际用时的任务后，才会显示正式准确度。</p>}</div></ChartPanel>
    </>}

    {tab === 'quality' && <>
      <section className="stats-kpi-grid"><MetricCard icon={CheckCircle2} label="按期完成率" value={percent(onTimeRate)} detail={`${onTime}/${completedCounted.length} 个可判断任务`} tone={onTimeRate >= 80 ? 'success' : 'warning'}/><MetricCard icon={AlertTriangle} label="当前延期" value={`${state.assignments.filter(item => item.scheduledDate && item.scheduledDate < todayISO() && item.status !== 'done' && isActiveGroup(groupMap.get(item.groupId))).length} 项`} detail={`当前范围可见 ${totals.late} 项`} tone={totals.late > 0 ? 'warning' : 'success'}/><MetricCard icon={CalendarDays} label="顺延任务" value={`${carryovers} 项`} detail="由每日复盘顺延等操作产生"/><MetricCard icon={Activity} label="计划变更率" value={percent(changeRate)} detail={`${changedTasks}/${activeTasks} 项保留了最近一次原日期`}/></section>
      <section className="stats-two-column"><ChartPanel title="优先级完成进度" subtitle="部分完成按当前进度折算"><div className="stats-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={priorityData} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" domain={[0,100]} tickFormatter={(value: number) => `${value}%`}/><YAxis type="category" dataKey="priority"/><Tooltip formatter={(value: number) => `${Math.round(value)}%`}/><Bar dataKey="completion" name="完成率" fill="#2563eb" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer></div></ChartPanel><ChartPanel title="专注统计" subtitle="计时与手动补录分开显示"><div className="focus-stat-grid"><div><strong>{minutesText(timerEntries.reduce((sum,value)=>sum+value,0))}</strong><span>专注总时长</span></div><div><strong>{timerEntries.length}</strong><span>有效专注次数</span></div><div><strong>{minutesText(averageFocus)}</strong><span>平均每次</span></div><div><strong>{minutesText(longestFocus)}</strong><span>最长一次</span></div></div></ChartPanel></section>
      <ChartPanel title="每日执行轨迹" subtitle="原计划、部分完成、延期和临时实际投入放在同一张表中"><DailyTable rows={daily} onSelect={setSelectedDate}/></ChartPanel>
      <div className="stats-data-note"><AlertTriangle size={17}/><p><strong>旧数据说明：</strong>旧版本没有记录每次改期历史和时间来源，因此计划变更率只依据当前任务保留的最近一次原日期；计时与手动补录从 v0.5.0 起可以精确区分。</p></div>
    </>}

    <DayDetail date={selectedDate} assignments={state.assignments} groups={groupMap} baselines={state.dailyPlanBaselines} countWordsTime={state.settings.countWordsTime} onClose={() => setSelectedDate(undefined)}/>
    {expanded && <FullscreenChart title="每日计划与实际" rows={daily} onClose={() => setExpanded(false)} onSelect={date => { setExpanded(false); setSelectedDate(date) }}/>} 
    <Modal open={ledgerOpen} title="执行时间账本" onClose={() => { setLedgerOpen(false); setLedgerEdit(undefined) }} wide mobileFullscreen>
      <div className="ledger-toolbar"><div><strong>按实际发生日期归属</strong><span>改期不会重写流水；历史补录会进入你选择的历史日期。</span></div><div><label><span>开始</span><input type="date" value={ledgerStart} onChange={event => setLedgerStart(event.target.value)}/></label><label><span>结束</span><input type="date" value={ledgerEnd} max={todayISO()} onChange={event => setLedgerEnd(event.target.value)}/></label></div></div>
      <div className="ledger-list">{ledgerRows.length ? ledgerRows.map(row => { const editing = ledgerEdit?.entryId === row.entry.id; return <article key={`${row.assignmentId}-${row.entry.id}`} className={editing ? 'editing' : ''}><div className="ledger-main"><span className={`subject-pill subject-${row.subject}`}>{row.subject}</span><div><strong>{row.assignmentTitle}</strong><small>{row.groupTitle}</small></div></div>{editing ? <div className="ledger-edit-grid"><label><span>归属日期</span><input type="date" max={todayISO()} value={ledgerEdit.date} onChange={event => setLedgerEdit({ ...ledgerEdit, date: event.target.value })}/></label><label><span>分钟</span><NumericInput min={0} max={1440} value={ledgerEdit.minutes} onValueChange={minutes => setLedgerEdit({ ...ledgerEdit, minutes })}/></label></div> : <div className="ledger-facts"><strong>{minutesText(row.entry.minutes)}</strong><span>{fmtDate(row.entry.createdAt.slice(0, 10))}</span><small>{row.entry.source === 'timer' ? '计时器' : row.entry.source === 'finish' ? '完成时记录' : row.entry.source === 'inferred' ? '推断记录' : '手动补录'}</small><small>创建于 {new Date(row.entry.originalCreatedAt ?? row.entry.createdAt).toLocaleString()}</small>{row.entry.updatedAt && <small>修改于 {new Date(row.entry.updatedAt).toLocaleString()}</small>}</div>}<div className="ledger-actions">{editing ? <><button className="secondary-button" onClick={() => setLedgerEdit(undefined)}>取消</button><button className="primary-button" disabled={!ledgerEdit.date || ledgerEdit.minutes <= 0} onClick={() => { updateTimeEntry(row.assignmentId, row.entry.id, { date: ledgerEdit.date, minutes: ledgerEdit.minutes }); setLedgerEdit(undefined) }}>保存</button></> : <><button className="icon-button" aria-label={`编辑${row.assignmentTitle}的时间记录`} onClick={() => setLedgerEdit({ assignmentId: row.assignmentId, entryId: row.entry.id, minutes: row.entry.minutes, date: row.entry.createdAt.slice(0, 10) })}><Pencil size={16}/></button><button className="icon-button danger-icon" aria-label={`删除${row.assignmentTitle}的时间记录`} onClick={() => { if (window.confirm(`删除“${row.assignmentTitle}”在 ${fmtDate(row.entry.createdAt.slice(0, 10))} 的 ${row.entry.minutes} 分钟记录？\n\n任务累计实际和统计会同步扣减，审计事件会保留。`)) deleteTimeEntry(row.assignmentId, row.entry.id) }}><Trash2 size={16}/></button></>}</div></article> }) : <div className="empty-state"><Clock3 size={28}/><h3>这个范围还没有时间流水</h3><p>完成任务、手动补录或计时后会显示在这里。</p></div>}</div>
    </Modal>
  </div>
}
