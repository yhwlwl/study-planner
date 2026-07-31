import { useEffect, useMemo, useState } from 'react'
import type { AppState, Assignment, Goal, PlanChangeEvent, SchedulingProposal } from '../types'
import { Modal } from './Modal'
import { fmtDate, minutesText } from '../lib/date'
import { reviseSchedulingProposal, type ProposalMovementRevision } from '../lib/planner'

const preferenceLabels: Record<string, string> = {
  preserve: '尽量保持当前计划', balanced: '均衡执行', goal: '优先保障目标', rest: '增加休息空间'
}

function initialVisibleCount(proposals: SchedulingProposal[]) {
  if (proposals.length <= 1) return proposals.length
  const largest = proposals.some(item => item.metrics.impactLevel === 'large')
  const medium = proposals.some(item => item.metrics.impactLevel === 'medium')
  return Math.min(proposals.length, largest ? 3 : medium ? 2 : 1)
}

export function ProposalDialog({ open, baseline, preparedState, event, proposals, moreExhausted, onClose, onApply, onKeep, onGenerateMore }: {
  open: boolean
  baseline: AppState
  preparedState: AppState
  event: PlanChangeEvent
  proposals: SchedulingProposal[]
  moreExhausted?: boolean
  onClose: () => void
  onApply: (proposal: SchedulingProposal) => void
  onKeep: () => void
  onGenerateMore?: () => void
}) {
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount(proposals))
  const [selectedId, setSelectedId] = useState(proposals[0]?.id ?? '')
  const [exceptionsAccepted, setExceptionsAccepted] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, SchedulingProposal>>({})
  useEffect(() => {
    setVisibleCount(initialVisibleCount(proposals))
    setSelectedId(proposals[0]?.id ?? '')
    setExceptionsAccepted(false)
    setDrafts({})
  }, [event.id, proposals.length])
  const selectedBase = useMemo(() => proposals.find(item => item.id === selectedId) ?? proposals[0], [proposals, selectedId])
  const selected = selectedBase ? drafts[selectedBase.id] ?? selectedBase : undefined
  const assignmentMap = useMemo(() => new Map<string, Assignment>([...baseline.assignments, ...preparedState.assignments].map(item => [item.id, item])), [baseline, preparedState])
  const goalMap = useMemo(() => new Map<string, Goal>([...baseline.goals, ...preparedState.goals].map(item => [item.id, item])), [baseline, preparedState])
  const showMore = () => {
    if (visibleCount < proposals.length) setVisibleCount(proposals.length)
    else onGenerateMore?.()
  }
  const keepLabel = event.type === 'rule-change' && event.metadata?.currentEstimate != null
    ? '只应用新预计，日期不变'
    : event.metadata?.containsReviewRecord
      ? '只保存复盘，不顺延任务'
    : event.type === 'bulk-move'
    ? '不执行这次批量移动'
    : event.type === 'execution-difference' || event.type === 'load-preference-change' || event.type === 'future-replanning'
      ? '不调整，关闭'
      : event.type === 'availability-change'
        ? '保存可用时间，暂不移动任务'
    : event.type === 'new-task-insertion' || event.type === 'task-group-size-increase'
      ? '创建并真正保留为未安排'
      : event.type === 'goal-relaxation'
        ? '保存目标，保持当前排期'
        : '应用草稿，保持现有日期'

  return <Modal open={open} title="计划调整方案" onClose={onClose} wide mobileFullscreen>
    <section className="proposal-event">
      <span className="proposal-event-kicker">发生了什么</span>
      <strong>{event.title}</strong><p>{event.description}</p>
      <small className="proposal-event-note">下面的摘要数字均可展开到具体任务、日期、目标和原因。</small>
    </section>
    {!proposals.length && <div className="empty-state"><h3>未能生成合法方案</h3><p>当前约束下没有可应用结果。新内容仍可保留为未安排，再调整日期、容量、目标条件或规则。</p></div>}
    <div className="proposal-choice-list">
      {proposals.slice(0, visibleCount).map(proposal => {
        const display = drafts[proposal.id] ?? proposal
        return <button key={proposal.id} className={`proposal-choice ${selectedBase?.id === proposal.id ? 'selected' : ''}`} onClick={() => { setSelectedId(proposal.id); setExceptionsAccepted(false) }}>
          <div><strong>{display.title}</strong><small>{preferenceLabels[display.preference] ?? display.preference} · 影响{display.metrics.impactLevel === 'small' ? '较小' : display.metrics.impactLevel === 'medium' ? '中等' : '较大'}</small></div>
          <div className="proposal-choice-metrics"><span>{display.metrics.stabilityScore >= 90 ? '高稳定' : display.metrics.stabilityScore >= 75 ? '中等扰动' : '改动较多'}</span><span>{display.infeasible ? '仍不可执行' : display.goalImpacts.some(item => item.latestRiskAfter) ? '仍有目标风险' : '已通过执行检查'}</span>{display.exceptions.length > 0 && <em>需要确认一次性例外</em>}</div>
        </button>
      })}
    </div>
    {(visibleCount < proposals.length || onGenerateMore) && <button className="secondary-button proposal-more" disabled={Boolean(moreExhausted && visibleCount >= proposals.length)} onClick={showMore}>{visibleCount < proposals.length ? `查看另外 ${proposals.length - visibleCount} 个已生成的不同方案` : moreExhausted ? '已检查更大范围，没有更多实质不同方案' : '扩大候选范围，继续计算不同方案'}</button>}
    {selected && selectedBase && <ProposalDetails proposal={selected} event={event} baseline={baseline} assignmentMap={assignmentMap} goalMap={goalMap} onRevise={revision => { const revised = reviseSchedulingProposal(baseline, event, selected, revision); setDrafts(current => ({ ...current, [selectedBase.id]: revised })); setExceptionsAccepted(false) }}/>}
    {selected?.exceptions.length ? <label className="proposal-exception-confirm"><input type="checkbox" checked={exceptionsAccepted} onChange={eventValue => setExceptionsAccepted(eventValue.target.checked)}/><span><strong>我确认使用这些一次性例外</strong><small>只对所列日期和规则生效，不会改写任务组或全局永久默认值；应用后会记录在本地计划版本中。</small></span></label> : null}
    <div className="modal-actions proposal-sticky-actions">
      <button className="secondary-button" onClick={onClose}>取消</button>
      <button className="secondary-button" onClick={onKeep}>{keepLabel}</button>
      <button className="primary-button" disabled={!selected || selected.infeasible || Boolean(selected.exceptions.length && !exceptionsAccepted)} onClick={() => selected && onApply(selected)}>应用所选方案</button>
    </div>
  </Modal>
}

