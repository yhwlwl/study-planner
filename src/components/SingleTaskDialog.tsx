import { useEffect, useMemo, useState } from 'react'
import type { AppState, NewTaskDraft, Priority, SchedulingIntent, Subject } from '../types'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'
import type { TaskCreationMode } from './AddTaskDialog'

const presetSubjects: Subject[] = ['语文', '数学', '英语', '物理', '化学', '生物', '其他']
const priorities: Array<{ value: Priority; label: string }> = [
  { value: 5, label: '核心' },
  { value: 3, label: '高' },
  { value: 2, label: '中' },
  { value: 1, label: '低' },
  { value: 0, label: '可选' },
]

export function SingleTaskDialog({ open, state, defaultDate, defaultIntent, initial, creationMode = 'schedule', onClose, onSubmit }: {
  open: boolean
  state: AppState
  defaultDate?: string
  defaultIntent?: SchedulingIntent
  initial?: NewTaskDraft
  creationMode?: TaskCreationMode
  onClose: () => void
  onSubmit: (draft: NewTaskDraft, schedule: boolean) => void
}) {
  const subjects = useMemo(() => Array.from(new Set([...presetSubjects, ...state.settings.customSubjects, ...state.taskGroups.map(group => group.subject)])), [state.settings.customSubjects, state.taskGroups])
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState<Subject>('其他')
  const [customSubject, setCustomSubject] = useState('')
  const [priority, setPriority] = useState<Priority>(3)
  const [minutes, setMinutes] = useState(30)
  const [intent, setIntent] = useState<SchedulingIntent>(defaultIntent ?? (defaultDate ? 'prefer-date' : 'system'))
  const [date, setDate] = useState(defaultDate ?? '')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setSubject(initial?.subject ?? '其他')
    setCustomSubject('')
    setPriority(initial?.priority ?? 3)
    setMinutes(initial?.estimatedMinutes ?? 30)
    setIntent(creationMode === 'schedule' ? (initial?.schedulingIntent ?? defaultIntent ?? (defaultDate ? 'prefer-date' : 'system')) : 'system')
    setDate(initial?.date ?? defaultDate ?? '')
    setNotes(initial?.notes ?? '')
  }, [open, initial, defaultDate, defaultIntent, creationMode])

  const chosenSubject = customSubject.trim() || subject
  const schedule = creationMode === 'schedule'
  const submit = () => {
    if (!title.trim() || (schedule && intent !== 'system' && !date)) return
    onSubmit({
      title: title.trim(),
      standalone: true,
      subject: chosenSubject,
      priority,
      estimatedMinutes: minutes,
      schedulingIntent: schedule ? intent : 'system',
      date: schedule && intent !== 'system' ? date : undefined,
      locked: schedule && intent === 'lock-date',
      notes: notes.trim() || undefined,
    }, schedule)
  }

  const modalTitle = initial
    ? '编辑独立任务'
    : schedule
      ? '添加独立任务并安排'
      : '添加独立任务到录入'

  return <Modal open={open} title={modalTitle} onClose={onClose} wide mobileFullscreen>
    <div className="form-grid">
      <label className="field span-2"><span>任务标题</span><input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：今晚看完第三章" /></label>
      <label className="field"><span>科目／类别</span><select value={subject} onChange={event => { setSubject(event.target.value); setCustomSubject('') }}>{subjects.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="field"><span>自定义类别（可选）</span><input value={customSubject} onChange={event => setCustomSubject(event.target.value)} placeholder="例如：竞赛研究" /></label>
      <label className="field"><span>优先级</span><select value={priority} onChange={event => setPriority(Number(event.target.value) as Priority)}>{priorities.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="field"><span>预计时长（分钟）</span><NumericInput min={1} max={1440} value={minutes} onValueChange={setMinutes} /></label>
      {schedule && <>
        <label className="field"><span>排期方式</span><select value={intent} onChange={event => setIntent(event.target.value as SchedulingIntent)}>
          <option value="system">由系统安排</option>
          <option value="prefer-date">优先安排到指定日期</option>
          <option value="lock-date">锁定在指定日期</option>
        </select></label>
        {intent !== 'system' && <label className="field"><span>指定日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={date} onChange={event => setDate(event.target.value)} /></label>}
      </>}
      <label className="field span-2"><span>备注（可选）</span><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <div className="form-note span-2">{schedule
        ? '提交后会先生成安排预览，确认后才加入正式计划。'
        : '保存后只会加入“录入”，不会进入日历或改变当前计划。'}</div>
    </div>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!title.trim() || (schedule && intent !== 'system' && !date)} onClick={submit}>{schedule ? '生成安排预览' : initial ? '保存修改' : '保存到录入'}</button></div>
  </Modal>
}
