import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CalendarClock, Check, ChevronDown, ChevronUp, Lock,
  RefreshCw, RotateCcw, SlidersHorizontal, Undo2
} from 'lucide-react'
import type {
  AppState, Assignment, DayType, ReplanAudit, ReplanBundle, ReplanRequest,
  ReplanResult, ReplanStrategy, Subject
} from '../types'
import { dateRange, dayTypeLabel, fmtDate, fmtWeekday, getCapacity, minutesText } from '../lib/date'
import { analyzePlan, effectiveMinutes, planningDayLoad } from '../lib/planner'
import { Drawer } from './Drawer'
import { Modal } from './Modal'

type MoveDecision = {
  mode: 'accept' | 'keep' | 'custom'
  date?: string
  lock?: boolean
  previewFixed?: boolean
}

type DayTypeOverride = { type: DayType; customMinutes?: number }
type PreviewSnapshot = {
  decisions: Record<string, MoveDecision>
  acceptedDayTypes: Record<string, boolean>
  dayTypeOverrides: Record<string, DayTypeOverride>
}

type DiffKind = 'same' | 'added' | 'removed' | 'modified'

type DayDiffRow = {
  id: string
  before?: Assignment
  after?: Assignment
  kind: DiffKind
  sourceDate?: string
  destinationDate?: string
}

function assignmentMinutes(state: AppState, assignment: Assignment) {
  const group = state.taskGroups.find(item => item.id === assignment.groupId)
  return group && (group.countInStats || state.settings.countWordsTime) ? effectiveMinutes(assignment) : 0
}

function dayLoad(state: AppState, date: string) {
  return planningDayLoad(state, date)
}

function buildDayDiff(beforeState: AppState, afterState: AppState, date: string): DayDiffRow[] {
  const before = beforeState.assignments.filter(item => item.scheduledDate === date)
  const after = afterState.assignments.filter(item => item.scheduledDate === date)
  const beforeMap = new Map(before.map(item => [item.id, item]))
  const afterMap = new Map(after.map(item => [item.id, item]))
  const ordered = [...before.map(item => item.id), ...after.map(item => item.id).filter(id => !beforeMap.has(id))]

  return ordered.map(id => {
    const oldItem = beforeMap.get(id)
    const newItem = afterMap.get(id)
    if (oldItem && newItem) {
      const modified = oldItem.title !== newItem.title || oldItem.estimatedMinutes !== newItem.estimatedMinutes || oldItem.locked !== newItem.locked
      return { id, before: oldItem, after: newItem, kind: modified ? 'modified' : 'same' }
    }
    if (oldItem) {
      const destinationDate = afterState.assignments.find(item => item.id === id)?.scheduledDate
      return { id, before: oldItem, kind: 'removed', destinationDate }
    }
    const sourceDate = beforeState.assignments.find(item => item.id === id)?.scheduledDate
    return { id, after: newItem, kind: 'added', sourceDate }
  })
}

function taskSubject(state: AppState, assignment?: Assignment): Subject {
  if (!assignment) return '其他'
  return state.taskGroups.find(group => group.id === assignment.groupId)?.subject ?? '其他'
}

