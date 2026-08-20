import { useEffect, useMemo, useState } from 'react'
import type { AppState, Priority, Subject, TaskActivityType, TaskGroup, TaskGroupDraft } from '../types'
import { fmtDate } from '../lib/date'
import { weeklyOccurrenceRange } from '../lib/frequency'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

const presetSubjects: Subject[] = ['语文','数学','英语','物理','化学','生物','其他']
const priorities: Priority[] = [5,3,2,1,0]
const weekdays = ['周日','周一','周二','周三','周四','周五','周六']
const activityOptions: { value: TaskActivityType; label: string }[] = [
  { value: 'normal', label: '普通任务' }, { value: 'classical-study', label: '文言文学习（默认每天最多4次）' },
  { value: 'classical-dictation', label: '文言文默写（默认每天最多1篇）' }, { value: 'recitation', label: '正式背诵（默认每天最多1次）' },
  { value: 'chem-preview', label: '化学预习课（默认每天最多1节）' }, { value: 'math-paper', label: '数学整套试卷（默认每天最多1套）' },
]

function weekdayFor(date: string) {
  return new Date(`${date}T12:00:00`).getDay()
}

export function TaskGroupDialog({ open, onClose, state, initial, defaultDate, onCreate, onEdit }: {
  open: boolean
  onClose: () => void
  state: AppState
  initial?: TaskGroup
  defaultDate?: string
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
  const [weeklyFrequency, setWeeklyFrequency] = useState(false)
  const [weeklyStart, setWeeklyStart] = useState(state.settings.startDate)
  const [weeklyWeekday, setWeeklyWeekday] = useState(1)

  useEffect(() => {
    if (!open) return
    const frequencyStart = defaultDate ?? state.settings.startDate
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
    setWeeklyFrequency(false)
    setWeeklyStart(frequencyStart)
    setWeeklyWeekday(weekdayFor(frequencyStart))
  }, [open, initial, state.goals, state.settings.startDate, defaultDate])

  const chosenSubject = customSubject.trim() || subject
  const initialItemCount = initial ? state.assignments.filter(item => item.groupId === initial.id).length : 0
  const becomesMultiItem = Boolean(initial && !initial.recurring && initialItemCount === 1 && quantity > 1)
  const weeklyRange = useMemo(() => weeklyOccurrenceRange(weeklyStart, weeklyWeekday, quantity), [weeklyStart, weeklyWeekday, quantity])
  const weeklyOutOfRange = weeklyFrequency && Boolean(
    !weeklyRange.firstDate
    || !weeklyRange.lastDate
    || weeklyRange.firstDate < state.settings.startDate
    || weeklyRange.lastDate > state.settings.endDate
  )
  const weeklyPreview = weeklyRange.dates.length <= 5
    ? weeklyRange.dates.map(fmtDate).join('、')
    : `${weeklyRange.dates.slice(0, 3).map(fmtDate).join('、')} … ${fmtDate(weeklyRange.dates.at(-1)!)}`

  const draft = (): TaskGroupDraft => weeklyFrequency ? {
    title: title.trim(), subject: chosenSubject, priority, unitMinutes: minutes,
    activityType: 'recurring', dailyMax: undefined, highIntensity, countInStats, quantity,
    notes: notes.trim() || undefined, goalIds, numberingChoice, recurring: true,
    recurrenceStart: weeklyRange.firstDate, recurrenceEnd: weeklyRange.lastDate,
    recurrenceWeekdays: [weeklyWeekday], allowSplit: false, preferredDate: undefined,
  } : {
    title: title.trim(), subject: chosenSubject, priority, unitMinutes: minutes, activityType, dailyMax,
    highIntensity, countInStats, quantity, notes: notes.trim() || undefined, goalIds, numberingChoice,
    preferredDate: initial ? undefined : defaultDate,
  }
  const create = () => { if (!title.trim() || weeklyOutOfRange) return; onCreate(draft(), true) }
  const edit = () => {
    if (!initial || !onEdit || !title.trim()) return
    onEdit({ ...initial, title: title.trim(), subject: chosenSubject, priority, quantity, unitMinutes: minutes, dailyMax, activityType, highIntensity, countInStats, notes: notes.trim() || undefined }, numberingChoice)
    onClose()
  }

  return <Modal open={open} title={initial ? '编辑任务组' : '添加任务组并安排'} onClose={onClose} wide mobileFullscreen>
    <div className="form-grid">
      <label className="field span-2"><span>任务组名称</span><input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：化学预习" /></label>
      <label className="field"><span>科目／类别</span><select value={subject} onChange={event => { setSubject(event.target.value); setCustomSubject('') }}>{subjects.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="field"><span>新建自定义类别（可选）</span><input value={customSubject} onChange={event => setCustomSubject(event.target.value)} placeholder="例如：竞赛研究" /></label>
      <label className="field"><span>优先级</span><select value={priority} onChange={event => setPriority(Number(event.target.value) as Priority)}>{priorities.map(item => <option key={item} value={item}>{item === 5 ? '核心' : item === 3 ? '高' : item === 2 ? '中' : item === 1 ? '低' : '可选'}</option>)}</select></label>
      <label className="field"><span>{weeklyFrequency ? '总次数／总数量' : '数量'}</span><NumericInput min={1} max={999} value={quantity} onValueChange={setQuantity}/></label>
      <label className="field"><span>单项预计（分钟）</span><NumericInput min={1} max={1440} value={minutes} onValueChange={setMinutes}/></label>

      {!initial && <fieldset className="field span-2 intake-rule-choice"><legend>执行节奏</legend>
        <label><input type="radio" name="task-group-frequency" checked={!weeklyFrequency} onChange={() => setWeeklyFrequency(false)}/><span><strong>普通任务组</strong><small>生成指定数量，由排期器结合容量和目标安排。</small></span></label>
        <label><input type="radio" name="task-group-frequency" checked={weeklyFrequency} onChange={() => setWeeklyFrequency(true)}/><span><strong>有限次数 · 每周 1 项</strong><small>例如 4 套数学卷，每周固定一天完成 1 套，共生成 4 次。</small></span></label>
      </fieldset>}

      {!initial && weeklyFrequency && <div className="form-grid span-2">
        <label className="field"><span>从哪天开始计算</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={weeklyStart} onChange={event => setWeeklyStart(event.target.value)}/><small>包含当天；系统会寻找当天或之后的第一个目标星期。</small></label>
        <label className="field"><span>每周固定星期</span><select value={weeklyWeekday} onChange={event => setWeeklyWeekday(Number(event.target.value))}>{weekdays.map((label, day) => <option key={label} value={day}>{label}</option>)}</select></label>
        <div className={`form-note span-2 ${weeklyOutOfRange ? 'danger-text' : ''}`}>
          {weeklyOutOfRange
            ? `按当前设置，第 ${quantity} 次会超出计划结束日 ${state.settings.endDate}。请减少总次数、提前开始，或先延长计划结束日期。`
            : `将固定生成 ${quantity} 次：${weeklyPreview}。每次都锁定在${weekdays[weeklyWeekday]}，不会被自动挪到同周其他日期。`}
        </div>
      </div>}

      {!weeklyFrequency && <details className="form-advanced span-2"><summary>高级规则</summary><div className="form-grid">
        <label className="field"><span>每日最多数量</span><NumericInput min={1} max={99} value={dailyMax} placeholder="使用活动类型默认上限" onValueChange={setDailyMax} onEmpty={() => setDailyMax(undefined)}/></label>
        <label className="field"><span>任务活动类型</span><select value={activityType} onChange={event => setActivityType(event.target.value)}>{activityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>类型上限由同一个约束核心校验。</small></label>
        <label className="field checkbox-field"><input type="checkbox" checked={highIntensity} onChange={event => setHighIntensity(event.target.checked)}/><span>高强度任务（默认每天最多2项）</span></label>
        <label className="field checkbox-field"><input type="checkbox" checked={countInStats} onChange={event => setCountInStats(event.target.checked)}/><span>计入计划与统计时间</span></label>
      </div></details>}
      {weeklyFrequency && <label className="field span-2 checkbox-field"><input type="checkbox" checked={countInStats} onChange={event => setCountInStats(event.target.checked)}/><span>计入计划与统计时间</span></label>}

      {becomesMultiItem && <fieldset className="field span-2 numbering-choice"><legend>这个任务组将首次从 1 项扩展为多项</legend>
        <label><input type="radio" name="group-edit-numbering" checked={numberingChoice === 'preserve'} onChange={() => setNumberingChoice('preserve')}/><span><strong>保留原任务名称</strong><small>原任务会标记为自定义标题，新增任务按后续序号命名。</small></span></label>
        <label><input type="radio" name="group-edit-numbering" checked={numberingChoice === 'number-all'} onChange={() => setNumberingChoice('number-all')}/><span><strong>统一按当前顺序编号</strong><small>只修改非自定义标题，下一步会完整预览。</small></span></label>
      </fieldset>}
      {!initial && state.goals.length > 0 && <fieldset className="field span-2 goal-link-field"><legend>同时加入目标（可选）</legend><small>勾选后，会把“完成这个任务组的全部任务”作为该目标的一项完成条件。需要只完成一半或指定数量时，请创建后到“目标”页面修改条件。</small>{state.goals.filter(goal => goal.status !== 'archived').map(goal => <label key={goal.id}><input type="checkbox" checked={goalIds.includes(goal.id)} onChange={event => setGoalIds(current => event.target.checked ? [...new Set([...current, goal.id])] : current.filter(id => id !== goal.id))}/><span>{goal.title} · 最晚 {goal.latestDate}</span></label>)}</fieldset>}
      <label className="field span-2"><span>备注</span><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)}/></label>
      {!initial && !weeklyFrequency && <div className="form-note span-2">{defaultDate ? `系统会优先把任务安排到 ${defaultDate}，` : ''}提交后先生成安排预览；确认前不会改变正式计划。任务组会按数量生成具体任务。</div>}
      {!initial && weeklyFrequency && <div className="form-note span-2">有限每周任务复用现有重复任务机制；确认方案前不会改变正式计划。若你想“每周任意一天完成”而不是固定星期，目前仍应使用普通任务组让排期器自动安排。</div>}
    </div>
    <div className="modal-actions">
      <button className="secondary-button" onClick={onClose}>取消</button>
      {initial ? <button className="primary-button" onClick={edit}>保存任务组</button> : <button className="primary-button" disabled={weeklyOutOfRange} onClick={create}>生成安排预览</button>}
    </div>
  </Modal>
}
