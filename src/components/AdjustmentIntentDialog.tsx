import { useEffect, useMemo, useState } from 'react'
import type { AppState, PlanChangeEvent, SchedulingPreference } from '../types'
import { cloneActiveState } from '../lib/state'
import { uid } from '../lib/id'
import { todayISO } from '../lib/date'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

type AdjustmentReason = 'current-conflicts' | 'too-tiring' | 'future-replan' | 'execution-difference'
type LoadOutcome = 'daily-lower' | 'light-days' | 'avoid-streak' | 'spread-intensity'
type ReplanOutcome = 'preserve' | 'balanced' | 'goal' | 'rest'

const reasonCopy: Record<AdjustmentReason, { title: string; description: string; action: PlanChangeEvent['action']; eventType: PlanChangeEvent['type'] }> = {
  'current-conflicts': { title: '修复当前问题', description: '处理超容量、每日上限、未安排任务和目标期限风险。', action: 'repair', eventType: 'execution-difference' },
  'too-tiring': { title: '计划太累了', description: '降低连续高负载、长任务和高强度集中。', action: 'optimize', eventType: 'load-preference-change' },
  'future-replan': { title: '重新组织未来计划', description: '主动重新评估剩余日期，但继续保护执行记录和人工安排。', action: 'rebuild', eventType: 'future-replanning' },
  'execution-difference': { title: '处理执行后的变化', description: '针对复盘或实际执行差异修复后续计划。', action: 'repair', eventType: 'execution-difference' },
}

const loadOutcomes: Record<LoadOutcome, { title: string; description: string; preference: SchedulingPreference }> = {
  'daily-lower': { title: '每天少安排一些', description: '优先降低普通日总负载，允许完成日期适度后移但不越过最晚期限。', preference: 'rest' },
  'light-days': { title: '增加完整轻量日', description: '在未来周期中保留更明显的恢复日和缓冲空间。', preference: 'rest' },
  'avoid-streak': { title: '避免连续高负载', description: '重点打散连续满载或接近满载的日期。', preference: 'balanced' },
  'spread-intensity': { title: '分散长任务和高强度', description: '减少同一天或连续几天集中出现长任务和高强度任务。', preference: 'balanced' },
}