function DayDiffPanel({
  date,
  beforeState,
  afterState,
  onlyChanges,
  decisions,
  result,
  onDecision,
  onDragStart,
  compact = false
}: {
  date: string
  beforeState: AppState
  afterState: AppState
  onlyChanges: boolean
  decisions: Record<string, MoveDecision>
  result: ReplanResult
  onDecision: (assignmentId: string, decision: MoveDecision) => void
  onDragStart: (assignmentId: string, event: React.DragEvent) => void
  compact?: boolean
}) {
  const allRows = useMemo(() => buildDayDiff(beforeState, afterState, date), [beforeState, afterState, date])
  const rows = onlyChanges ? allRows.filter(row => row.kind !== 'same') : allRows

  const taskView = (assignment: Assignment | undefined, side: 'before' | 'after', row: DayDiffRow) => {
    if (!assignment) return <div className="diff-empty">—</div>
    const subject = taskSubject(side === 'before' ? beforeState : afterState, assignment)
    const changedClass = row.kind === 'added' && side === 'after' ? 'diff-added' : row.kind === 'removed' && side === 'before' ? 'diff-removed' : row.kind === 'modified' ? 'diff-modified' : ''
    return <div
      className={`diff-task ${changedClass}`}
      draggable={side === 'after' && !assignment.locked}
      onDragStart={event => side === 'after' && onDragStart(assignment.id, event)}
    >
      <div className="diff-task-main">
        <span className={`subject-dot subject-${subject}`}/>
        <div><strong>{assignment.title}</strong><span>{subject} · {minutesText(assignment.estimatedMinutes)}</span></div>
      </div>
      <div className="diff-task-meta">
        {row.kind === 'added' && side === 'after' && <em>＋新增{row.sourceDate ? ` · 来自 ${row.sourceDate}` : ''}</em>}
        {row.kind === 'removed' && side === 'before' && <em>－移除{row.destinationDate ? ` · 移至 ${row.destinationDate}` : ''}</em>}
        {row.kind === 'modified' && <em>≈ 信息变化</em>}
        {assignment.locked && <span><Lock size={12}/>已锁定</span>}
        {assignment.intentStrength === 'manual' && <span>用户手动</span>}
      </div>
    </div>
  }

  return <div className={`day-diff-panel ${compact ? 'day-diff-compact' : ''}`}>
    <div className="day-diff-heading"><span>修改前</span><span>修改后</span></div>
    {rows.length === 0 && <p className="muted-text">当前筛选下没有变化。</p>}
    {rows.map(row => {
      const assignment = row.after ?? row.before
      if (!assignment) return null
      const move = result.moves.find(item => item.assignmentId === assignment.id)
      const decision = decisions[assignment.id] ?? { mode: 'accept' as const }
      const changed = row.kind !== 'same'
      return <article className={`day-diff-row diff-${row.kind}`} key={`${date}-${row.id}`}>
        <div>{taskView(row.before, 'before', row)}</div>
        <div>{taskView(row.after, 'after', row)}</div>
        {changed && <div className="diff-row-actions">
          {move && <div className="diff-reason-block"><span className="diff-reason" title={`${move.reason}；${move.impact}`}>{move.reason}</span>{move.rejectedAlternatives && move.rejectedAlternatives.length > 0 && <details><summary>为什么没有选其他日期</summary>{move.rejectedAlternatives.map(item => <div key={`${move.assignmentId}-${item.date}`}><strong>{item.date}</strong><span>{item.reasons.join('；')}</span></div>)}</details>}</div>}
          <button className={decision.mode === 'accept' ? 'choice-active' : ''} onClick={() => onDecision(assignment.id, { ...decision, mode: 'accept', date: undefined, previewFixed: true })}>接受</button>
          <button className={decision.mode === 'keep' ? 'choice-active' : ''} onClick={() => onDecision(assignment.id, { ...decision, mode: 'keep', date: undefined, previewFixed: true })}>保留原日</button>
          <label className="inline-date-choice"><span>改到</span><input
            type="date"
            min={beforeState.settings.startDate}
            max={beforeState.settings.endDate}
            value={decision.mode === 'custom' ? decision.date ?? '' : ''}
            onChange={event => onDecision(assignment.id, { ...decision, mode: 'custom', date: event.target.value, previewFixed: true })}
          /></label>
          <label className="lock-choice"><input type="checkbox" checked={Boolean(decision.lock)} onChange={event => onDecision(assignment.id, { ...decision, lock: event.target.checked, previewFixed: true })}/><Lock size={14}/>锁定结果</label>
          {decision.previewFixed && <><span className="preview-fixed-badge">本次预览固定</span><button onClick={() => onDecision(assignment.id, { ...decision, previewFixed: false })}>解除固定</button></>}
        </div>}
      </article>
    })}
  </div>
}

