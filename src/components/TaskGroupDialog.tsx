import { useEffect, useMemo, useState } from 'react'
import type { AppState, Priority, Subject, TaskActivityType, TaskGroup, TaskGroupDraft } from '../types'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

const presetSubjects: Subject[] = ['语文','数学','英语','物理','化学','生物','其他']
const priorities: Priority[] = [5,3,2,1,0]
const activityOptions: { value: TaskActivityType; label: string }[] = [
  { value: 'normal', label: '普通任务' }, { value: 'classical-study', label: '文言文学习（默认每天最多4次）' },
  { value: 'classical-dictation', label: '文言文默写（默认每天最多1篇）' }, { value: 'recitation', label: '正式背诵（默认每天最多1次）' },
  { value: 'chem-preview', label: '化学预习课（默认每天最多1节）' }, { value: 'math-paper', label: '数学整套试卷（默认每天最多1套）' },
]

export function TaskGroupDialog({ open, onClose, state, initial, onCreate, onEdit }: {
  open: boolean
  onClose: () => void
  state: AppState
  initial?: TaskGroup
  onCreate: (draft: TaskGroupDraft, schedule: boolean) => void
  onEdit?: (group: TaskGroup, numberingChoice: 'preserve' | 'number-all') => void
}) {
  const subjects = useMemo(() => Array.from(new Set([...presetSubjects, ...state.settings.customSubjects, ...state.taskGroups.map(group => group.subject)])), [state])
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState<Subject>('其他')
  const [priority, setPriority] = useState<Priority>(3)
  const [quantity, setQuantity] = useState(1)
  const [minutes, setMinutes] = useState(30)
  const [dailyMax, setDailyMax] = useState<number | undefined>()
  const [activityType, setActivityType] = useState<TaskActivityType>('normal')
  const [highIntensity, setHighIntensity] = useState(false)
  const [countInStats, setCountInStats] = useState(true)
  const [notes, setNotes] = useState('')
  const [goalIds, setGoalIds] = useState<string[]>([])
  const [customSubject, setCustomSubject] = useState('')
  const [numberingChoice, setNumberingChoice] = useState<'preserve' | 'number-all'>('preserve')

  useEffect(() => {
    if (!open) return
    setTitle(initial?.title ?? '')
    setSubject(initial?.subject ?? '其他')
    setPriority(initial?.priority ?? 3)
    setQuantity(initial?.sourceQuantity ?? initial?.quantity ?? 1)
    setMinutes(initial?.unitMinutes ?? 30)
    setDailyMax(initial?.dailyMax)
    setActivityType(initial?.activityType ?? 'normal')
    setHighIntensity(Boolean(initial?.highIntensity))
    setCountInStats(initial?.countInStats ?? true)
    setNotes(initial?.notes ?? '')
    setGoalIds(state.goals.filter(goal => goal.linkedTaskGroupIds.includes(initial?.id ?? '')).map(goal => goal.id))
    setCustomSubject('')
    setNumberingChoice('preserve')
  }, [open, initial, state.goals])

  const chosenSubject = customSubject.trim() || subject
  const initialItemCount = initial ? state.assignments.filter(item => item.groupId === initial.id).length : 0
  const becomesMultiItem = Boolean(initial && !initial.recurring && initialItemCount === 1 && quantity > 1)
  const draft = (): TaskGroupDraft => ({ title: title.trim(), subject: chosenSubject, priority, unitMinutes: minutes, activityType, dailyMax, highIntensity, countInStats, quantity, notes: notes.trim() || undefined, goalIds, numberingChoice })
  const create = (schedule: boolean) => { if (!title.trim()) return; onCreate(draft(), schedule) }
  const edit = () => {
    if (!initial || !onEdit || !title.trim()) return
    onEdit({ ...initial, title: title.trim(), subject: chosenSubject, priority, quantity, unitMinutes: minutes, dailyMax, activityType, highIntensity, countInStats, notes: notes.trim() || undefined }, numberingChoice)
    onClose()
  }

  return <Modal open={open} title={initial ? '编辑任务组' : '创建任务组'} onClose={onClose} wide mobileFullscreen>
    <div className="form-grid">
      <label className="field span-2"><span>任务组名称</span><input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：化学预习" /></label>
      <label className="field"><span>科目／类别</span><select value={subject} onChange={event => { setSubject(event.target.value); setCustomSubject('') }}>{subjects.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="field"><span>新建自定义类别（可选）</span><input value={customSubject} onChange={event => setCustomSubject(event.target.value)} placeholder="例如：竞赛研究" /></label>
      <label className="field"><span>优先级</span><select value={priority} onChange={event => setPriority(Number(event.target.value) as Priority)}>{priorities.map(item => <option key={item} value={item}>{item === 5 ? '核心' : item === 3 ? '高' : item === 2 ? '中' : item === 1 ? '低' : '可选'}</option>)}</select></label>
      <label className="field"><span>数量</span><NumericInput min={1} max={999} value={quantity} onValueChange={setQuantity}/></label>
      <label className="field"><span>单项预计（分钟）</span><NumericInput min={1} max={1440} value={minutes} onValueChange={setMinutes}/></label>
      <details className="form-advanced span-2"><summary>高级规则</summary><div className="form-grid">
        <label className="field"><span>每日最多数量</span><NumericInput min={1} max={99} value={dailyMax} placeholder="使用活动类型默认上限" onValueChange={setDailyMax} onEmpty={() => setDailyMax(undefined)}/></label>
        <label className="field"><span>任务活动类型</span><select value={activityType} onChange={event => setActivityType(event.target.value)}>{activityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>类型上限由同一个约束核心校验。</small></label>
        <label className="field checkbox-field"><input type="checkbox" checked={highIntensity} onChange={event => setHighIntensity(event.target.checked)}/><span>高强度任务（默认每天最多2项）</span></label>
        <label className="field checkbox-field"><input type="checkbox" checked={countInStats} onChange={event => setCountInStats(event.target.checked)}/><span>计入计划与统计时间</span></label>
      </div></details>
      {becomesMultiItem && <fieldset className="field span-2 numbering-choice"><legend>这个任务组将首次从 1 项扩展为多项</legend>
        <label><input type="radio" name="group-edit-numbering" checked={numberingChoice === 'preserve'} onChange={() => setNumberingChoice('preserve')}/><span><strong>保留原任务名称</strong><small>原任务会标记为自定义标题，新增任务按后续序号命名。</small></span></label>
        <label><input type="radio" name="group-edit-numbering" checked={numberingChoice === 'number-all'} onChange={() => setNumberingChoice('number-all')}/><span><strong>统一按当前顺序编号</strong><small>只修改非自定义标题，下一步会完整预览。</small></span></label>
      </fieldset>}
      {!initial && state.goals.length > 0 && <fieldset className="field span-2 goal-link-field"><legend>同时加入目标（可选）</legend><small>勾选后，会把“完成这个任务组的全部任务”作为该目标的一项完成条件。需要只完成一半或指定数量时，请创建后到“目标”页面修改条件。</small>{state.goals.filter(goal => goal.status !== 'archived').map(goal => <label key={goal.id}><input type="checkbox" checked={goalIds.includes(goal.id)} onChange={event => setGoalIds(current => event.target.checked ? [...new Set([...current, goal.id])] : current.filter(id => id !== goal.id))}/><span>{goal.title} · 最晚 {goal.latestDate}</span></label>)}</fieldset>}
      <label className="field span-2"><span>备注</span><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)}/></label>
      {!initial && <div className="form-note span-2">任务组只定义共享规则，真正进入日历的是生成的单项任务。阶段目标和最终截止日期统一由“目标”管理。</div>}
    </div>
    <div className="modal-actions">
      <button className="secondary-button" onClick={onClose}>取消</button>
      {initial ? <button className="primary-button" onClick={edit}>保存任务组</button> : <><button className="secondary-button" onClick={() => create(false)}>创建为未安排任务</button><button className="primary-button" onClick={() => create(true)}>创建并预览排期</button></>}
    </div>
  </Modal>
}
