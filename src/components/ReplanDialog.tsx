import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, Lock, RefreshCw, SlidersHorizontal } from 'lucide-react'
import type { AppState, ReplanBundle, ReplanRequest, ReplanResult, ReplanStrategy } from '../types'
import { dayTypeLabel, minutesText } from '../lib/date'
import { analyzePlan } from '../lib/planner'
import { Modal } from './Modal'

type MoveDecision = { mode: 'accept' | 'keep' | 'custom'; date?: string; lock?: boolean }

export function ReplanDialog({
  bundle, currentState, open, request, onRequestChange, onRegenerate, onClose, onApply
}: {
  bundle?: ReplanBundle
  currentState: AppState
  open: boolean
  request: ReplanRequest
  onRequestChange: (request: ReplanRequest) => void
  onRegenerate: () => void
  onClose: () => void
  onApply: (result: ReplanResult, state: AppState) => void
}) {
  const [strategy, setStrategy] = useState<ReplanStrategy>('balanced')
  const [decisions, setDecisions] = useState<Record<string, MoveDecision>>({})
  const [acceptedDayTypes, setAcceptedDayTypes] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!bundle) return
    setDecisions({})
    setAcceptedDayTypes({})
    const preferred: ReplanStrategy = currentState.settings.planningMode === 'sprint' ? 'goal' : currentState.settings.planningMode === 'relaxed' ? 'preserve' : 'balanced'
    setStrategy(bundle.scenarios.some(x => x.strategy === preferred) ? preferred : bundle.scenarios[0]?.strategy ?? 'balanced')
  }, [bundle?.scenarios[0]?.id, currentState.settings.planningMode])

  const result = bundle?.scenarios.find(x => x.strategy === strategy) ?? bundle?.scenarios[0]
  const editedState = useMemo(() => {
    if (!result) return undefined
    const next = structuredClone(result.nextState)
    for (const move of result.moves) {
      const decision = decisions[move.assignmentId]
      if (!decision) continue
      const assignment = next.assignments.find(a => a.id === move.assignmentId)
      const original = currentState.assignments.find(a => a.id === move.assignmentId)
      if (!assignment) continue
      if (decision.mode === 'keep') {
        assignment.scheduledDate = move.from
        if (original) {
          assignment.scheduleSource = original.scheduleSource
          assignment.intentStrength = original.intentStrength
          assignment.previousDate = original.previousDate
          assignment.lastManualMoveAt = original.lastManualMoveAt
        }
      } else if (decision.mode === 'custom' && decision.date) {
        assignment.previousDate = move.from
        assignment.scheduledDate = decision.date
        assignment.scheduleSource = 'manual'
        assignment.intentStrength = decision.lock ? 'locked' : 'manual'
        assignment.lastManualMoveAt = new Date().toISOString()
      }
      if (decision.lock) {
        assignment.locked = true
        assignment.intentStrength = 'locked'
      }
    }
    for (const suggestion of result.dayTypeSuggestions) {
      if (!acceptedDayTypes[suggestion.date]) continue
      next.dayConfigs[suggestion.date] = {
        ...(next.dayConfigs[suggestion.date] ?? { date: suggestion.date, type: suggestion.from }),
        type: suggestion.to,
        userSet: true
      }
    }
    next.updatedAt = new Date().toISOString()
    return next
  }, [result, decisions, acceptedDayTypes, currentState])

  const editedIssues = useMemo(() => editedState ? analyzePlan(editedState, request.fromDate).slice(0, 12) : [], [editedState, request.fromDate])
  const changedLoads = result?.loadChanges
    .filter(change => Math.abs(change.afterMinutes - change.beforeMinutes) >= 10)
    .sort((a, b) => Math.abs(b.afterMinutes - b.beforeMinutes) - Math.abs(a.afterMinutes - a.beforeMinutes))
    .slice(0, 10) ?? []

  return <Modal open={open} title="重排中心 · 先预览，再决定" onClose={onClose} wide>
    <div className="replan-controls">
      <div className="segmented-control">
        <button className={request.mode === 'repair' ? 'active' : ''} onClick={() => onRequestChange({ ...request, mode: 'repair' })}>局部修复</button>
        <button className={request.mode === 'full' ? 'active' : ''} onClick={() => onRequestChange({ ...request, mode: 'full' })}>全面重排</button>
      </div>
      <label className="field compact-field"><span>从哪天开始</span><input type="date" value={request.fromDate} onChange={e => onRequestChange({ ...request, fromDate: e.target.value })}/></label>
      <label className="field compact-field"><span>冻结近期天数</span><input type="number" min="0" max="7" value={request.freezeDays ?? 2} onChange={e => onRequestChange({ ...request, freezeDays: Number(e.target.value) })}/></label>
      <button className="secondary-button" onClick={onRegenerate}><RefreshCw size={16}/>重新计算</button>
      <p className="replan-control-note">冻结期内的手动安排默认不动；需要让系统提出移动建议时，可把冻结天数设为 0 后重新计算。</p>
    </div>

    {!result ? <p>正在计算……</p> : <>
      <div className="scenario-tabs">
        {bundle?.scenarios.map(item => <button key={item.strategy} className={strategy === item.strategy ? 'active' : ''} onClick={() => { setStrategy(item.strategy); setDecisions({}); setAcceptedDayTypes({}) }}>
          <strong>{item.title}</strong><span>{item.description}</span>
        </button>)}
      </div>

      {bundle && bundle.issues.length > 0 && <section className="replan-section detected-section">
        <div className="replan-section-title"><AlertTriangle size={18}/><div><h3>系统检测到的问题</h3><p>这是重排前的现状；是否处理以及采用哪个方案由你决定。</p></div></div>
        <div className="detected-issue-list">{bundle.issues.slice(0,16).map((issue,index)=><div key={index}>{issue}</div>)}</div>
      </section>}

      <div className="summary-grid replan-summary-grid">
        <div className="metric-card"><span>将移动</span><strong>{result.summary.moved}</strong><small>项任务</small></div>
        <div className="metric-card"><span>保留手动安排</span><strong>{result.summary.preservedManual}</strong><small>项</small></div>
        <div className="metric-card"><span>尚未解决</span><strong>{result.summary.unresolved}</strong><small>项</small></div>
        <div className="metric-card"><span>核心任务预计</span><strong>{result.summary.coreAfter ?? '待决定'}</strong><small>原先 {result.summary.coreBefore ?? '未知'}</small></div>
      </div>

      <section className="replan-section">
        <div className="replan-section-title"><SlidersHorizontal size={18}/><div><h3>方案后果</h3><p>这里只说明影响，不替你做决定。</p></div></div>
        <div className="consequence-list">{result.consequences.map((x, i) => <div key={i}>{x}</div>)}</div>
      </section>

      {changedLoads.length > 0 && <section className="replan-section">
        <div className="replan-section-title"><CalendarClock size={18}/><div><h3>修改前后负载</h3><p>优先展示变化最大的日期，帮助判断节奏是否更合理。</p></div></div>
        <div className="load-compare-list">{changedLoads.map(change => {
          const beforeRatio = change.capacity ? change.beforeMinutes / change.capacity : 0
          const afterRatio = change.capacity ? change.afterMinutes / change.capacity : 0
          return <div className="load-compare-row" key={change.date}>
            <strong>{change.date}</strong>
            <div><span>原 {minutesText(change.beforeMinutes)}</span><i style={{width:`${Math.min(100,beforeRatio*100)}%`}}/></div>
            <b>→</b>
            <div><span>新 {minutesText(change.afterMinutes)}</span><i className={afterRatio>1?'over':''} style={{width:`${Math.min(100,afterRatio*100)}%`}}/></div>
            <small>容量 {minutesText(change.capacity)}</small>
          </div>
        })}</div>
      </section>}

      {result.dayTypeSuggestions.length > 0 && <section className="replan-section">
        <div className="replan-section-title"><CalendarClock size={18}/><div><h3>日期类型建议</h3><p>默认不应用，勾选后才会随本次重排修改。</p></div></div>
        <div className="suggestion-list">{result.dayTypeSuggestions.map(s => <label key={s.date} className="suggestion-row">
          <input type="checkbox" checked={Boolean(acceptedDayTypes[s.date])} onChange={e => setAcceptedDayTypes(prev => ({ ...prev, [s.date]: e.target.checked }))}/>
          <div><strong>{s.date}：{dayTypeLabel[s.from]} → {dayTypeLabel[s.to]}</strong><span>{s.reason}，增加 {minutesText(s.capacityGain)} 容量。</span></div>
        </label>)}</div>
      </section>}

      <section className="replan-section">
        <div className="replan-section-title"><Check size={18}/><div><h3>逐项微调</h3><p>可接受、保持原日期、改选日期或锁定。</p></div></div>
        <div className="decision-list">
          {result.moves.length === 0 && <p className="muted-text">这个方案不需要移动任务。</p>}
          {result.moves.map(move => {
            const decision = decisions[move.assignmentId] ?? { mode: 'accept' as const }
            return <article key={move.assignmentId} className={`decision-card ${move.wasManual ? 'manual-impact' : ''}`}>
              <div className="decision-head"><div><span className={`subject-pill subject-${move.subject}`}>{move.subject}</span><strong>{move.title}</strong>{move.wasManual && <em>用户手动安排</em>}</div>{move.hardRequired && <span className="hard-badge">硬冲突</span>}</div>
              <div className="date-change"><span>{move.from ?? '未安排'}</span><b>→</b><span>{decision.mode === 'keep' ? move.from ?? '未安排' : decision.mode === 'custom' ? decision.date ?? '请选择' : move.to ?? '无法安排'}</span></div>
              <p><b>原因：</b>{move.reason}</p><p><b>影响：</b>{move.impact}</p>
              <div className="decision-actions">
                <button className={decision.mode === 'accept' ? 'choice-active' : ''} onClick={() => setDecisions(prev => ({ ...prev, [move.assignmentId]: { ...decision, mode: 'accept', date: undefined } }))}>接受建议</button>
                <button className={decision.mode === 'keep' ? 'choice-active' : ''} onClick={() => setDecisions(prev => ({ ...prev, [move.assignmentId]: { ...decision, mode: 'keep', date: undefined } }))}>保持原日期</button>
                <select value={decision.mode === 'custom' ? decision.date ?? '' : ''} onChange={e => setDecisions(prev => ({ ...prev, [move.assignmentId]: { ...decision, mode: 'custom', date: e.target.value } }))}>
                  <option value="">选择其他日期</option>
                  {move.alternatives.map(a => <option key={a.date} value={a.date}>{a.label} · {a.impact}</option>)}
                </select>
                <label className="lock-choice"><input type="checkbox" checked={Boolean(decision.lock)} onChange={e => setDecisions(prev => ({ ...prev, [move.assignmentId]: { ...decision, lock: e.target.checked } }))}/><Lock size={14}/>锁定结果</label>
              </div>
            </article>
          })}
        </div>
      </section>

      {editedIssues.length > 0 && <section className="replan-section warning-section">
        <div className="replan-section-title"><AlertTriangle size={18}/><div><h3>按当前微调结果检查</h3><p>你保持原日期或改选日期后，系统会重新检查主要风险。</p></div></div>
        <div className="warning-list">{editedIssues.map((issue, i) => <div key={`${issue.date??'all'}-${i}`} className={`warning-item issue-${issue.level}`}>{issue.message}</div>)}</div>
      </section>}

      {result.warnings.length > 0 && <section className="replan-section warning-section">
        <div className="replan-section-title"><AlertTriangle size={18}/><div><h3>仍需注意</h3><p>应用前请查看不能自动消除的风险。</p></div></div>
        <div className="warning-list">{result.warnings.slice(0, 20).map((w, i) => <div key={i} className="warning-item">{w}</div>)}</div>
      </section>}

      <div className="modal-actions sticky-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!editedState} onClick={() => editedState && onApply(result, editedState)}>应用当前选择</button></div>
    </>}
  </Modal>
}
