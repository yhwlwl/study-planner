import { useEffect, useMemo, useState } from 'react'
import type { AppState, NewTaskDraft, Priority, SchedulingIntent, Subject } from '../types'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

const presetSubjects: Subject[] = ['语文','数学','英语','物理','化学','生物','其他']
const priorities: Priority[] = [5,3,2,1,0]

export function SingleTaskDialog({ open, state, defaultDate, defaultIntent, onClose, onSubmit }: {
  open: boolean
  state: AppState
  defaultDate?: string
  defaultIntent?: SchedulingIntent
  onClose: () => void
  onSubmit: (draft: NewTaskDraft, schedule: boolean) => void
}) {
  const visibleGroups = useMemo(() => state.taskGroups.filter(group => !group.hiddenStandalone && !group.recurring && group.status !== 'archived'), [state.taskGroups])
  const subjects = useMemo(() => Array.from(new Set([...presetSubjects, ...state.settings.customSubjects, ...state.taskGroups.map(group => group.subject)])), [state.settings.customSubjects, state.taskGroups])
  const [title, setTitle] = useState('')
  const [groupId, setGroupId] = useState('standalone')
  const [subject, setSubject] = useState<Subject>('其他')
  const [customSubject, setCustomSubject] = useState('')
  const [priority, setPriority] = useState<Priority>(3)
  const [minutes, setMinutes] = useState(30)
  const [intent, setIntent] = useState<SchedulingIntent>(defaultIntent ?? (defaultDate ? 'prefer-date' : 'system'))
  const [date, setDate] = useState(defaultDate ?? '')
  const [notes, setNotes] = useState('')
  const [numberingChoice, setNumberingChoice] = useState<'preserve' | 'number-all'>('preserve')

  useEffect(() => {
    if (!open) return
    setTitle('')
    setGroupId('standalone')
    setSubject('其他')
    setCustomSubject('')
    setPriority(3)
    setMinutes(30)
    setIntent(defaultIntent ?? (defaultDate ? 'prefer-date' : 'system'))
    setDate(defaultDate ?? '')
    setNotes('')
    setNumberingChoice('preserve')
  }, [open, defaultDate, defaultIntent])

  const selectedGroup = visibleGroups.find(group => group.id === groupId)
  const selectedGroupAssignments = useMemo(() => selectedGroup ? state.assignments.filter(item => item.groupId === selectedGroup.id) : [], [state.assignments, selectedGroup?.id])
  const becomesMultiItem = Boolean(selectedGroup && selectedGroupAssignments.length === 1)
  useEffect(() => {
    if (selectedGroup) setMinutes(selectedGroup.unitMinutes)
  }, [selectedGroup?.id])

  const chosenSubject = customSubject.trim() || subject
  const submit = (schedule: boolean) => {
    if (!title.trim()) return
    if (schedule && intent !== 'system' && !date) return
    onSubmit({
      title: title.trim(),
      groupId: groupId === 'standalone' ? undefined : groupId,
      standalone: groupId === 'standalone',
      subject: groupId === 'standalone' ? chosenSubject : undefined,
      priority: groupId === 'standalone' ? priority : undefined,
      estimatedMinutes: minutes,
      // “仅保存待安排” deliberately discards the date/lock intent rather than storing
      // a conflicting preferred date inside the formal plan.
      schedulingIntent: schedule ? intent : 'system',
      date: schedule && intent !== 'system' ? date : undefined,
      locked: schedule && intent === 'lock-date',
      notes: notes.trim() || undefined,
      numberingChoice: becomesMultiItem ? numberingChoice : undefined,
    }, schedule)
  }

  return <Modal open={open} title="添加单项任务" onClose={onClose} wide mobileFullscreen>
    <div className="form-grid">
      <label className="field span-2"><span>任务标题</span><input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：整理本周化学错题" /></label>
      <label className="field span-2"><span>归属</span><select value={groupId} onChange={event => setGroupId(event.target.value)}>
        <option value="standalone">独立任务</option>
        {visibleGroups.map(group => <option value={group.id} key={group.id}>{group.subject} · {group.title}</option>)}
      </select></label>
      {!selectedGroup && <>
        <label className="field"><span>科目／类别</span><select value={subject} onChange={event => { setSubject(event.target.value); setCustomSubject('') }}>{subjects.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span>新建自定义类别（可选）</span><input value={customSubject} onChange={event => setCustomSubject(event.target.value)} placeholder="例如：竞赛研究" /></label>
        <label className="field"><span>优先级</span><select value={priority} onChange={event => setPriority(Number(event.target.value) as Priority)}>{priorities.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        <div className="inheritance-preview standalone-preview"><strong>独立任务规则</strong><span>科目：{chosenSubject}</span><span>优先级：{priority}</span><small>系统会在内部创建一个不可见的单项任务组，计时、统计、目标和调度能力与普通任务一致。</small></div>
      </>}
      {selectedGroup && <div className="inheritance-preview span-2">
        <strong>将继承任务组规则</strong>
        <span>科目：{selectedGroup.subject}</span><span>优先级：{selectedGroup.priority}</span>
        <span>每日上限：{selectedGroup.dailyMax ?? '按活动类型'}</span><span>{selectedGroup.highIntensity ? '高强度任务' : '普通强度'}</span>
        <small>标题、预计时长、日期、锁定和备注仍可单独覆盖；关联目标会自动继承。</small>
      </div>}
      {becomesMultiItem && <fieldset className="field span-2 numbering-choice"><legend>这个任务组将首次变成多项任务</legend>
        <label><input type="radio" name="numbering-choice" checked={numberingChoice === 'preserve'} onChange={() => setNumberingChoice('preserve')}/><span><strong>保留现有名称</strong><small>原任务名称不变，新任务使用你填写的标题。</small></span></label>
        <label><input type="radio" name="numbering-choice" checked={numberingChoice === 'number-all'} onChange={() => setNumberingChoice('number-all')}/><span><strong>统一引入编号</strong><small>预览中把原任务改为“{selectedGroup?.title} 01”，新任务为“{selectedGroup?.title} 02”；自定义标题不会被以后自动覆盖。</small></span></label>
      </fieldset>}
      <label className="field"><span>预计时长（分钟）</span><NumericInput min={1} max={1440} value={minutes} onValueChange={setMinutes} /></label>
      <label className="field"><span>排期方式</span><select value={intent} onChange={event => setIntent(event.target.value as SchedulingIntent)}>
        <option value="system">由系统安排</option>
        <option value="prefer-date">优先安排到指定日期</option>
        <option value="lock-date">锁定在指定日期</option>
      </select></label>
      {intent !== 'system' && <label className="field span-2"><span>指定日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={date} onChange={event => setDate(event.target.value)} /></label>}
      <label className="field span-2"><span>备注</span><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="可选" /></label>
      <div className="form-note span-2">创建后立即显示排期建议，不会直接改写日历。锁定日期不可被自动移动；优先日期会形成手动安排保护。每日重复任务组不接收临时单项任务，临时打卡请创建为独立任务。</div>
    </div>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="secondary-button" disabled={!title.trim()} onClick={() => submit(false)}>仅保存为待安排</button><button className="primary-button" disabled={!title.trim() || (intent !== 'system' && !date)} onClick={() => submit(true)}>创建并预览排期</button></div>
  </Modal>
}