function openSection(proposalId: string, section: string) {
  const element = document.getElementById(`proposal-${proposalId}-${section}`) as HTMLDetailsElement | null
  if (!element) return
  element.open = true
  element.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function ProposalDetails({ proposal, event, baseline, assignmentMap, goalMap, onRevise }: { proposal: SchedulingProposal; event: PlanChangeEvent; baseline: AppState; assignmentMap: Map<string, Assignment>; goalMap: Map<string, Goal>; onRevise: (revision: ProposalMovementRevision) => void }) {
  const newTaskIds = event.type === 'new-task-insertion' || event.type === 'task-group-size-increase' ? event.affectedAssignmentIds : []
  const manualMoves = proposal.movements.filter(item => item.manualIntentImpact === 'moved-manual')
  return <div className="proposal-details">
    {proposal.infeasible && <div className="proposal-warning"><strong>当前方案不可行</strong><p>{proposal.infeasibleReason}</p></div>}
    <section className="proposal-human-summary"><span>方案结果</span><h3>{proposal.infeasible ? '仍有任务无法合法安排' : proposal.goalImpacts.some(item => item.latestRiskAfter) ? '可以调整，但仍有最晚期限风险' : '当前候选通过可执行性检查'}</h3><p>{proposal.metrics.manualTaskMoveCount ? '该候选会触及手动安排，请重点检查对应明细。' : '手动安排保持受保护。'} 所有定量结果都集中在下方指标中，可展开查看来源和计算依据。</p></section>
    <div className="proposal-summary-grid">
      <ExpandableMetric label="新增任务" value={proposal.metrics.newTaskCount} onClick={() => openSection(proposal.id, 'new')}/>
      <ExpandableMetric label="移动任务" value={proposal.metrics.movedTaskCount} onClick={() => openSection(proposal.id, 'moves')}/>
      <ExpandableMetric label="受影响日期" value={proposal.metrics.affectedDateCount} onClick={() => openSection(proposal.id, 'dates')}/>
      <ExpandableMetric label="检测到的问题" value={proposal.metrics.issueCount} onClick={() => openSection(proposal.id, 'issues')}/>
      <ExpandableMetric label="手动安排受影响" value={proposal.metrics.manualTaskMoveCount} onClick={() => openSection(proposal.id, 'manual')}/>
      <ExpandableMetric label="字段与结构变化" value={proposal.structuralChanges.length} onClick={() => openSection(proposal.id, 'structural')}/>
      <ExpandableMetric label="一次性例外" value={proposal.exceptions.length} onClick={() => openSection(proposal.id, 'exceptions')}/>
      <ExpandableMetric label="计划稳定性" value={`${proposal.metrics.stabilityScore}%`} onClick={() => openSection(proposal.id, 'calculation')}/>
    </div>

    <details id={`proposal-${proposal.id}-new`}><summary>本次新增或纳入的任务（{newTaskIds.length}）</summary><ul className="proposal-name-list">{newTaskIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}{newTaskIds.length === 0 && <li>本次不是新增任务事件。</li>}</ul></details>
    <details id={`proposal-${proposal.id}-moves`} open><summary>任务变化（{proposal.movements.length}）</summary><div className="proposal-cards">
      {proposal.movements.length === 0 && <p className="muted-text">现有任务无需移动。</p>}
      {proposal.movements.map(move => {
        const afterTask = proposal.stateAfter.assignments.find(item => item.id === move.assignmentId)
        const baselineTask = baseline.assignments.find(item => item.id === move.assignmentId)
        return <article key={move.assignmentId} className="proposal-card proposal-movement-card"><strong>{assignmentMap.get(move.assignmentId)?.title ?? move.assignmentId}</strong><div className="before-after"><span><small>之前</small>{move.fromDate ? fmtDate(move.fromDate) : '未安排'} · 当日 {minutesText(move.beforeLoad)}</span><span><small>之后</small>{move.toDate ? fmtDate(move.toDate) : '未安排'} · 当日 {minutesText(move.afterLoad)}</span></div><p>{move.reason}</p><small>{move.goalImpact} · 手动意图：{move.manualIntentImpact === 'preserved' ? '已保护' : move.manualIntentImpact === 'moved-manual' ? '此方案会移动手动安排' : move.manualIntentImpact === 'locked-blocked' ? '被锁定阻止' : '无影响'}</small>
          <div className="proposal-movement-editor"><div><strong>逐项微调</strong><small>修改后会重新验算容量、每日上限、目标和日期保护。</small></div><div className="proposal-movement-actions">{baselineTask?.scheduledDate && <button type="button" className="secondary-button" disabled={move.toDate === baselineTask.scheduledDate} onClick={() => onRevise({ assignmentId: move.assignmentId, date: baselineTask.scheduledDate, lock: false })}>保留原日期</button>}<input aria-label="自定义目标日期" type="date" min={baseline.settings.startDate} max={baseline.settings.endDate} value={move.toDate ?? ''} onChange={eventValue => onRevise({ assignmentId: move.assignmentId, date: eventValue.target.value || undefined, lock: Boolean(afterTask?.locked) })}/><label><input type="checkbox" checked={Boolean(afterTask?.locked)} onChange={eventValue => onRevise({ assignmentId: move.assignmentId, date: move.toDate, lock: eventValue.target.checked })}/><span>锁定这个结果</span></label></div></div>
          {move.rejectedAlternatives.length > 0 && <details><summary>为什么没有安排到其他日期</summary>{move.rejectedAlternatives.map(item => <div className="rejected-date" key={item.date}><strong>{fmtDate(item.date)}</strong><ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>)}</details>}</article>
      })}
    </div></details>

    <details id={`proposal-${proposal.id}-dates`}><summary>日期负载与任务前后（{proposal.dateChanges.length}）</summary><div className="proposal-cards">{proposal.dateChanges.map(change => <article className="proposal-card" key={change.date}><strong>{fmtDate(change.date)}</strong><div className="before-after"><span><small>之前</small>{minutesText(change.beforeMinutes)} · {change.beforeTaskIds.length}项</span><span><small>之后</small>{minutesText(change.afterMinutes)} · {change.afterTaskIds.length}项</span></div><div className="proposal-date-task-lists"><div><small>之前的任务</small><ul>{change.beforeTaskIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></div><div><small>之后的任务</small><ul>{change.afterTaskIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></div></div><p>净变化：{change.afterMinutes - change.beforeMinutes >= 0 ? '+' : '−'}{minutesText(Math.abs(change.afterMinutes - change.beforeMinutes))}</p></article>)}</div></details>

    <details><summary>目标影响（{proposal.goalImpacts.length}）</summary><div className="proposal-cards">{proposal.goalImpacts.map(impact => <article className="proposal-card" key={impact.goalId}><strong>{goalMap.get(impact.goalId)?.title ?? impact.goalId}</strong><div className="before-after"><span><small>之前</small>{Math.round(impact.beforeProgress * 100)}% · {impact.beforeExpectedCompletion ?? '无法预计'}</span><span><small>之后</small>{Math.round(impact.afterProgress * 100)}% · {impact.afterExpectedCompletion ?? '无法预计'}</span></div><p>{impact.summary}</p><small>期望日期风险：{impact.desiredRiskAfter ? '有' : '无'} · 最晚日期风险：{impact.latestRiskAfter ? '有' : '无'}</small></article>)}</div></details>

    <details id={`proposal-${proposal.id}-issues`}><summary>问题明细（{proposal.issues.length}）</summary><div className="proposal-cards">{proposal.issues.map(issue => <article className="proposal-card" key={issue.id}><strong>{issue.title}</strong><p>{issue.detail}</p>{issue.assignmentIds.length > 0 && <details><summary>涉及任务（{issue.assignmentIds.length}）</summary><ul>{issue.assignmentIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></details>}{(issue.currentValue || issue.allowedValue) && <div className="before-after"><span><small>当前</small>{issue.currentValue ?? '—'}</span><span><small>允许</small>{issue.allowedValue ?? '—'}</span></div>}<small>后果：{issue.consequence}</small><p>处理：{issue.resolution}</p></article>)}</div></details>

    <details id={`proposal-${proposal.id}-manual`}><summary>手动安排影响（{manualMoves.length}）</summary>{manualMoves.length ? <ul className="proposal-name-list">{manualMoves.map(item => <li key={item.assignmentId}>{assignmentMap.get(item.assignmentId)?.title ?? item.assignmentId}：{item.fromDate ?? '未安排'} → {item.toDate ?? '未安排'}</li>)}</ul> : <p className="muted-text">没有移动任何手动安排任务。</p>}</details>

    <details id={`proposal-${proposal.id}-structural`}><summary>字段与结构前后变化（{proposal.structuralChanges.length}）</summary><div className="proposal-cards">{proposal.structuralChanges.length ? proposal.structuralChanges.map(change => <article className="proposal-card structural-change-card" key={`${change.entityType}-${change.entityId}`}><div className="structural-change-head"><strong>{change.title}</strong><span>{change.changeType === 'added' ? '新增' : change.changeType === 'removed' ? '移除' : '修改'}</span></div>{change.fields.map(field => <div className="before-after structural-field" key={field.label}><span><small>{field.label} · 之前</small>{field.before ?? '—'}</span><span><small>{field.label} · 之后</small>{field.after ?? '—'}</span></div>)}</article>) : <p className="muted-text">除日期安排外，没有其他字段或结构变化。</p>}</div></details>

    <details id={`proposal-${proposal.id}-exceptions`}><summary>一次性例外（{proposal.exceptions.length}）</summary>{proposal.exceptions.length ? proposal.exceptions.map(item => <div className="exception-row" key={`${item.date}-${item.rawKey ?? item.key}`}><strong>{fmtDate(item.date)}</strong><span>{item.label}</span><em>只影响本次方案，不修改永久默认值</em></div>) : <p className="muted-text">没有使用任何一次性例外。</p>}</details>
    <details id={`proposal-${proposal.id}-calculation`}><summary>计算依据与稳定性（{proposal.metrics.stabilityScore}%）</summary><p>{proposal.description}</p><p>平均负载：{minutesText(proposal.metrics.beforeAverageLoad)} → {minutesText(proposal.metrics.afterAverageLoad)}；最高负载：{minutesText(proposal.metrics.beforeMaxLoad)} → {minutesText(proposal.metrics.afterMaxLoad)}；原日期保留率 {Math.round(proposal.metrics.originalDateRetention * 100)}%。稳定性同时考虑移动数量、移动距离、手动意图、受影响日期、负载变化、目标影响和日期保护，并不等于只数移动任务。</p></details>
  </div>
}

function ExpandableMetric({ label, value, onClick }: { label: string; value: number | string; onClick: () => void }) {
  return <button type="button" onClick={onClick}><strong>{value}</strong><span>{label}</span><small>展开查看</small></button>
}
