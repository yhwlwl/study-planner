import { useEffect, useMemo, useState } from 'react'
import type { AppState, PlanChangeEvent, SchedulingProposal } from '../types'
import { Modal } from './Modal'
import { fmtDate, minutesText } from '../lib/date'

const preferenceLabels: Record<string, string> = { preserve: '尽量保持当前计划', balanced: '均衡执行', goal: '优先保障目标', rest: '增加休息空间' }

export function ProposalDialog({ open, baseline, preparedState, event, proposals, onClose, onApply, onKeep, onGenerateMore }: {
  open: boolean
  baseline: AppState
  preparedState: AppState
  event: PlanChangeEvent
  proposals: SchedulingProposal[]
  onClose: () => void
  onApply: (proposal: SchedulingProposal) => void
  onKeep: () => void
  onGenerateMore?: () => void
}) {
  const initialCount = proposals.length > 2 ? 2 : proposals.length
  const [visibleCount, setVisibleCount] = useState(initialCount)
  const [selectedId, setSelectedId] = useState(proposals[0]?.id ?? '')
  useEffect(() => { setVisibleCount(proposals.length > 2 ? 2 : proposals.length); setSelectedId(proposals[0]?.id ?? '') }, [event.id, proposals.length])
  const selected = useMemo(() => proposals.find(item => item.id === selectedId) ?? proposals[0], [proposals, selectedId])
  const assignmentMap = useMemo(() => new Map([...baseline.assignments, ...preparedState.assignments].map(item => [item.id, item])), [baseline, preparedState])
  const goalMap = useMemo(() => new Map([...baseline.goals, ...preparedState.goals].map(item => [item.id, item])), [baseline, preparedState])
  const showMore = () => { setVisibleCount(proposals.length); onGenerateMore?.() }
  const keepLabel = event.type === 'rule-change' && event.metadata?.currentEstimate != null
    ? '只应用预计，不调整日期'
    : event.type === 'new-task-insertion' || event.type === 'task-group-size-increase'
      ? '创建并保留为未安排'
      : event.type === 'goal-relaxation'
        ? '保存目标，保持当前排期'
        : '应用草稿，保持现有日期'

  return <Modal open={open} title="计划调整预览" onClose={onClose} wide mobileFullscreen>
    <section className="proposal-event"><strong>{event.title}</strong><p>{event.description}</p><div className="proposal-event-tags"><span>{event.affectedAssignmentIds.length} 项任务</span><span>{event.affectedDates.length} 个日期</span><span>{event.affectedGoalIds.length} 个目标</span></div></section>
    {!proposals.length && <div className="empty-state"><h3>未能生成合法方案</h3><p>当前约束下没有可应用结果。你可以保留新内容为未安排状态，再调整日期、容量、目标条件或规则。</p></div>}
    <div className="proposal-choice-list">
      {proposals.slice(0, visibleCount).map(proposal => <button key={proposal.id} className={`proposal-choice ${selected?.id === proposal.id ? 'selected' : ''}`} onClick={() => setSelectedId(proposal.id)}>
        <div><strong>{proposal.title}</strong><small>{preferenceLabels[proposal.preference] ?? proposal.preference} · 影响{proposal.metrics.impactLevel === 'small' ? '较小' : proposal.metrics.impactLevel === 'medium' ? '中等' : '较大'}</small></div>
        <div className="proposal-choice-metrics"><span>移动 {proposal.metrics.movedTaskCount}</span><span>日期 {proposal.metrics.affectedDateCount}</span><span>稳定度 {proposal.metrics.stabilityScore}</span></div>
      </button>)}
    </div>
    {visibleCount < proposals.length && <button className="secondary-button proposal-more" onClick={showMore}>生成更多真正不同的替代方案（{proposals.length - visibleCount}）</button>}
    {selected && <ProposalDetails proposal={selected} assignmentMap={assignmentMap} goalMap={goalMap}/>} 
    <div className="modal-actions proposal-sticky-actions">
      <button className="secondary-button" onClick={onClose}>取消</button>
      <button className="secondary-button" onClick={onKeep}>{keepLabel}</button>
      <button className="primary-button" disabled={!selected || selected.infeasible} onClick={() => selected && onApply(selected)}>应用所选方案</button>
    </div>
  </Modal>
}

