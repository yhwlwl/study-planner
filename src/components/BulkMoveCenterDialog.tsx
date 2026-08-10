import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, CalendarDays, CheckCircle2, Search } from 'lucide-react'
import type { AppState, PlanChangeEvent } from '../types'
import { cloneActiveState } from '../lib/state'
import { fmtDate, minutesText, shiftDate, todayISO } from '../lib/date'
import { uid } from '../lib/id'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

type MoveMode = 'target' | 'shift'

export function BulkMoveCenterDialog({ open, state, onClose, onPrepared }: {
  open: boolean
  state: AppState
  onClose: () => void
  onPrepared: (prepared: AppState, event: PlanChangeEvent) => void
}) {
  const [mode, setMode] = useState<MoveMode>('target')
  const [targetDate, setTargetDate] = useState(todayISO())
  const [shiftDays, setShiftDays] = useState(1)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const groups = useMemo(() => new Map(state.taskGroups.map(group => [group.id, group])), [state.taskGroups])
  const movable = useMemo(() => state.assignments.filter(item => {
    const group = groups.get(item.groupId)
    if (!group || group.recurring || item.status === 'done' || item.locked || state.timer.assignmentId === item.id) return false
    if (mode === 'shift' && !item.scheduledDate) return false
    return true
  }), [groups, mode, state.assignments, state.timer.assignmentId])
  const filtered = useMemo(() => movable.filter(item => {
    if (!query.trim()) return true
    const group = groups.get(item.groupId)
    return `${item.title} ${group?.title ?? ''} ${group?.subject ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
  }), [groups, movable, query])
  const previewTargets = useMemo(() => selectedIds.map(id => {
    const item = state.assignments.find(candidate => candidate.id === id)
    if (!item) return undefined
    const next = mode === 'target' ? targetDate : item.scheduledDate ? shiftDate(item.scheduledDate, Math.round(shiftDays)) : undefined
    return { item, next }
  }).filter((value): value is { item: AppState['assignments'][number]; next: string | undefined } => Boolean(value)), [mode, selectedIds, shiftDays, state.assignments, targetDate])
  const invalidTargets = previewTargets.filter(item => !item.next || item.next < state.settings.startDate || item.next > state.settings.endDate)
  const changes = previewTargets.filter(item => item.item.scheduledDate !== item.next)

  useEffect(() => {
    if (!open) return
    setMode('target')
    setTargetDate(todayISO() < state.settings.startDate ? state.settings.startDate : todayISO() > state.settings.endDate ? state.settings.endDate : todayISO())
    setShiftDays(1)
    setQuery('')
    setSelectedIds([])
  }, [open, state.settings.endDate, state.settings.startDate])

  useEffect(() => {
    setSelectedIds(previous => previous.filter(id => movable.some(item => item.id === id)))
  }, [movable])

  const toggle = (id: string) => setSelectedIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
  const selectVisible = () => setSelectedIds(previous => Array.from(new Set([...previous, ...filtered.map(item => item.id)])))
  const clearSelection = () => setSelectedIds([])

  const submit = () => {
    if (!selectedIds.length || invalidTargets.length || !changes.length) return
    const next = cloneActiveState(state)
    const movedAt = new Date().toISOString()
    const affectedDates = new Set<string>()
    const affectedGroupIds = new Set<string>()
    const movedIds: string[] = []
    for (const change of changes) {
      const item = next.assignments.find(candidate => candidate.id === change.item.id)
      if (!item || !change.next) continue
      if (item.scheduledDate) affectedDates.add(item.scheduledDate)
      affectedDates.add(change.next)
      item.previousDate = item.scheduledDate
      item.scheduledDate = change.next
      item.lastManualMoveAt = movedAt
      item.scheduleSource = 'manual'
      item.intentStrength = 'manual'
      item.updatedAt = movedAt
      movedIds.push(item.id)
      affectedGroupIds.add(item.groupId)
    }
    if (!movedIds.length) return
    const affectedGoalIds = next.goals.filter(goal => goal.linkedTaskGroupIds.some(id => affectedGroupIds.has(id)) || goal.linkedAssignmentIds.some(id => movedIds.includes(id)) || goal.completionConditions.some(condition => affectedGroupIds.has(condition.groupId))).map(goal => goal.id)
    const event: PlanChangeEvent = {
      id: uid('event'), type: 'bulk-move', action: 'repair',
      title: mode === 'target' ? '批量移动任务到指定日期' : `批量顺延任务 ${Math.abs(Math.round(shiftDays))} 天`,
      description: mode === 'target'
        ? `用户指定把 ${movedIds.length} 项任务移到 ${targetDate}；先执行这次局部移动，再完整校验容量、上限、目标和日期保护。`
        : `用户指定把 ${movedIds.length} 项任务整体${shiftDays >= 0 ? '顺延' : '提前'} ${Math.abs(Math.round(shiftDays))} 天；先执行这次局部移动，再完整校验计划影响。`,
      affectedGoalIds, affectedGroupIds: Array.from(affectedGroupIds), affectedAssignmentIds: movedIds,
      affectedDates: Array.from(affectedDates).sort(), createdAt: movedAt,
      metadata: {
        explicitLocalOperation: true, operationScope: 'requested-change-only',
        requestedChangeLabel: mode === 'target' ? `仅移动 ${movedIds.length} 项任务到 ${targetDate}` : `仅${shiftDays >= 0 ? '顺延' : '提前'} ${movedIds.length} 项任务 ${Math.abs(Math.round(shiftDays))} 天`,
        requestedDate: mode === 'target' ? targetDate : undefined, shiftDays: mode === 'shift' ? Math.round(shiftDays) : undefined,
        moveMode: mode, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'],
      },
    }
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = movedAt
    onClose()
    onPrepared(next, event)
  }

  return <Modal open={open} title="批量移动任务" onClose={onClose} wide mobileFullscreen>
    <div className="direct-operation-dialog bulk-move-center-dialog">
    <section className="direct-operation-intro"><div className="direct-operation-icon"><ArrowUpRight size={20} /></div><div><strong>明确选择要移动的任务</strong><p>已完成、锁定、正在计时和循环任务不会进入列表。下一步会先展示精确移动结果，再检查新冲突。</p></div></section>
      <div className="bulk-move-mode"><button type="button" className={mode === 'target' ? 'active' : ''} onClick={() => setMode('target')}><strong>移到某天</strong><span>选中的任务都移动到同一天</span></button><button type="button" className={mode === 'shift' ? 'active' : ''} onClick={() => setMode('shift')}><strong>顺延 N 天</strong><span>每项任务按照自己的原日期整体移动</span></button></div>
      <div className="bulk-move-controls">
        {mode === 'target' ? <label className="field"><span>目标日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={targetDate} onChange={event => setTargetDate(event.target.value)} /></label> : <label className="field"><span>顺延／提前天数</span><NumericInput min={-60} max={60} value={shiftDays} onValueChange={setShiftDays} /><small>正数是顺延，负数是提前；未安排日期不会参与。</small></label>}
        <div className="bulk-move-selection-actions"><span>已选 {selectedIds.length} 项</span><button type="button" className="text-button" onClick={selectVisible}>全选当前列表</button><button type="button" className="text-button" onClick={clearSelection}>清空</button></div>
      </div>
      <div className="bulk-move-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索任务、任务组或科目" /></div>
      <div className="bulk-move-task-list">{filtered.length ? filtered.map(item => {
        const group = groups.get(item.groupId)
        const checked = selectedIds.includes(item.id)
        const next = previewTargets.find(candidate => candidate.item.id === item.id)?.next
        return <label key={item.id} className={`bulk-move-task-row ${checked ? 'selected' : ''}`}><input type="checkbox" checked={checked} onChange={() => toggle(item.id)} /><span className="bulk-move-task-copy"><strong>{item.title}</strong><span>{group?.subject} · {group?.title} · {minutesText(item.estimatedMinutes)}</span></span><span className="bulk-move-task-date">{item.scheduledDate ? fmtDate(item.scheduledDate) : '未安排'}<ArrowUpRight size={14} />{next ?? '—'}</span></label>
      }) : <div className="direct-operation-empty compact"><CheckCircle2 size={24} /><strong>没有可移动的任务</strong><span>{mode === 'shift' ? '顺延模式只显示已有日期的未完成任务。' : '当前没有未完成、未锁定且不在计时中的任务。'}</span></div>}</div>
      <div className="bulk-move-summary"><CalendarDays size={17} /><span>{changes.length ? `本次将移动 ${changes.length} 项任务。` : '选择任务后，这里会显示本次将发生的移动。'}{invalidTargets.length ? ` 有 ${invalidTargets.length} 项会超出计划日期范围，请调整目标。` : ''}</span></div>
      <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!selectedIds.length || Boolean(invalidTargets.length) || !changes.length} onClick={submit}>预览批量移动</button></div>
    </div>
  </Modal>
}
