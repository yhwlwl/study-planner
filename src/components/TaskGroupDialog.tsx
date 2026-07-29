import { useEffect, useState } from 'react'
import type { Priority, Subject, TaskActivityType, TaskGroup } from '../types'
import { uid } from '../lib/id'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

const subjects: Subject[] = ['语文','数学','英语','物理','化学','生物','其他']
const priorities: Priority[] = [5,3,2,1,0]
const activityOptions: { value: TaskActivityType; label: string }[] = [
  { value: 'normal', label: '普通任务' },
  { value: 'classical-study', label: '文言文学习（默认每天最多4次）' },
  { value: 'classical-dictation', label: '文言文默写（默认每天最多1篇）' },
  { value: 'recitation', label: '正式背诵（默认每天最多1次）' },
  { value: 'chem-preview', label: '化学预习课（默认每天最多1节）' },
  { value: 'math-paper', label: '数学整套试卷（默认每天最多1套）' }
]


export function TaskGroupDialog({ open, onClose, initial, defaults, onSave }: {
  open: boolean
  onClose: () => void
  initial?: TaskGroup
  defaults: { targetDate: string; dueDate: string }
  onSave: (group: TaskGroup) => void
}) {
  const [form, setForm] = useState<TaskGroup>(() => initial ?? emptyGroup(defaults))
  useEffect(() => setForm(initial ?? emptyGroup(defaults)), [initial, open, defaults.targetDate, defaults.dueDate])

  const patch = <K extends keyof TaskGroup>(key: K, value: TaskGroup[K]) => setForm(prev => ({ ...prev, [key]: value }))
  const submit = () => {
    if (!form.title.trim()) return
    onSave({ ...form, title: form.title.trim(), quantity: Math.max(1, Number(form.quantity)), unitMinutes: Math.max(1, Number(form.unitMinutes)) })
    onClose()
  }

  return <Modal open={open} title={initial ? '编辑任务' : '新增任务'} onClose={onClose} wide>
    <div className="form-grid">
      <label className="field span-2"><span>任务名称</span><input value={form.title} onChange={e => patch('title', e.target.value)} placeholder="例如：数学套卷" /></label>
      <label className="field"><span>科目</span><select value={form.subject} onChange={e => patch('subject', e.target.value as Subject)}>{subjects.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="field"><span>优先级</span><select value={form.priority} onChange={e => patch('priority', Number(e.target.value) as Priority)}>{priorities.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
      <label className="field"><span>数量</span><NumericInput min={1} value={form.quantity} onValueChange={value => patch('quantity', value)} /></label>
      <label className="field"><span>单次预计（分钟）</span><NumericInput min={1} value={form.unitMinutes} onValueChange={value => patch('unitMinutes', value)} /></label>
      <label className="field"><span>阶段目标日期</span><input type="date" value={form.targetDate} onChange={e => patch('targetDate', e.target.value)} /></label>
      <label className="field"><span>最终截止日期</span><input type="date" value={form.dueDate} onChange={e => patch('dueDate', e.target.value)} /></label>
      <label className="field"><span>每日最多数量</span><NumericInput min={1} value={form.dailyMax} placeholder="使用活动类型默认上限" onValueChange={value => patch('dailyMax', value)} onEmpty={() => patch('dailyMax', undefined)} /></label>
      <label className="field span-2"><span>任务活动类型</span><select value={form.activityType ?? 'normal'} onChange={e => patch('activityType', e.target.value as TaskActivityType)}>{activityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>用于重排时统计同类任务。默认上限可在冲突预览中单次放宽。</small></label>
      <label className="field checkbox-field"><input type="checkbox" checked={Boolean(form.highIntensity)} onChange={e => patch('highIntensity', e.target.checked)} /><span>属于高强度任务（默认每天最多2项）</span></label>
      <label className="field checkbox-field"><input type="checkbox" checked={form.countInStats} onChange={e => patch('countInStats', e.target.checked)} /><span>计入计划与统计时间</span></label>
      <label className="field checkbox-field"><input type="checkbox" checked={Boolean(form.hidden)} onChange={e => patch('hidden', e.target.checked)} /><span>默认隐藏</span></label>
      <label className="field checkbox-field"><input type="checkbox" checked={Boolean(form.flexibleDuration)} onChange={e => patch('flexibleDuration', e.target.checked)} /><span>实际时长灵活</span></label>
      <label className="field checkbox-field"><input type="checkbox" checked={Boolean(form.allowSplit)} onChange={e => patch('allowSplit', e.target.checked)} /><span>允许跨天拆分</span></label>
      <label className="field checkbox-field"><input type="checkbox" checked={Boolean(form.memoryTask)} onChange={e => patch('memoryTask', e.target.checked)} /><span>属于记忆类任务</span></label>
      <label className="field span-2"><span>备注</span><textarea rows={3} value={form.notes ?? ''} onChange={e => patch('notes', e.target.value)} /></label>
    </div>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={submit}>保存</button></div>
  </Modal>
}

function emptyGroup(defaults: { targetDate: string; dueDate: string }): TaskGroup {
  return {
    id: uid('group'), subject: '其他', title: '', priority: 3, quantity: 1,
    unitMinutes: 30, targetDate: defaults.targetDate, dueDate: defaults.dueDate,
    countInStats: true, allowSplit: false, memoryTask: false, activityType: 'normal', highIntensity: false
  }
}