function ProposalDetails({ proposal, assignmentMap, goalMap }: { proposal: SchedulingProposal; assignmentMap: Map<string, any>; goalMap: Map<string, any> }) {
  return <div className="proposal-details">
    {proposal.infeasible && <div className="proposal-warning"><strong>当前方案不可行</strong><p>{proposal.infeasibleReason}</p></div>}
    <div className="proposal-summary-grid">
      <Metric label="新增任务" value={proposal.metrics.newTaskCount}/><Metric label="移动任务" value={proposal.metrics.movedTaskCount}/><Metric label="受影响日期" value={proposal.metrics.affectedDateCount}/><Metric label="问题" value={proposal.metrics.issueCount}/><Metric label="手动任务移动" value={proposal.metrics.manualTaskMoveCount}/><Metric label="保护日期例外" value={proposal.metrics.protectedDateUseCount}/>
    </div>
    <details open><summary>任务变化（{proposal.movements.length}）</summary><div className="proposal-cards">
      {proposal.movements.length === 0 && <p className="muted-text">现有任务无需移动。</p>}
      {proposal.movements.map(move => <article key={move.assignmentId} className="proposal-card"><strong>{assignmentMap.get(move.assignmentId)?.title ?? move.assignmentId}</strong><div className="before-after"><span><small>之前</small>{move.fromDate ? fmtDate(move.fromDate) : '未安排'} · {minutesText(move.beforeLoad)}</span><span><small>之后</small>{move.toDate ? fmtDate(move.toDate) : '未安排'} · {minutesText(move.afterLoad)}</span></div><p>{move.reason}</p><small>{move.goalImpact} · 手动意图：{move.manualIntentImpact === 'preserved' ? '已保护' : move.manualIntentImpact === 'moved-manual' ? '此方案会移动手动安排' : move.manualIntentImpact === 'locked-blocked' ? '被锁定阻止' : '无影响'}</small>
      {move.rejectedAlternatives.length > 0 && <details><summary>为什么没有安排到其他日期</summary>{move.rejectedAlternatives.map(item => <div className="rejected-date" key={item.date}><strong>{fmtDate(item.date)}</strong><ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>)}</details>}</article>)}
    </div></details>
    <details><summary>日期负载前后（{proposal.dateChanges.length}）</summary><div className="proposal-cards">{proposal.dateChanges.map(change => <article className="proposal-card" key={change.date}><strong>{fmtDate(change.date)}</strong><div className="before-after"><span><small>之前</small>{minutesText(change.beforeMinutes)} · {change.beforeTaskIds.length}项</span><span><small>之后</small>{minutesText(change.afterMinutes)} · {change.afterTaskIds.length}项</span></div><p>净变化：{change.afterMinutes - change.beforeMinutes >= 0 ? '+' : ''}{minutesText(change.afterMinutes - change.beforeMinutes)}</p></article>)}</div></details>
    <details><summary>目标影响（{proposal.goalImpacts.length}）</summary><div className="proposal-cards">{proposal.goalImpacts.map(impact => <article className="proposal-card" key={impact.goalId}><strong>{goalMap.get(impact.goalId)?.title ?? impact.goalId}</strong><div className="before-after"><span><small>之前</small>{Math.round(impact.beforeProgress * 100)}% · {impact.beforeExpectedCompletion ?? '无法预计'}</span><span><small>之后</small>{Math.round(impact.afterProgress * 100)}% · {impact.afterExpectedCompletion ?? '无法预计'}</span></div><p>{impact.summary}</p><small>期望日期风险：{impact.desiredRiskAfter ? '有' : '无'} · 最晚日期风险：{impact.latestRiskAfter ? '有' : '无'}</small></article>)}</div></details>
    <details><summary>问题明细（{proposal.issues.length}）</summary><div className="proposal-cards">{proposal.issues.map(issue => <article className="proposal-card" key={issue.id}><strong>{issue.title}</strong><p>{issue.detail}</p>{(issue.currentValue || issue.allowedValue) && <div className="before-after"><span><small>当前</small>{issue.currentValue ?? '—'}</span><span><small>允许</small>{issue.allowedValue ?? '—'}</span></div>}<small>后果：{issue.consequence}</small><p>处理：{issue.resolution}</p></article>)}</div></details>
    <details><summary>一次性例外（{proposal.exceptions.length}）</summary>{proposal.exceptions.length ? proposal.exceptions.map(item => <div className="exception-row" key={`${item.date}-${item.key}`}><strong>{fmtDate(item.date)}</strong><span>{item.label}</span><em>只影响本次方案，不修改永久默认值</em></div>) : <p className="muted-text">没有使用任何一次性例外。</p>}</details>
    <details><summary>计算依据</summary><p>{proposal.description}</p><p>平均负载：{minutesText(proposal.metrics.beforeAverageLoad)} → {minutesText(proposal.metrics.afterAverageLoad)}；最高负载：{minutesText(proposal.metrics.beforeMaxLoad)} → {minutesText(proposal.metrics.afterMaxLoad)}；原日期保留率 {Math.round(proposal.metrics.originalDateRetention * 100)}%。</p></details>
  </div>
}
function Metric({ label, value }: { label: string; value: number }) { return <div><strong>{value}</strong><span>{label}</span></div> }