export function ReplanDialog({
  bundle, currentState, open, request, onRequestChange, onRegenerate, onClose, onApply
}: {
  bundle?: ReplanBundle
  currentState: AppState
  open: boolean
  request: ReplanRequest
  onRequestChange: (request: ReplanRequest) => void
  onRegenerate: (request?: ReplanRequest) => void
  onClose: () => void
  onApply: (result: ReplanResult, state: AppState, audit: ReplanAudit) => void
}) {
  const [strategy, setStrategy] = useState<ReplanStrategy>('balanced')
  const [decisions, setDecisions] = useState<Record<string, MoveDecision>>({})
  const [acceptedDayTypes, setAcceptedDayTypes] = useState<Record<string, boolean>>({})
  const [dayTypeOverrides, setDayTypeOverrides] = useState<Record<string, DayTypeOverride>>({})
  const [undoStack, setUndoStack] = useState<PreviewSnapshot[]>([])
  const [loadCompareDate, setLoadCompareDate] = useState<string>()
  const [onlyChanges, setOnlyChanges] = useState(false)
  const [expandedDates, setExpandedDates] = useState<string[]>([])
  const [detailDate, setDetailDate] = useState<string>()
  const [debouncedIssues, setDebouncedIssues] = useState<ReturnType<typeof analyzePlan>>([])
  const [dragTargetDate, setDragTargetDate] = useState<string>()

  const activeBundleId = bundle?.scenarios[0]?.id
  const previousBundleId = useRef<string>()
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    if (!bundle) return
    const firstOpen = !wasOpen.current
    const regenerated = wasOpen.current && previousBundleId.current && previousBundleId.current !== activeBundleId
    wasOpen.current = true
    previousBundleId.current = activeBundleId

    if (firstOpen) {
      setDecisions({})
      setAcceptedDayTypes({})
      setDayTypeOverrides({})
      setUndoStack([])
      setExpandedDates([])
      setDetailDate(undefined)
      setLoadCompareDate(undefined)
    } else if (regenerated) {
      setDecisions(previous => Object.fromEntries(Object.entries(previous).filter(([, decision]) => decision.previewFixed)))
      setUndoStack([])
    }

    const modeDefault: ReplanStrategy = currentState.settings.planningMode === 'sprint' ? 'goal' : currentState.settings.planningMode === 'relaxed' ? 'preserve' : 'balanced'
    const preferred = request.strategy ?? modeDefault
    setStrategy(bundle.scenarios.some(item => item.strategy === preferred) ? preferred : bundle.scenarios[0]?.strategy ?? 'balanced')
  }, [activeBundleId, bundle, currentState.settings.planningMode, open, request.strategy])

  const result = bundle?.scenarios.find(item => item.strategy === strategy) ?? bundle?.scenarios[0]
  const protectedBufferDates = useMemo(() => dateRange(currentState.settings.startDate, currentState.settings.endDate)
    .filter(date => date >= request.fromDate)
    .filter(date => {
      const config = currentState.dayConfigs[date]
      return Boolean(config?.isBufferDay && (config.bufferProtected ?? config.userSet))
    }), [currentState.dayConfigs, currentState.settings.endDate, currentState.settings.startDate, request.fromDate])

  const regenerateWith = (patch: Partial<ReplanRequest>) => {
    const nextRequest = { ...request, ...patch }
    onRequestChange(nextRequest)
    onRegenerate(nextRequest)
  }

  const allowConstraintOnce = (date: string, key: string, limit: number) => {
    const overrides = [...(request.limitOverrides ?? []).filter(item => !(item.date === date && item.key === key)), { date, key, limit }]
    regenerateWith({ limitOverrides: overrides })
  }

  const toggleBufferUse = (date: string) => {
    const current = request.allowBufferUseDates ?? []
    const next = current.includes(date) ? current.filter(item => item !== date) : [...current, date]
    regenerateWith({ allowBufferUseDates: next })
  }

  const pushSnapshot = () => setUndoStack(previous => [...previous.slice(-29), {
    decisions: structuredClone(decisions),
    acceptedDayTypes: structuredClone(acceptedDayTypes),
    dayTypeOverrides: structuredClone(dayTypeOverrides)
  }])

  const changeDecision = (assignmentId: string, decision: MoveDecision) => {
    pushSnapshot()
    setDecisions(previous => ({ ...previous, [assignmentId]: decision }))
  }

  const changeDayType = (date: string, override?: DayTypeOverride) => {
    pushSnapshot()
    setDayTypeOverrides(previous => {
      const next = { ...previous }
      if (override) next[date] = override
      else delete next[date]
      return next
    })
  }

  const toggleSuggestedDayType = (date: string, checked: boolean) => {
    pushSnapshot()
    setAcceptedDayTypes(previous => ({ ...previous, [date]: checked }))
  }

  const undoPreview = () => {
    const snapshot = undoStack.at(-1)
    if (!snapshot) return
    setDecisions(snapshot.decisions)
    setAcceptedDayTypes(snapshot.acceptedDayTypes)
    setDayTypeOverrides(snapshot.dayTypeOverrides)
    setUndoStack(previous => previous.slice(0, -1))
  }

  const editedState = useMemo(() => {
    if (!result) return undefined
    const next = structuredClone(result.nextState)
    for (const [assignmentId, decision] of Object.entries(decisions)) {
      const assignment = next.assignments.find(item => item.id === assignmentId)
      const original = currentState.assignments.find(item => item.id === assignmentId)
      if (!assignment) continue
      if (decision.mode === 'keep') {
        assignment.scheduledDate = original?.scheduledDate
        if (original) {
          assignment.scheduleSource = original.scheduleSource
          assignment.intentStrength = original.intentStrength
          assignment.previousDate = original.previousDate
          assignment.lastManualMoveAt = original.lastManualMoveAt
          assignment.locked = original.locked
        }
      } else if (decision.mode === 'custom' && decision.date) {
        assignment.previousDate = original?.scheduledDate
        assignment.scheduledDate = decision.date
        assignment.scheduleSource = 'manual'
        assignment.intentStrength = decision.lock ? 'locked' : 'manual'
        assignment.lastManualMoveAt = new Date().toISOString()
      }
      if (decision.lock) {
        assignment.locked = true
        assignment.intentStrength = 'locked'
      }
    }
    for (const suggestion of result.dayTypeSuggestions) {
      if (!acceptedDayTypes[suggestion.date]) continue
      next.dayConfigs[suggestion.date] = {
        ...(next.dayConfigs[suggestion.date] ?? { date: suggestion.date, type: suggestion.from }),
        type: suggestion.to,
        userSet: true
      }
    }
    for (const [date, override] of Object.entries(dayTypeOverrides)) {
      next.dayConfigs[date] = {
        ...(next.dayConfigs[date] ?? { date, type: 'regular' as DayType }),
        date,
        type: override.type,
        customMinutes: override.type === 'custom' ? override.customMinutes ?? next.settings.regularMinutes : undefined,
        userSet: true
      }
    }
    next.updatedAt = new Date().toISOString()
    return next
  }, [result, decisions, acceptedDayTypes, dayTypeOverrides, currentState])

  useEffect(() => {
    if (!editedState) {
      setDebouncedIssues([])
      return
    }
    const timer = window.setTimeout(() => setDebouncedIssues(analyzePlan(editedState, request.fromDate).slice(0, 12)), 450)
    return () => window.clearTimeout(timer)
  }, [editedState, request.fromDate])

  const liveLoadChanges = useMemo(() => {
    if (!editedState) return []
    const dates = new Set<string>([
      ...dateRange(currentState.settings.startDate, currentState.settings.endDate),
      ...currentState.assignments.map(item => item.scheduledDate).filter(Boolean) as string[],
      ...editedState.assignments.map(item => item.scheduledDate).filter(Boolean) as string[]
    ])
    return [...dates].map(date => ({
      date,
      beforeMinutes: dayLoad(currentState, date),
      afterMinutes: dayLoad(editedState, date),
      beforeCapacity: getCapacity(currentState, date),
      afterCapacity: getCapacity(editedState, date)
    })).filter(change => change.beforeMinutes !== change.afterMinutes || change.beforeCapacity !== change.afterCapacity)
      .sort((a, b) => Math.abs(b.afterMinutes - b.beforeMinutes) - Math.abs(a.afterMinutes - a.beforeMinutes))
  }, [currentState, editedState])

  const changedLoads = liveLoadChanges

  const microDates = useMemo(() => {
    if (!result) return []
    const dates = new Set<string>()
    result.moves.forEach(move => { if (move.from) dates.add(move.from); if (move.to) dates.add(move.to) })
    liveLoadChanges.forEach(change => dates.add(change.date))
    return [...dates].sort()
  }, [result, liveLoadChanges])

  const toggleExpandedDate = (date: string) => setExpandedDates(previous => {
    if (previous.includes(date)) return previous.filter(item => item !== date)
    return [...previous.slice(-2), date]
  })

  const handlePreviewDragStart = (assignmentId: string, event: React.DragEvent) => {
    event.stopPropagation()
    event.dataTransfer.setData('text/replan-assignment-id', assignmentId)
    event.dataTransfer.effectAllowed = 'move'
  }

  const dropPreviewTask = (date: string, event: React.DragEvent) => {
    event.preventDefault()
    const assignmentId = event.dataTransfer.getData('text/replan-assignment-id')
    if (!assignmentId || !editedState) return
    const assignment = editedState.assignments.find(item => item.id === assignmentId)
    if (!assignment || assignment.locked || assignment.scheduledDate === date) return
    changeDecision(assignmentId, { ...(decisions[assignmentId] ?? { mode: 'accept' }), mode: 'custom', date, previewFixed: true })
    setDragTargetDate(undefined)
  }

  const restoreDayType = (date: string) => {
    pushSnapshot()
    setDayTypeOverrides(previous => { const next = { ...previous }; delete next[date]; return next })
    setAcceptedDayTypes(previous => ({ ...previous, [date]: false }))
  }

  const detailOverride = detailDate ? dayTypeOverrides[detailDate] : undefined
  const detailType = detailDate && editedState ? detailOverride?.type ?? editedState.dayConfigs[detailDate]?.type ?? 'regular' : 'regular'

  return <>
    <Modal open={open} title="重排中心 · 先预览，再决定" onClose={onClose} wide>
      <div className="replan-controls">
        <div className="segmented-control">
          <button className={request.mode === 'repair' ? 'active' : ''} onClick={() => onRequestChange({ ...request, mode: 'repair' })}>局部修复</button>
          <button className={request.mode === 'full' ? 'active' : ''} onClick={() => onRequestChange({ ...request, mode: 'full' })}>全面重排</button>
        </div>
        <label className="field compact-field"><span>从哪天开始</span><input type="date" value={request.fromDate} onChange={event => onRequestChange({ ...request, fromDate: event.target.value })}/></label>
        <label className="field compact-field"><span>冻结近期天数</span><input type="number" min="0" max="7" value={request.freezeDays ?? 2} onChange={event => onRequestChange({ ...request, freezeDays: Number(event.target.value) })}/></label>
        <button className="secondary-button" onClick={() => onRegenerate(request)}><RefreshCw size={16}/>重新计算</button>
        <button className="secondary-button" disabled={!undoStack.length} onClick={undoPreview}><Undo2 size={16}/>撤销预览操作</button>
        <p className="replan-control-note">过去日期完全冻结；今天按真实学习时间半冻结。全面重排默认从明天开始，手动安排长期受到保护。</p>
      </div>

      {bundle?.todaySnapshot && <section className="today-replan-snapshot">
        <div><strong>今日执行快照</strong><span>{bundle.todaySnapshot.message}</span></div>
        <div className="today-snapshot-values">
          <span>真实计时 {minutesText(bundle.todaySnapshot.actualMinutes)}</span>
          {bundle.todaySnapshot.inferredMinutes > 0 && <span>推定用时 {minutesText(bundle.todaySnapshot.inferredMinutes)}</span>}
          <span>已完成 {bundle.todaySnapshot.completedCount} 项</span>
          <span>自动剩余 {minutesText(bundle.todaySnapshot.remainingCapacity)}</span>
        </div>
        <div className="today-extra-control">
          <span>从现在起，今天还能接收的新任务：</span>
          {[0, 30, 60].map(minutes => <button key={minutes} className={(request.todayExtraMinutes ?? 0) === minutes ? 'choice-active' : ''} onClick={() => regenerateWith({ todayExtraMinutes: minutes })}>{minutes === 0 ? '今天不再新增' : `还能学${minutes}分钟`}</button>)}
          <label><span>自定义</span><input type="number" min="0" step="10" value={![0, 30, 60].includes(request.todayExtraMinutes ?? 0) ? request.todayExtraMinutes ?? 0 : ''} placeholder="分钟" onChange={event => onRequestChange({ ...request, todayExtraMinutes: Math.max(0, Number(event.target.value)) })}/></label>
        </div>
      </section>}

      {!result || !editedState ? <p>正在计算……</p> : <>
        <div className="scenario-tabs">
          {bundle?.scenarios.map(item => <button key={item.strategy} className={strategy === item.strategy ? 'active' : ''} onClick={() => {
            setStrategy(item.strategy)
            onRequestChange({ ...request, strategy: item.strategy })
            setDecisions({})
            setAcceptedDayTypes({})
            setDayTypeOverrides({})
            setUndoStack([])
          }}>
            <strong>{item.title}</strong><span>{item.description}</span>
          </button>)}
        </div>

        {bundle && bundle.issues.length > 0 && <section className="replan-section detected-section">
          <div className="replan-section-title"><AlertTriangle size={18}/><div><h3>系统检测到的问题</h3><p>这是重排前的现状；是否处理以及采用哪个方案由你决定。</p></div></div>
          <div className="detected-issue-list">{bundle.issues.slice(0, 16).map((issue, index) => <div key={index}>{issue}</div>)}</div>
        </section>}

        <div className="summary-grid replan-summary-grid">
          <div className="metric-card"><span>将移动</span><strong>{result.summary.moved}</strong><small>项任务</small></div>
          <div className="metric-card"><span>改动日期</span><strong>{result.disturbance.changedDays}</strong><small>天</small></div>
          <div className="metric-card"><span>原计划保留率</span><strong>{Math.round(result.disturbance.originalDateRetentionRate * 100)}%</strong><small>越高越少扰动</small></div>
          <div className="metric-card"><span>尚未解决</span><strong>{result.summary.unresolved}</strong><small>项；不会强塞</small></div>
          <div className="metric-card"><span>保留手动安排</span><strong>{result.summary.preservedManual}</strong><small>项</small></div>
          <div className="metric-card"><span>核心任务预计</span><strong>{result.summary.coreAfter ?? '待决定'}</strong><small>原先 {result.summary.coreBefore ?? '未知'}</small></div>
        </div>

        <section className="replan-section">
          <div className="replan-section-title"><SlidersHorizontal size={18}/><div><h3>方案后果</h3><p>这里只说明影响，不替你做决定。</p></div></div>
          <div className="consequence-list">{result.consequences.map((item, index) => <div key={index}>{item}</div>)}</div>
        </section>

        {result.constraintConflicts.length > 0 && <section className="replan-section constraint-conflict-section">
          <div className="replan-section-title"><AlertTriangle size={18}/><div><h3>没有完全合法的位置，需要你选择</h3><p>所有每日上限默认都是硬限制。这里只提供一次性放宽，不会永久改变任务组规则。</p></div></div>
          <div className="constraint-conflict-list">{result.constraintConflicts.map(conflict => <article key={`${conflict.date}-${conflict.key}`}>
            <div><strong>{conflict.date} · {conflict.label}</strong><span>当前需要 {Math.round(conflict.current)}，默认上限 {Math.round(conflict.limit)}；影响 {conflict.affectedAssignmentIds.length} 项任务。</span></div>
            <ul>{conflict.options.map(option => <li key={option}>{option}</li>)}</ul>
            <button className="secondary-button" onClick={() => allowConstraintOnce(conflict.date, conflict.key, conflict.suggestedLimit)}>仅本次放宽到 {conflict.suggestedLimit} 并重算</button>
          </article>)}</div>
        </section>}

        {protectedBufferDates.length > 0 && <section className="replan-section buffer-use-section">
          <div className="replan-section-title"><CalendarClock size={18}/><div><h3>受保护的活动日 / 缓冲日</h3><p>系统默认不会向这些日期增加任务。确有必要时，可以只为本次重排开放某一天；不会永久取消保护。</p></div></div>
          <div className="buffer-use-list">{protectedBufferDates.map(date => {
            const config = currentState.dayConfigs[date]
            const allowed = request.allowBufferUseDates?.includes(date) ?? false
            return <article className={allowed ? 'buffer-use-active' : ''} key={date}>
              <div><strong>{fmtDate(date)} · {fmtWeekday(date)}</strong><span>{config?.availableMinutes === 0 ? '完全休息' : `最多 ${minutesText(getCapacity(currentState, date))}`} · {config?.bufferReason || '用户手动设置'}</span></div>
              <button className={allowed ? 'secondary-button choice-active' : 'secondary-button'} onClick={() => toggleBufferUse(date)}>{allowed ? '恢复保护' : '仅本次允许使用'}</button>
            </article>
          })}</div>
          {(request.allowBufferUseDates?.length ?? 0) > 0 && <p className="buffer-use-warning">开放缓冲日只解除“禁止新增”的保护，仍必须遵守该日可用时间、任务上限和高强度限制。</p>}
        </section>}

        {changedLoads.length > 0 && <section className="replan-section">
          <div className="replan-section-title section-title-with-actions"><CalendarClock size={18}/><div><h3>修改前后负载</h3><p>点击任意日期，查看两栏任务差异并直接接受、否决或改期。</p></div><div className="segmented-control small"><button className={!onlyChanges ? 'active' : ''} onClick={() => setOnlyChanges(false)}>全部任务</button><button className={onlyChanges ? 'active' : ''} onClick={() => setOnlyChanges(true)}>只看变化</button></div></div>
          <div className="load-compare-list">{changedLoads.map(change => {
            const beforeRatio = change.beforeCapacity ? change.beforeMinutes / change.beforeCapacity : 0
            const afterRatio = change.afterCapacity ? change.afterMinutes / change.afterCapacity : 0
            const expanded = loadCompareDate === change.date
            return <div className={`load-compare-item ${expanded ? 'expanded' : ''}`} key={change.date}>
              <button className="load-compare-row" onClick={() => setLoadCompareDate(expanded ? undefined : change.date)}>
                <strong>{fmtDate(change.date)} · {fmtWeekday(change.date)}</strong>
                <div><span>原 {minutesText(change.beforeMinutes)}</span><i style={{ width: `${Math.min(100, beforeRatio * 100)}%` }}/></div>
                <b>→</b>
                <div><span>新 {minutesText(change.afterMinutes)}</span><i className={afterRatio > 1 ? 'over' : ''} style={{ width: `${Math.min(100, afterRatio * 100)}%` }}/></div>
                <small>容量 {minutesText(change.afterCapacity)}</small>
                {expanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
              </button>
              {expanded && <DayDiffPanel
                date={change.date}
                beforeState={currentState}
                afterState={editedState}
                onlyChanges={onlyChanges}
                decisions={decisions}
                result={result}
                onDecision={changeDecision}
                onDragStart={handlePreviewDragStart}
              />}
            </div>
          })}</div>
        </section>}

        {result.dayTypeSuggestions.length > 0 && <section className="replan-section">
          <div className="replan-section-title"><CalendarClock size={18}/><div><h3>日期类型建议</h3><p>默认不应用；勾选或在逐日详情中修改后才会随本次重排生效。</p></div></div>
          <div className="suggestion-list">{result.dayTypeSuggestions.map(suggestion => <label key={suggestion.date} className="suggestion-row">
            <input type="checkbox" checked={Boolean(acceptedDayTypes[suggestion.date])} onChange={event => toggleSuggestedDayType(suggestion.date, event.target.checked)}/>
            <div><strong>{suggestion.date}：{dayTypeLabel[suggestion.from]} → {dayTypeLabel[suggestion.to]}</strong><span>{suggestion.reason}，增加 {minutesText(suggestion.capacityGain)} 容量。</span></div>
          </label>)}</div>
        </section>}

        <section className="replan-section">
          <div className="replan-section-title"><Check size={18}/><div><h3>逐项微调</h3><p>点击日期原地展开，最多同时展开 3 天；任务可拖到另一个已展开日期。</p></div></div>
          <div className="micro-day-list">
            {microDates.length === 0 && <p className="muted-text">这个方案不需要移动任务。</p>}
            {microDates.map(date => {
              const expanded = expandedDates.includes(date)
              const beforeMinutes = dayLoad(currentState, date)
              const afterMinutes = dayLoad(editedState, date)
              const changeCount = buildDayDiff(currentState, editedState, date).filter(row => row.kind !== 'same').length
              return <article
                className={`micro-day-card ${expanded ? 'expanded' : ''} ${dragTargetDate === date ? 'drag-target' : ''}`}
                key={date}
                onDragOver={event => { event.preventDefault(); setDragTargetDate(date) }}
                onDrop={event => dropPreviewTask(date, event)}
              >
                <button className="micro-day-head" onClick={() => toggleExpandedDate(date)}>
                  <div><strong>{fmtDate(date)} · {fmtWeekday(date)}</strong><span>{minutesText(beforeMinutes)} → {minutesText(afterMinutes)} · {changeCount} 项变化</span></div>
                  {expanded ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}
                </button>
                {expanded && <>
                  <DayDiffPanel
                    date={date}
                    beforeState={currentState}
                    afterState={editedState}
                    onlyChanges={false}
                    decisions={decisions}
                    result={result}
                    onDecision={changeDecision}
                    onDragStart={handlePreviewDragStart}
                    compact
                  />
                  <div className="micro-day-footer"><button className="secondary-button" onClick={() => setDetailDate(date)}>详细调整</button></div>
                </>}
              </article>
            })}
          </div>
        </section>

        {debouncedIssues.length > 0 && <section className="replan-section warning-section">
          <div className="replan-section-title"><AlertTriangle size={18}/><div><h3>按当前微调结果检查</h3><p>负载即时更新；阶段目标和复杂风险在停止操作约半秒后刷新。</p></div></div>
          <div className="warning-list">{debouncedIssues.map((issue, index) => <div key={`${issue.date ?? 'all'}-${index}`} className={`warning-item issue-${issue.level}`}>{issue.message}</div>)}</div>
        </section>}

        {result.warnings.length > 0 && <section className="replan-section warning-section">
          <div className="replan-section-title"><AlertTriangle size={18}/><div><h3>仍需注意</h3><p>应用前请查看不能自动消除的风险。</p></div></div>
          <div className="warning-list">{result.warnings.slice(0, 20).map((warning, index) => <div key={index} className="warning-item">{warning}</div>)}</div>
        </section>}

        <div className="modal-actions sticky-actions"><button className="secondary-button" onClick={onClose}>放弃本次重排</button><button className="primary-button" onClick={() => {
          const auditDates = dateRange(currentState.settings.startDate, currentState.settings.endDate).filter(date => {
            const before = currentState.dayConfigs[date]
            const after = editedState.dayConfigs[date]
            return before?.type !== after?.type || before?.customMinutes !== after?.customMinutes || before?.isBufferDay !== after?.isBufferDay || before?.availableMinutes !== after?.availableMinutes || before?.bufferReason !== after?.bufferReason || before?.bufferPreference !== after?.bufferPreference || before?.bufferProtected !== after?.bufferProtected
          })
          const audit: ReplanAudit = {
            strategy,
            decisions: Object.entries(decisions).map(([assignmentId, decision]) => ({ assignmentId, ...decision })),
            dayTypes: auditDates.map(date => ({
              date,
              type: editedState.dayConfigs[date]?.type ?? 'regular',
              customMinutes: editedState.dayConfigs[date]?.customMinutes,
              isBufferDay: editedState.dayConfigs[date]?.isBufferDay,
              availableMinutes: editedState.dayConfigs[date]?.availableMinutes,
              bufferReason: editedState.dayConfigs[date]?.bufferReason,
              bufferPreference: editedState.dayConfigs[date]?.bufferPreference,
              bufferProtected: editedState.dayConfigs[date]?.bufferProtected
            })),
            limitOverrides: request.limitOverrides,
            todayExtraMinutes: request.todayExtraMinutes,
            allowBufferUseDates: request.allowBufferUseDates
          }
          onApply(result, editedState, audit)
        }}>应用全部已接受调整</button></div>
      </>}
    </Modal>

    <Drawer
      open={Boolean(open && detailDate && result && editedState)}
      title={detailDate ? `${fmtDate(detailDate)} · ${fmtWeekday(detailDate)}` : '逐日调整'}
      subtitle="在当前预览内调整；正式应用前不会写入计划。"
      onClose={() => setDetailDate(undefined)}
      wide
    >
      {detailDate && result && editedState && <>
        <div className="drawer-day-controls">
          <label className="field"><span>日期类型</span><select value={detailType} onChange={event => changeDayType(detailDate, { type: event.target.value as DayType, customMinutes: dayTypeOverrides[detailDate]?.customMinutes })}>{(['regular', 'study', 'travel', 'custom'] as DayType[]).map(type => <option value={type} key={type}>{dayTypeLabel[type]}</option>)}</select></label>
          {detailType === 'custom' && <label className="field"><span>自定义容量（分钟）</span><input type="number" value={dayTypeOverrides[detailDate]?.customMinutes ?? getCapacity(editedState, detailDate)} onChange={event => changeDayType(detailDate, { type: 'custom', customMinutes: Number(event.target.value) })}/></label>}
          <div className="day-type-impact">
            <span>原容量 {minutesText(getCapacity(currentState, detailDate))}</span>
            <b>→</b>
            <span>当前容量 {minutesText(getCapacity(editedState, detailDate))}</span>
            <em>{dayLoad(editedState, detailDate) > getCapacity(editedState, detailDate) ? `超载 ${minutesText(dayLoad(editedState, detailDate) - getCapacity(editedState, detailDate))}` : '当前不超载'}</em>
          </div>
        </div>
        <DayDiffPanel
          date={detailDate}
          beforeState={currentState}
          afterState={editedState}
          onlyChanges={onlyChanges}
          decisions={decisions}
          result={result}
          onDecision={changeDecision}
          onDragStart={handlePreviewDragStart}
        />
        <div className="drawer-actions"><button className="secondary-button" onClick={() => restoreDayType(detailDate)}><RotateCcw size={15}/>恢复原日期类型</button><button className="primary-button" onClick={() => setDetailDate(undefined)}>完成本日微调</button></div>
      </>}
    </Drawer>
  </>
}
