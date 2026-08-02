import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { AppState, CalendarConstraint, CalendarConstraintKind, PlanChangeEvent } from '../types'
import { useApp } from '../AppContext'
import { uid } from '../lib/id'
import { fmtDate } from '../lib/date'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

export function CalendarConstraintManager({ onPrepared }: { onPrepared: (state: AppState, event: PlanChangeEvent) => void }) {
  const { state, prepareCalendarConstraintChange, updateCalendarConstraintMetadata } = useApp()
  const [editing, setEditing] = useState<CalendarConstraint | null | undefined>()
  const submit = (constraint: CalendarConstraint) => {
    const existing = state.calendarConstraints.find(item => item.id === constraint.id)
    const sameShape = Boolean(existing
      && existing.startDate === constraint.startDate
      && existing.endDate === constraint.endDate
      && existing.kind === constraint.kind
      && existing.capacityMinutes === constraint.capacityMinutes
      && existing.protected === constraint.protected)
    if (existing && sameShape) {
      // 仅备注名称变化属于纯展示元数据：直接保存，不触发调度/冲突/方案/版本；无变化则只关闭。
      if (existing.reason !== constraint.reason) updateCalendarConstraintMetadata(existing.id, constraint.reason ?? '')
      setEditing(undefined)
      return
    }
    const prepared = prepareCalendarConstraintChange(constraint)
    setEditing(undefined)
    onPrepared(prepared.state, prepared.event)
  }
  return <section className="settings-section constraint-manager"><div><h2>日期可用性与保护</h2><p>统一管理休息、行程、降容、特殊容量和受保护缓冲日；支持整段日期。</p></div><div>
    <button className="primary-button" onClick={() => setEditing(null)}><Plus size={16}/>添加日期约束</button>
    <div className="constraint-list">{state.calendarConstraints.length === 0 ? <p className="muted-text">暂无日期约束。</p> : state.calendarConstraints.slice().sort((a,b) => a.startDate.localeCompare(b.startDate)).map(item => <article key={item.id}><div><strong>{item.reason || constraintLabel(item.kind)}</strong><span>{fmtDate(item.startDate)}{item.endDate !== item.startDate ? ` 至 ${fmtDate(item.endDate)}` : ''}</span><small>{constraintLabel(item.kind)}{item.capacityMinutes != null ? ` · ${item.capacityMinutes}分钟` : ''}{item.protected ? ' · 日期保护' : ''}</small></div><div className="row-actions"><button className="secondary-button" onClick={() => setEditing(item)}>编辑</button><button className="icon-button danger" aria-label={`移除日期约束${item.reason || constraintLabel(item.kind)}`} onClick={() => { const prepared = prepareCalendarConstraintChange(undefined, item.id); onPrepared(prepared.state, prepared.event) }}><Trash2 size={16}/></button></div></article>)}</div>
    <ConstraintDialog open={editing !== undefined} initial={editing ?? undefined} state={state} onClose={() => setEditing(undefined)} onSave={submit}/>

  </div></section>
}

function ConstraintDialog({ open, initial, state, onClose, onSave }: { open: boolean; initial?: CalendarConstraint; state: AppState; onClose: () => void; onSave: (value: CalendarConstraint) => void }) {
  const [startDate, setStartDate] = useState(initial?.startDate ?? state.settings.startDate)
  const [endDate, setEndDate] = useState(initial?.endDate ?? initial?.startDate ?? state.settings.startDate)
  const [kind, setKind] = useState<CalendarConstraintKind>(initial?.kind ?? 'unavailable')
  const [capacity, setCapacity] = useState(initial?.capacityMinutes ?? 0)
  const [protectedDate, setProtectedDate] = useState(initial?.protected ?? true)
  const [reason, setReason] = useState(initial?.reason ?? '')
  const key = `${open}-${initial?.id ?? 'new'}`
  useEffect(() => {
    setStartDate(initial?.startDate ?? state.settings.startDate)
    setEndDate(initial?.endDate ?? initial?.startDate ?? state.settings.startDate)
    setKind(initial?.kind ?? 'unavailable')
    setCapacity(initial?.capacityMinutes ?? 0)
    setProtectedDate(initial?.protected ?? true)
    setReason(initial?.reason ?? '')
  }, [key, initial, state.settings.startDate])
  const needsCapacity = kind === 'reduced-capacity' || kind === 'special-capacity' || kind === 'protected-buffer'
  const submit = () => { if (!startDate || !endDate || startDate > endDate) return; const now = new Date().toISOString(); onSave({ id: initial?.id ?? uid('constraint'), startDate, endDate, kind, capacityMinutes: needsCapacity ? capacity : kind === 'unavailable' ? 0 : undefined, protected: protectedDate || kind === 'protected-buffer', reason: reason.trim() || constraintLabel(kind), preference: kind === 'protected-buffer' ? 'preserve' : undefined, createdAt: initial?.createdAt ?? now, updatedAt: now }) }
  return <Modal open={open} title={initial ? '编辑日期约束' : '添加日期约束'} onClose={onClose} wide mobileFullscreen><div className="form-grid"><label className="field"><span>开始日期</span><input type="date" value={startDate} onChange={event => { setStartDate(event.target.value); if (endDate < event.target.value) setEndDate(event.target.value) }}/></label><label className="field"><span>结束日期</span><input type="date" value={endDate} min={startDate} onChange={event => setEndDate(event.target.value)}/></label><label className="field span-2"><span>类型</span><select value={kind} onChange={event => setKind(event.target.value as CalendarConstraintKind)}><option value="unavailable">完全不可用／休息／行程</option><option value="reduced-capacity">降低容量</option><option value="special-capacity">特殊容量</option><option value="protected-buffer">受保护缓冲日</option><option value="note">仅记录说明</option></select></label>{needsCapacity && <label className="field"><span>可用分钟</span><NumericInput min={0} max={1440} value={capacity} onValueChange={setCapacity}/></label>}<label className="field checkbox-field"><input type="checkbox" checked={protectedDate} onChange={event => setProtectedDate(event.target.checked)}/><span>保护日期（接收或移出任务需明确例外）</span></label><label className="field span-2"><span>原因</span><input value={reason} onChange={event => setReason(event.target.value)} placeholder="例如：旅行、校内活动、完整休息" /></label><div className="form-note span-2">应用后先列出受影响任务和目标风险，再生成方案；“减少任务”只会重排，绝不删除。</div></div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!startDate || !endDate || startDate > endDate} onClick={submit}>预览影响</button></div></Modal>
}
function constraintLabel(kind: CalendarConstraintKind) { return kind === 'unavailable' ? '不可用' : kind === 'reduced-capacity' ? '降低容量' : kind === 'special-capacity' ? '特殊容量' : kind === 'protected-buffer' ? '受保护缓冲日' : '日期说明' }