const replanOutcomes: Record<ReplanOutcome, { title: string; description: string; preference: SchedulingPreference }> = {
  preserve: { title: '尽量保持现在的安排', description: '只在确有必要时移动任务。', preference: 'preserve' },
  balanced: { title: '让每天更均匀', description: '平衡负载、科目、强度和长任务。', preference: 'balanced' },
  goal: { title: '更早保障最近目标', description: '优先满足最近的目标日期。', preference: 'goal' },
  rest: { title: '留出更多休息空间', description: '降低连续高负载并增加缓冲。', preference: 'rest' },
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
  const [loadOutcome, setLoadOutcome] = useState<LoadOutcome>('daily-lower')
  const [replanOutcome, setReplanOutcome] = useState<ReplanOutcome>('balanced')
  const [todayMode, setTodayMode] = useState<'none' | '30' | '60' | 'custom'>('none')
  const [customMinutes, setCustomMinutes] = useState(30)
  useEffect(() => {
    if (!open) return
    setReason(initialReason)
    setLoadOutcome('daily-lower')
    setReplanOutcome('balanced')
    setTodayMode('none')
    setCustomMinutes(30)
  }, [open, initialReason, initialDate])
  const copy = reasonCopy[reason]
  const todayExtraMinutes = todayMode === '30' ? 30 : todayMode === '60' ? 60 : todayMode === 'custom' ? customMinutes : 0
  const selectedPreference = reason === 'too-tiring' ? loadOutcomes[loadOutcome].preference : reason === 'future-replan' ? replanOutcomes[replanOutcome].preference : 'preserve'
  const preferenceOrder = useMemo(() => [selectedPreference, ...(['preserve', 'balanced', 'goal', 'rest'] as SchedulingPreference[]).filter(item => item !== selectedPreference)], [selectedPreference])
  const outcomeLabel = reason === 'too-tiring' ? loadOutcomes[loadOutcome].title : reason === 'future-replan' ? replanOutcomes[replanOutcome].title : undefined

  const submit = () => {
    const now = new Date().toISOString()
    const event: PlanChangeEvent = {
      id: uid('event'), type: copy.eventType, action: copy.action,
      title: copy.title, description: outcomeLabel ? `${copy.description} 本次希望：${outcomeLabel}。` : copy.description,
      affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: [],
      affectedDates: initialDate ? [initialDate] : [], createdAt: now,
      metadata: {
        preferredPreference: selectedPreference,
        preferredPreferences: preferenceOrder,
        requestedOutcome: reason === 'too-tiring' ? loadOutcome : reason === 'future-replan' ? replanOutcome : 'fix-current',
        todayExtraMinutes,
        sourceDate: initialDate ?? todayISO(),
      },
    }
    const prepared = cloneActiveState(state)
    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    prepared.updatedAt = now
    onPrepared(prepared, event)
  }

  return <Modal open={open} title="计划调整" onClose={onClose} wide mobileFullscreen className="adjustment-modal">
    <div className="adjustment-dialog-shell">
      <section className="adjustment-intro">
        <div>
          <span className="adjustment-eyebrow">计划调整</span>
          <strong>先说明变化，再查看系统建议</strong>
          <p>系统会先生成一个推荐方案；确认前不会修改计划，之后仍可比较其他实质不同的方案。</p>
        </div>
        <div className="adjustment-intro-badges"><span>改动先预览</span><span>方案可比较</span><span>决定权归你</span></div>
      </section>

      <div className="adjustment-layout">
        <main className="adjustment-main">
          <section className="adjustment-step">
            <header className="adjustment-step-header"><span className="adjustment-step-index">1</span><div><strong>这次为什么需要调整？</strong><p>选择最接近当前情况的一项。</p></div></header>
            <div className="adjustment-reason-grid">
              {(Object.keys(reasonCopy) as AdjustmentReason[]).filter(item => item !== 'execution-difference' || initialReason === 'execution-difference').map(item => <button type="button" key={item} className={reason === item ? 'selected' : ''} onClick={() => setReason(item)}><span className="choice-indicator">{reason === item ? '已选择' : '选择'}</span><strong>{reasonCopy[item].title}</strong><span>{reasonCopy[item].description}</span></button>)}
            </div>
          </section>

          {reason === 'too-tiring' && <section className="adjustment-step adjustment-section"><header className="adjustment-step-header"><span className="adjustment-step-index">2</span><div><strong>你最希望怎样减轻计划？</strong><p>选择最重要的结果，之后仍可比较其他方案。</p></div></header><div className="adjustment-outcome-grid">{(Object.keys(loadOutcomes) as LoadOutcome[]).map(item => <button type="button" key={item} className={loadOutcome === item ? 'selected' : ''} onClick={() => setLoadOutcome(item)}><span className="choice-indicator">{loadOutcome === item ? '已选择' : '选择'}</span><strong>{loadOutcomes[item].title}</strong><small>{loadOutcomes[item].description}</small></button>)}</div></section>}

          {reason === 'future-replan' && <section className="adjustment-step adjustment-section"><header className="adjustment-step-header"><span className="adjustment-step-index">2</span><div><strong>这次重组最希望得到什么？</strong><p>选择主要取舍；所有永久硬约束继续生效。</p></div></header><div className="adjustment-outcome-grid">{(Object.keys(replanOutcomes) as ReplanOutcome[]).map(item => <button type="button" key={item} className={replanOutcome === item ? 'selected' : ''} onClick={() => setReplanOutcome(item)}><span className="choice-indicator">{replanOutcome === item ? '已选择' : '选择'}</span><strong>{replanOutcomes[item].title}</strong><small>{replanOutcomes[item].description}</small></button>)}</div></section>}
        </main>

        <aside className="adjustment-sidebar">
          <section className="adjustment-section adjustment-today-section">
            <header><div><strong>今天还能接收多少新任务？</strong><span>只有你明确开放的分钟数可接收未来任务。</span></div></header>
            <div className="adjustment-today-control">
              <button type="button" className={todayMode === 'none' ? 'active' : ''} onClick={() => setTodayMode('none')}><strong>不再新增</strong><span>今天保持现状</span></button>
              <button type="button" className={todayMode === '30' ? 'active' : ''} onClick={() => setTodayMode('30')}><strong>30 分钟</strong><span>接收少量任务</span></button>
              <button type="button" className={todayMode === '60' ? 'active' : ''} onClick={() => setTodayMode('60')}><strong>60 分钟</strong><span>接收一段任务</span></button>
              <button type="button" className={todayMode === 'custom' ? 'active' : ''} onClick={() => setTodayMode('custom')}><strong>自定义</strong><span>精确设置分钟</span></button>
            </div>
            {todayMode === 'custom' && <label className="field compact-field"><span>额外分钟</span><NumericInput min={0} max={720} value={customMinutes} onValueChange={setCustomMinutes}/></label>}
          </section>
          <div className="adjustment-guarantees"><strong>系统始终保护</strong><span>过去日期、已完成任务、正在计时任务、锁定任务、目标最晚日期和受保护日期。手动安排不是锁定，但会被高权重保留。</span></div>
        </aside>
      </div>

      <div className="modal-actions adjustment-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={submit}>分析并预览推荐方案</button></div>
    </div>
  </Modal>
}
