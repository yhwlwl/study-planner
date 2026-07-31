import { useEffect, useMemo, useState } from 'react'
import type { AppState, PlanChangeEvent, SchedulingPreference } from '../types'
import { cloneActiveState } from '../lib/state'
import { uid } from '../lib/id'
import { todayISO } from '../lib/date'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

type AdjustmentReason = 'current-conflicts' | 'too-tiring' | 'future-replan' | 'execution-difference'

const reasonCopy: Record<AdjustmentReason, { title: string; description: string; action: PlanChangeEvent['action']; eventType: PlanChangeEvent['type'] }> = {
  'current-conflicts': { title: '修复当前发现的问题', description: '处理超容量、每日上限、未安排任务和目标期限风险，并尽量缩小连锁变化。', action: 'repair', eventType: 'execution-difference' },
  'too-tiring': { title: '让未来计划轻松一些', description: '当前计划不一定违法，但希望降低连续高负载、长任务和高强度集中。', action: 'optimize', eventType: 'load-preference-change' },
  'future-replan': { title: '重新组织剩余计划', description: '重新评估全部未来日期，但过去、完成任务、正在计时、锁定和手动安排仍受保护。', action: 'rebuild', eventType: 'future-replanning' },
  'execution-difference': { title: '处理执行后的变化', description: '根据今天或指定日期的未完成情况生成后续方案，复盘记录本身不会被覆盖。', action: 'repair', eventType: 'execution-difference' },
}

const preferenceCopy: Record<SchedulingPreference, { title: string; description: string }> = {
  preserve: { title: '尽量少改', description: '优先保留已有日期、手动安排和每日任务组合。' },
  balanced: { title: '均衡执行', description: '平衡负载、科目、强度和长任务，并保留安全余量。' },
  goal: { title: '目标优先', description: '优先保障最近的相关目标期限，但不突破永久硬约束。' },
  rest: { title: '更多休息', description: '降低连续高负载并保留更多缓冲空间。' },
}

export function AdjustmentIntentDialog({ open, state, initialDate, initialReason = 'current-conflicts', onClose, onPrepared }: {
  open: boolean
  state: AppState
  initialDate?: string
  initialReason?: AdjustmentReason
  onClose: () => void
  onPrepared: (prepared: AppState, event: PlanChangeEvent) => void
}) {
  const [reason, setReason] = useState<AdjustmentReason>(initialReason)
  const [preference, setPreference] = useState<SchedulingPreference>(initialReason === 'too-tiring' ? 'rest' : 'preserve')
  const [todayMode, setTodayMode] = useState<'none' | '30' | '60' | 'custom'>('none')
  const [customMinutes, setCustomMinutes] = useState(30)
  useEffect(() => {
    if (!open) return
    setReason(initialReason)
    setPreference(initialReason === 'too-tiring' ? 'rest' : 'preserve')
    setTodayMode('none')
    setCustomMinutes(30)
  }, [open, initialReason, initialDate])
  const copy = reasonCopy[reason]
  const todayExtraMinutes = todayMode === '30' ? 30 : todayMode === '60' ? 60 : todayMode === 'custom' ? customMinutes : 0
  const preferenceOrder = useMemo(() => [preference, ...(['preserve', 'balanced', 'goal', 'rest'] as SchedulingPreference[]).filter(item => item !== preference)], [preference])
  const submit = () => {
    const now = new Date().toISOString()
    const event: PlanChangeEvent = {
      id: uid('event'), type: copy.eventType, action: copy.action,
      title: copy.title, description: copy.description,
      affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: [],
      affectedDates: initialDate ? [initialDate] : [], createdAt: now,
      metadata: { preferredPreferences: preferenceOrder, todayExtraMinutes, sourceDate: initialDate ?? todayISO() },
    }
    const prepared = cloneActiveState(state)
    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    prepared.updatedAt = now
    onPrepared(prepared, event)
  }
  return <Modal open={open} title="计划调整 · 说明变化后再看方案" onClose={onClose} wide mobileFullscreen>
    <section className="adjustment-intro"><strong>先选择实际发生了什么</strong><p>系统会自动决定内部采用插入、修复、优化还是未来重组；你不需要先理解算法模式。</p></section>
    <div className="adjustment-reason-grid">
      {(Object.keys(reasonCopy) as AdjustmentReason[]).map(item => <button key={item} className={reason === item ? 'selected' : ''} onClick={() => { setReason(item); if (item === 'too-tiring') setPreference('rest') }}><strong>{reasonCopy[item].title}</strong><span>{reasonCopy[item].description}</span></button>)}
    </div>
    <section className="adjustment-section"><header><strong>这次方案更看重什么</strong><span>这是评分偏好，不是另一套重排系统。</span></header><div className="adjustment-preference-grid">{(Object.keys(preferenceCopy) as SchedulingPreference[]).map(item => <label key={item} className={preference === item ? 'selected' : ''}><input type="radio" name="adjustment-preference" checked={preference === item} onChange={() => setPreference(item)}/><span><strong>{preferenceCopy[item].title}</strong><small>{preferenceCopy[item].description}</small></span></label>)}</div></section>
    <section className="adjustment-section"><header><strong>今天还能接收多少新任务</strong><span>过去完全冻结；今天只有你明确开放的分钟数可接收未来任务。</span></header><div className="segmented-control adjustment-today-control"><button className={todayMode === 'none' ? 'active' : ''} onClick={() => setTodayMode('none')}>今天不再新增</button><button className={todayMode === '30' ? 'active' : ''} onClick={() => setTodayMode('30')}>还能学 30 分钟</button><button className={todayMode === '60' ? 'active' : ''} onClick={() => setTodayMode('60')}>还能学 60 分钟</button><button className={todayMode === 'custom' ? 'active' : ''} onClick={() => setTodayMode('custom')}>自定义</button></div>{todayMode === 'custom' && <label className="field compact-field"><span>额外分钟</span><NumericInput min={0} max={720} value={customMinutes} onValueChange={setCustomMinutes}/></label>}</section>
    <div className="adjustment-guarantees"><strong>始终保护</strong><span>过去日期、已完成任务、正在计时任务、锁定任务、目标最晚日期和受保护日期。手动安排不是锁定，但会被高权重保留。</span></div>
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={submit}>分析并显示调整方案</button></div>
  </Modal>
}
