import { useEffect, useMemo, useState } from 'react'
import type { AppState, NewTaskDraft, SchedulingIntent } from '../types'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

export function SingleTaskDialog({ open, state, defaultDate, defaultIntent, onClose, onSubmit }: {
  open: boolean
  state: AppState
  defaultDate?: string
  defaultIntent?: SchedulingIntent
  onClose: () => void
  onSubmit: (draft: NewTaskDraft) => void
}) {
  const visibleGroups = useMemo(() => state.taskGroups.filter(group => !group.hiddenStandalone && group.status !== 'archived'), [state.taskGroups])
  const [title, setTitle] = useState('')
  const [groupId, setGroupId] = useState('standalone')
  const [minutes, setMinutes] = useState(30)
  const [intent, setIntent] = useState<SchedulingIntent>(defaultIntent ?? (defaultDate ? 'prefer-date' : 'system'))
  const [date, setDate] = useState(defaultDate ?? '')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle('')
    setGroupId('standalone')
    setMinutes(30)
    setIntent(defaultIntent ?? (defaultDate ? 'prefer-date' : 'system'))
    setDate(defaultDate ?? '')
    setNotes('')
  }, [open, defaultDate, defaultIntent])

  const selectedGroup = visibleGroups.find(group => group.id === groupId)
  useEffect(() => {
    if (selectedGroup) setMinutes(selectedGroup.unitMinutes)
  }, [selectedGroup?.id])

  const submit = () => {
    if (!title.trim()) return
    if (intent !== 'system' && !date) return
    onSubmit({
      title: title.trim(),
      groupId: groupId === 'standalone' ? undefined : groupId,
      standalone: groupId === 'standalone',
      estimatedMinutes: minutes,
      schedulingIntent: intent,
      date: intent === 'system' ? undefined : date,
      locked: intent === 'lock-date',
      notes: notes.trim() || undefined,
    })
  }

  return <Modal open={open} title="添加单项任务" onClose={onClose} wide mobileFullscreen>
    <div className="form-grid">
      <label className="field span-2"><span>任务标题</span><input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：整理本周化学错题" /></label>
      <label className="field span-2"><span>归属</span><select value={groupId} onChange={event => setGroupId(event.target.value)}>
        <option value="standalone">独立任务</option>
        {visibleGroups.map(group => <option value={group.id} key={group.id}>{group.subject} · {group.title}</option>)}
      </select></label>
      {selectedGroup && <div className="inheritance-preview span-2">
        <strong>将继承任务组规则</strong>
        <span>科目：{selectedGroup.subject}</span><span>优先级：{selectedGroup.priority}</span>
        <span>每日上限：{selectedGroup.dailyMax ?? '按活动类型'}</span><span>{selectedGroup.highIntensity ? '高强度任务' : '普通强度'}</span>
        <small>标题、预计时长、日期、锁定和备注仍可单独覆盖；关联目标会自动继承。</small>
      </div>}
      <label className="field"><span>预计时长（分钟）</span><NumericInput min={1} max={1440} value={minutes} onValueChange={setMinutes} /></label>
      <label className="field"><span>排期方式</span><select value={intent} onChange={event => setIntent(event.target.value as SchedulingIntent)}>
        <option value="system">由系统安排</option>
        <option value="prefer-date">优先安排到指定日期</option>
        <option value="lock-date">锁定在指定日期</option>
      </select></label>
      {intent !== 'system' && <label className="field span-2"><span>指定日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={date} onChange={event => setDate(event.target.value)} /></label>}
      <label className="field span-2"><span>备注</span><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="可选" /></label>
      <div className="form-note span-2">创建后立即显示排期建议，不会直接改写日历。锁定日期不可被自动移动；优先日期会形成手动安排保护。</div>
    </div>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!title.trim() || (intent !== 'system' && !date)} onClick={submit}>创建并预览排期</button></div>
  </Modal>
}
