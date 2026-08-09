import { useEffect, useMemo, useState } from 'react'
import type { AppState, PlanChangeEvent, SchedulingPreference } from '../types'
import { cloneActiveState } from '../lib/state'
import { uid } from '../lib/id'
import { dateRange, todayISO } from '../lib/date'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

type AdjustmentReason = 'availability-change' | 'current-conflicts' | 'too-tiring' | 'future-replan' | 'execution-difference'
type LoadOutcome = 'daily-lower' | 'light-days' | 'avoid-streak' | 'spread-intensity'
type ReplanOutcome = 'preserve' | 'balanced' | 'goal' | 'rest'

const reasonCopy: Record<AdjustmentReason, { title: string; description: string; action: PlanChangeEvent['action']; eventType: PlanChangeEvent['type'] }> = {
  'availability-change': { title: '这几天没空或需要休息', description: '把临时行程、生病或休息日直接标到日期上，再修复受影响任务。', action: 'repair', eventType: 'availability-change' },
  'current-conflicts': { title: '有任务冲突或排不下', description: '处理超容量、每日上限、未安排任务和目标期限风险。', action: 'repair', eventType: 'execution-difference' },
  'too-tiring': { title: '最近太累，想减轻计划', description: '降低连续高负载、长任务和高强度集中。', action: 'optimize', eventType: 'load-preference-change' },
  'future-replan': { title: '未来安排需要重新组织', description: '重新评估剩余日期，同时保护执行记录和人工安排。', action: 'rebuild', eventType: 'future-replanning' },
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

export function AdjustmentIntentDialog({ open, state, initialDate, initialReason = 'current-conflicts', onClose, onPrepared, onNavigate }: {
  open: boolean
  state: AppState
  initialDate?: string
  initialReason?: AdjustmentReason
  onClose: () => void
  onPrepared: (prepared: AppState, event: PlanChangeEvent) => void
  onNavigate?: (target: 'intake' | 'goals' | 'calendar' | 'tasks') => void
}) {
  const [reason, setReason] = useState<AdjustmentReason>(initialReason)
  const [loadOutcome, setLoadOutcome] = useState<LoadOutcome>('daily-lower')
  const [replanOutcome, setReplanOutcome] = useState<ReplanOutcome>('balanced')
  const [todayMode, setTodayMode] = useState<'none' | '30' | '60' | 'custom'>('none')
  const [customMinutes, setCustomMinutes] = useState(30)
  const defaultConstraintDate = initialDate ?? (todayISO() < state.settings.startDate ? state.settings.startDate : todayISO() > state.settings.endDate ? state.settings.endDate : todayISO())
  const [constraintStart, setConstraintStart] = useState(defaultConstraintDate)
  const [constraintEnd, setConstraintEnd] = useState(defaultConstraintDate)
  const [availabilityMode, setAvailabilityMode] = useState<'unavailable' | 'reduced'>('unavailable')
  const [availableMinutes, setAvailableMinutes] = useState(60)
  const [availabilityReason, setAvailabilityReason] = useState('临时没有学习时间')
  useEffect(() => {
    if (!open) return
    setReason(initialReason)
    setLoadOutcome('daily-lower')
    setReplanOutcome('balanced')
    setTodayMode('none')
    setCustomMinutes(30)
    setConstraintStart(defaultConstraintDate)
    setConstraintEnd(defaultConstraintDate)
    setAvailabilityMode('unavailable')
    setAvailableMinutes(60)
    setAvailabilityReason('临时没有学习时间')
  }, [open, initialReason, initialDate, defaultConstraintDate])
  const copy = reasonCopy[reason]
  const showTodayCapacity = (initialDate ?? todayISO()) === todayISO() && (reason === 'current-conflicts' || reason === 'future-replan')
  const todayExtraMinutes = showTodayCapacity ? (todayMode === '30' ? 30 : todayMode === '60' ? 60 : todayMode === 'custom' ? customMinutes : 0) : 0
  const selectedPreference = reason === 'too-tiring' ? loadOutcomes[loadOutcome].preference : reason === 'future-replan' ? replanOutcomes[replanOutcome].preference : 'preserve'
  const preferenceOrder = useMemo(() => [selectedPreference, ...(['preserve', 'balanced', 'goal', 'rest'] as SchedulingPreference[]).filter(item => item !== selectedPreference)], [selectedPreference])
  const outcomeLabel = reason === 'too-tiring' ? loadOutcomes[loadOutcome].title : reason === 'future-replan' ? replanOutcomes[replanOutcome].title : undefined

  const submit = () => {
    const now = new Date().toISOString()
    const availabilityDates = reason === 'availability-change' && constraintStart && constraintEnd && constraintStart <= constraintEnd
      ? dateRange(constraintStart, constraintEnd)
      : []
    const event: PlanChangeEvent = {
      id: uid('event'), type: copy.eventType, action: copy.action,
      title: copy.title, description: outcomeLabel ? `${copy.description} 本次希望：${outcomeLabel}。` : copy.description,
      affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: [],
      affectedDates: availabilityDates.length ? availabilityDates : initialDate ? [initialDate] : [], createdAt: now,
      metadata: {
        preferredPreference: selectedPreference,
        preferredPreferences: preferenceOrder,
        requestedOutcome: reason === 'too-tiring' ? loadOutcome : reason === 'future-replan' ? replanOutcome : 'fix-current',
        todayExtraMinutes,
        sourceDate: initialDate ?? todayISO(),
        availabilityMode: reason === 'availability-change' ? availabilityMode : undefined,
        capacityMinutes: reason === 'availability-change' ? (availabilityMode === 'unavailable' ? 0 : availableMinutes) : undefined,
      },
    }
    const prepared = cloneActiveState(state)
    if (reason === 'availability-change') {
      if (!availabilityDates.length) return
      prepared.calendarConstraints.push({
        id: uid('constraint'), startDate: constraintStart, endDate: constraintEnd,
        kind: availabilityMode === 'unavailable' ? 'unavailable' : 'reduced-capacity',
        capacityMinutes: availabilityMode === 'unavailable' ? 0 : Math.max(0, Math.min(1440, availableMinutes)),
        protected: true, reason: availabilityReason.trim() || copy.title,
        createdAt: now, updatedAt: now,
      })
      event.description = `${constraintStart} 至 ${constraintEnd}：${availabilityMode === 'unavailable' ? '完全不安排学习任务' : `可用 ${Math.max(0, Math.min(1440, availableMinutes))} 分钟`}。系统将保护这段日期并先预览受影响任务。`
    }
    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    prepared.updatedAt = now
    onPrepared(prepared, event)
  }

  return <Modal open={open} title="计划有变化" onClose={onClose} wide mobileFullscreen className="adjustment-modal">
    <div className="adjustment-dialog-shell">
      <section className="adjustment-intro">
        <div>
          <span className="adjustment-eyebrow">计划有变化</span>
          <strong>用当前发生的事来选择，不必理解调度术语</strong>
          <p>系统会先生成一个推荐方案；确认前不会修改计划，之后仍可比较其他实质不同的方案。</p>
        </div>
        <div className="adjustment-intro-badges"><span>改动先预览</span><span>方案可比较</span><span>决定权归你</span></div>
      </section>

      {onNavigate && <nav className="adjustment-scenario-links" aria-label="常见变化快捷入口">
        <button type="button" onClick={() => setReason('availability-change')}><strong>临时没空／身体不舒服</strong><span>设置一段不可用或降容日期</span></button>
        <button type="button" onClick={() => { onClose(); onNavigate('intake') }}><strong>突然多了一批任务</strong><span>先收进录入工作区，确认后再排期</span></button>
        <button type="button" onClick={() => { onClose(); onNavigate('goals') }}><strong>截止日期提前或推迟</strong><span>修改目标期限并查看影响</span></button>
        <button type="button" onClick={() => { onClose(); onNavigate('calendar') }}><strong>把未来任务移到今天／顺延</strong><span>在月历中选任务和目标日期，可一次性豁免今天接收规则</span></button>
        <button type="button" onClick={() => setReason('execution-difference')}><strong>今天比预计更快或更慢</strong><span>按已经记录的实际执行修复后续</span></button>
        <button type="button" onClick={() => setReason('too-tiring')}><strong>想减轻未来几天</strong><span>选择减负方式并比较结果</span></button>
        <button type="button" onClick={() => setReason('future-replan')}><strong>想重组整个未来计划</strong><span>保留历史后重新评估剩余安排</span></button>
      </nav>}

      <div className="adjustment-layout">
        <main className="adjustment-main">
          <section className="adjustment-step">
            <header className="adjustment-step-header"><span className="adjustment-step-index">1</span><div><strong>这次为什么需要调整？</strong><p>选择最接近当前情况的一项。</p></div></header>
            <div className="adjustment-reason-grid">
              {(Object.keys(reasonCopy) as AdjustmentReason[]).filter(item => item !== 'execution-difference' || initialReason === 'execution-difference' || reason === 'execution-difference').map(item => <button type="button" key={item} className={reason === item ? 'selected' : ''} onClick={() => setReason(item)}><span className="choice-indicator">{reason === item ? '已选择' : '选择'}</span><strong>{reasonCopy[item].title}</strong><span>{reasonCopy[item].description}</span></button>)}
            </div>
          </section>

          {reason === 'too-tiring' && <section className="adjustment-step adjustment-section"><header className="adjustment-step-header"><span className="adjustment-step-index">2</span><div><strong>你最希望怎样减轻计划？</strong><p>选择最重要的结果，之后仍可比较其他方案。</p></div></header><div className="adjustment-outcome-grid">{(Object.keys(loadOutcomes) as LoadOutcome[]).map(item => <button type="button" key={item} className={loadOutcome === item ? 'selected' : ''} onClick={() => setLoadOutcome(item)}><span className="choice-indicator">{loadOutcome === item ? '已选择' : '选择'}</span><strong>{loadOutcomes[item].title}</strong><small>{loadOutcomes[item].description}</small></button>)}</div></section>}

          {reason === 'future-replan' && <section className="adjustment-step adjustment-section"><header className="adjustment-step-header"><span className="adjustment-step-index">2</span><div><strong>这次重组最希望得到什么？</strong><p>选择主要取舍；所有永久硬约束继续生效。</p></div></header><div className="adjustment-outcome-grid">{(Object.keys(replanOutcomes) as ReplanOutcome[]).map(item => <button type="button" key={item} className={replanOutcome === item ? 'selected' : ''} onClick={() => setReplanOutcome(item)}><span className="choice-indicator">{replanOutcome === item ? '已选择' : '选择'}</span><strong>{replanOutcomes[item].title}</strong><small>{replanOutcomes[item].description}</small></button>)}</div></section>}

          {reason === 'availability-change' && <section className="adjustment-step adjustment-section">
            <header className="adjustment-step-header"><span className="adjustment-step-index">2</span><div><strong>哪几天、还能安排多少？</strong><p>这段日期会被保护，后续任务只能通过明确例外移入。</p></div></header>
            <div className="adjustment-availability-form">
              <label className="field"><span>开始日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={constraintStart} onChange={event => { setConstraintStart(event.target.value); if (constraintEnd < event.target.value) setConstraintEnd(event.target.value) }}/></label>
              <label className="field"><span>结束日期</span><input type="date" min={constraintStart} max={state.settings.endDate} value={constraintEnd} onChange={event => setConstraintEnd(event.target.value)}/></label>
              <fieldset className="field span-2"><legend>可用情况</legend><div className="segmented-control"><button type="button" className={availabilityMode === 'unavailable' ? 'active' : ''} onClick={() => setAvailabilityMode('unavailable')}>完全没空／休息</button><button type="button" className={availabilityMode === 'reduced' ? 'active' : ''} onClick={() => setAvailabilityMode('reduced')}>只能学一会儿</button></div></fieldset>
              {availabilityMode === 'reduced' && <label className="field"><span>每天可用分钟</span><NumericInput min={0} max={1440} value={availableMinutes} onValueChange={setAvailableMinutes}/></label>}
              <label className={`field ${availabilityMode === 'unavailable' ? 'span-2' : ''}`}><span>原因（可选）</span><input value={availabilityReason} onChange={event => setAvailabilityReason(event.target.value)} placeholder="例如：旅行、发烧、校内活动"/></label>
            </div>
          </section>}
        </main>

        <aside className="adjustment-sidebar">
          {showTodayCapacity ? <section className="adjustment-section adjustment-today-section">
            <header><div><strong>今天还能接收多少新任务？</strong><span>只有你明确开放的分钟数可接收未来任务。</span></div></header>
            <div className="adjustment-today-control">
              <button type="button" className={todayMode === 'none' ? 'active' : ''} onClick={() => setTodayMode('none')}><strong>不再新增</strong><span>今天保持现状</span></button>
              <button type="button" className={todayMode === '30' ? 'active' : ''} onClick={() => setTodayMode('30')}><strong>30 分钟</strong><span>接收少量任务</span></button>
              <button type="button" className={todayMode === '60' ? 'active' : ''} onClick={() => setTodayMode('60')}><strong>60 分钟</strong><span>接收一段任务</span></button>
              <button type="button" className={todayMode === 'custom' ? 'active' : ''} onClick={() => setTodayMode('custom')}><strong>自定义</strong><span>精确设置分钟</span></button>
            </div>
            {todayMode === 'custom' && <label className="field compact-field"><span>额外分钟</span><NumericInput min={0} max={720} value={customMinutes} onValueChange={setCustomMinutes}/></label>}
          </section> : <div className="adjustment-context-note"><strong>本次不需要重新询问今天容量</strong><span>{reason === 'too-tiring' ? '减负只调整未来负载，不会向今天新增任务。' : reason === 'execution-difference' ? '复盘中的日期决定已经由用户逐项给出。' : '当前变化不涉及向今天接收新任务。'}</span></div>}
          <div className="adjustment-guarantees"><strong>系统始终保护</strong><span>过去日期、已完成任务、正在计时任务、锁定任务、目标最晚日期和受保护日期。手动安排不是锁定，但会被高权重保留。</span></div>
        </aside>
      </div>

      <div className="modal-actions adjustment-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={reason === 'availability-change' && (!constraintStart || !constraintEnd || constraintStart > constraintEnd)} onClick={submit}>分析并预览推荐方案</button></div>
    </div>
  </Modal>
}
