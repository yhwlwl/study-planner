import { useEffect, useMemo, useState } from 'react'
import type { AppState, Assignment, Goal, PlanAdjustmentPolicy, PlanChangeEvent, SchedulingProposal } from '../types'
import { Modal } from './Modal'
import { fmtDate, minutesText } from '../lib/date'
import { reviseSchedulingProposal, type ProposalMovementRevision } from '../lib/planner'

const preferenceLabels: Record<string, string> = {
  preserve: '尽量保持当前计划', balanced: '均衡执行', goal: '优先保障目标', rest: '增加休息空间'
}

function recommendedProposal(proposals: SchedulingProposal[]) {
  return proposals.find(item => !item.infeasible) ?? proposals[0]
}

function initialVisibleCount(proposals: SchedulingProposal[]) {
  if (proposals.length <= 1) return proposals.length
  return proposals[0]?.infeasible ? Math.min(2, proposals.length) : 1
}

export function ProposalDialog({ open, baseline, preparedState, event, proposals, policy, moreExhausted, onClose, onApply, onKeep, onGenerateMore }: {
  open: boolean
  baseline: AppState
  preparedState: AppState
  event: PlanChangeEvent
  proposals: SchedulingProposal[]
  policy: PlanAdjustmentPolicy
  moreExhausted?: boolean
  onClose: () => void
  onApply: (proposal: SchedulingProposal) => void
  onKeep: () => void
  onGenerateMore?: () => void
}) {
  const initial = recommendedProposal(proposals)
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount(proposals))
  const [selectedId, setSelectedId] = useState(initial?.id ?? '')
  const [exceptionsAccepted, setExceptionsAccepted] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, SchedulingProposal>>({})
  useEffect(() => {
    const next = recommendedProposal(proposals)
    setVisibleCount(initialVisibleCount(proposals))
    setSelectedId(next?.id ?? '')
    setExceptionsAccepted(false)
    setDrafts({})
  }, [event.id])
  const selectedBase = useMemo(() => proposals.find(item => item.id === selectedId) ?? recommendedProposal(proposals), [proposals, selectedId])
  const selected = selectedBase ? drafts[selectedBase.id] ?? selectedBase : undefined
  const recommendedId = recommendedProposal(proposals)?.id
  const assignmentMap = useMemo(() => new Map<string, Assignment>([...baseline.assignments, ...preparedState.assignments].map(item => [item.id, item])), [baseline, preparedState])
  const goalMap = useMemo(() => new Map<string, Goal>([...baseline.goals, ...preparedState.goals].map(item => [item.id, item])), [baseline, preparedState])
  const directConflict = proposals.find(item => item.infeasible && item.title === policy.directPreviewLabel)
  const showMore = () => {
    if (visibleCount < proposals.length) setVisibleCount(proposals.length)
    else onGenerateMore?.()
  }
  const keepLabel = event.metadata?.containsReviewRecord
    ? '只保存复盘，不顺延任务'
    : event.type === 'bulk-move'
      ? '不执行这次批量移动'
      : event.type === 'availability-change' && event.metadata?.pureRelaxation !== true
        ? '保存可用时间，暂不移动任务'
        : event.type === 'new-task-insertion' || event.type === 'task-group-size-increase'
          ? '创建并保留为未安排'
          : undefined

  return <Modal open={open} title="计划调整预览" onClose={onClose} wide mobileFullscreen>
    <section className="proposal-event">
      <span className="proposal-event-kicker">发生了什么</span>
      <strong>{event.title}</strong><p>{event.description}</p>
      <div className="proposal-policy-note"><strong>本次处理方式</strong><span>{policy.explanation}</span></div>
    </section>

    {directConflict && <section className="proposal-direct-conflict">
      <div><strong>你的原选择中发现 {directConflict.issues.length} 个问题</strong><span>合法选择保持不变；系统推荐只处理冲突项。</span></div>
      <button type="button" className="secondary-button" onClick={() => setSelectedId(directConflict.id)}>查看原选择的问题</button>
    </section>}

    {!proposals.length && <div className="empty-state"><h3>未能生成合法方案</h3><p>当前约束下没有可应用结果。系统不会强行安排；可调整日期、容量、目标条件或规则。</p></div>}

    <section className="proposal-options-heading">
      <div><strong>{proposals.length > 1 ? '选择一个方案' : '确认本次改动'}</strong><span>任何方案都只会在你确认后执行。</span></div>
      {proposals.length > 1 && <small>已生成 {proposals.length} 个实质不同方案</small>}
    </section>
    <div className="proposal-choice-list">
      {proposals.slice(0, visibleCount).map(proposal => {
        const display = drafts[proposal.id] ?? proposal
        const selectedChoice = selectedBase?.id === proposal.id
        return <button key={proposal.id} className={`proposal-choice ${selectedChoice ? 'selected' : ''} ${proposal.infeasible ? 'proposal-choice-infeasible' : ''}`} onClick={() => { setSelectedId(proposal.id); setExceptionsAccepted(false) }}>
          <div className="proposal-choice-title"><div><strong>{display.title}</strong><small>{preferenceLabels[display.preference] ?? display.preference} · 影响{display.metrics.impactLevel === 'small' ? '较小' : display.metrics.impactLevel === 'medium' ? '中等' : '较大'}</small></div><span>{proposal.id === recommendedId ? '推荐' : selectedChoice ? '已选择' : '可选'}</span></div>
          <div className="proposal-choice-metrics"><span>{display.metrics.movedTaskCount} 项移动</span><span>{display.metrics.affectedDateCount} 天变化</span><span>{display.metrics.issueCount} 个问题</span><span>{display.metrics.stabilityScore}% 稳定性</span>{display.exceptions.length > 0 && <em>需确认一次性例外</em>}</div>
          <p>{display.infeasible ? display.infeasibleReason : display.description}</p>
        </button>
      })}
    </div>
    {(visibleCount < proposals.length || onGenerateMore) && <button className="secondary-button proposal-more" disabled={Boolean(moreExhausted && visibleCount >= proposals.length)} onClick={showMore}>{visibleCount < proposals.length ? `比较另外 ${proposals.length - visibleCount} 个已生成方案` : moreExhausted ? '已检查更大范围，没有更多实质不同方案' : '生成更多不同方案'}</button>}

    {selected && selectedBase && <ProposalDetails proposal={selected} event={event} baseline={baseline} assignmentMap={assignmentMap} goalMap={goalMap} onRevise={revision => { const revised = reviseSchedulingProposal(baseline, event, selected, revision); setDrafts(current => ({ ...current, [selectedBase.id]: revised })); setExceptionsAccepted(false) }}/>} 
    {selected?.exceptions.length ? <label className="proposal-exception-confirm"><input type="checkbox" checked={exceptionsAccepted} onChange={eventValue => setExceptionsAccepted(eventValue.target.checked)}/><span><strong>我确认使用这些一次性例外</strong><small>只对预览中列出的日期和规则生效，不修改永久默认值。</small></span></label> : null}
    <div className="modal-actions proposal-sticky-actions">
      <button className="secondary-button" onClick={onClose}>取消</button>
      {keepLabel && <button className="secondary-button" onClick={onKeep}>{keepLabel}</button>}
      <button className="primary-button" disabled={!selected || selected.infeasible || Boolean(selected.exceptions.length && !exceptionsAccepted)} onClick={() => selected && onApply(selected)}>{selected?.movements.length || selected?.structuralChanges.length ? '应用预览中的改动' : '确认并保存'}</button>
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
    {proposal.infeasible && <div className="proposal-warning"><strong>这个方案目前不能执行</strong><p>{proposal.infeasibleReason}</p></div>}
    <section className="proposal-human-summary"><span>方案结果</span><h3>{proposal.infeasible ? `发现 ${proposal.issues.length} 个问题` : proposal.goalImpacts.some(item => item.latestRiskAfter) ? '可执行，但仍有最晚期限风险' : '已通过完整执行检查'}</h3><p>{proposal.metrics.manualTaskMoveCount ? '该方案会触及手动安排，请重点检查对应明细。' : '手动安排保持受保护。'} 默认只展示结论；点击数字可展开完整任务、日期、目标和计算依据。</p></section>
    <div className="proposal-summary-grid">
      <ExpandableMetric label="检测到的问题" value={proposal.metrics.issueCount} tone={proposal.metrics.issueCount ? 'danger' : 'success'} onClick={() => openSection(proposal.id, 'issues')}/>
      <ExpandableMetric label="移动任务" value={proposal.metrics.movedTaskCount} onClick={() => openSection(proposal.id, 'moves')}/>
      <ExpandableMetric label="受影响日期" value={proposal.metrics.affectedDateCount} onClick={() => openSection(proposal.id, 'dates')}/>
      <ExpandableMetric label="新增任务" value={proposal.metrics.newTaskCount} onClick={() => openSection(proposal.id, 'new')}/>
      <ExpandableMetric label="手动安排受影响" value={proposal.metrics.manualTaskMoveCount} tone={proposal.metrics.manualTaskMoveCount ? 'warning' : 'success'} onClick={() => openSection(proposal.id, 'manual')}/>
      <ExpandableMetric label="字段与结构变化" value={proposal.structuralChanges.length} onClick={() => openSection(proposal.id, 'structural')}/>
      <ExpandableMetric label="一次性例外" value={proposal.exceptions.length} tone={proposal.exceptions.length ? 'warning' : undefined} onClick={() => openSection(proposal.id, 'exceptions')}/>
      <ExpandableMetric label="计划稳定性" value={`${proposal.metrics.stabilityScore}%`} onClick={() => openSection(proposal.id, 'calculation')}/>
    </div>

    <details id={`proposal-${proposal.id}-issues`}><summary>问题明细（{proposal.issues.length}）</summary><div className="proposal-cards">{proposal.issues.map(issue => <article className="proposal-card proposal-issue-card" key={issue.id}><strong>{issue.title}</strong><p>{issue.detail}</p>{issue.assignmentIds.length > 0 && <details><summary>涉及任务（{issue.assignmentIds.length}）</summary><ul>{issue.assignmentIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></details>}{(issue.currentValue || issue.allowedValue) && <div className="before-after"><span><small>调整后</small>{issue.currentValue ?? '—'}</span><span><small>允许</small>{issue.allowedValue ?? '—'}</span></div>}<small>后果：{issue.consequence}</small><p>建议处理：{issue.resolution}</p></article>)}{proposal.issues.length === 0 && <p className="muted-text">没有发现新的硬冲突。</p>}</div></details>

    <details id={`proposal-${proposal.id}-moves`}><summary>任务变化（{proposal.movements.length}）</summary><div className="proposal-cards">
      {proposal.movements.length === 0 && <p className="muted-text">现有任务日期无需移动。</p>}
      {proposal.movements.map(move => {
        const afterTask = proposal.stateAfter.assignments.find(item => item.id === move.assignmentId)
        const baselineTask = baseline.assignments.find(item => item.id === move.assignmentId)
        return <article key={move.assignmentId} className="proposal-card proposal-movement-card"><strong>{assignmentMap.get(move.assignmentId)?.title ?? move.assignmentId}</strong><div className="before-after"><span><small>之前</small>{move.fromDate ? fmtDate(move.fromDate) : '未安排'} · 当日 {minutesText(move.beforeLoad)}</span><span><small>之后</small>{move.toDate ? fmtDate(move.toDate) : '未安排'} · 当日 {minutesText(move.afterLoad)}</span></div><p>{move.reason}</p><small>{move.goalImpact} · 手动意图：{move.manualIntentImpact === 'preserved' ? '已保护' : move.manualIntentImpact === 'moved-manual' ? '此方案会移动手动安排' : move.manualIntentImpact === 'locked-blocked' ? '被锁定阻止' : '无影响'}</small>
          {!proposal.infeasible && <div className="proposal-movement-editor"><div><strong>逐项微调</strong><small>修改后会重新验算容量、每日上限、目标和日期保护。</small></div><div className="proposal-movement-actions">{baselineTask?.scheduledDate && <button type="button" className="secondary-button" disabled={move.toDate === baselineTask.scheduledDate} onClick={() => onRevise({ assignmentId: move.assignmentId, date: baselineTask.scheduledDate, lock: false })}>保留原日期</button>}<input aria-label="自定义目标日期" type="date" min={baseline.settings.startDate} max={baseline.settings.endDate} value={move.toDate ?? ''} onChange={eventValue => onRevise({ assignmentId: move.assignmentId, date: eventValue.target.value || undefined, lock: Boolean(afterTask?.locked) })}/><label><input type="checkbox" checked={Boolean(afterTask?.locked)} onChange={eventValue => onRevise({ assignmentId: move.assignmentId, date: move.toDate, lock: eventValue.target.checked })}/><span>锁定这个结果</span></label></div></div>}
          {move.rejectedAlternatives.length > 0 && <details><summary>为什么没有安排到其他日期</summary>{move.rejectedAlternatives.map(item => <div className="rejected-date" key={item.date}><strong>{fmtDate(item.date)}</strong><ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>)}</details>}</article>
      })}
    </div></details>

    <details id={`proposal-${proposal.id}-dates`}><summary>日期负载与任务前后（{proposal.dateChanges.length}）</summary><div className="proposal-cards">{proposal.dateChanges.map(change => {
      const delta = change.afterMinutes - change.beforeMinutes
      const capacityDelta = (change.afterCapacity ?? 0) - (change.beforeCapacity ?? 0)
      const capacityChanged = change.beforeCapacity != null && change.afterCapacity != null && capacityDelta !== 0
      return <article className="proposal-card proposal-date-card" key={change.date}><strong>{fmtDate(change.date)}</strong><div className="before-after"><span><small>之前</small>负载 {minutesText(change.beforeMinutes)} · {change.beforeTaskIds.length}项{change.beforeCapacity != null && <em>容量 {minutesText(change.beforeCapacity)}</em>}</span><span><small>之后</small>负载 {minutesText(change.afterMinutes)} · {change.afterTaskIds.length}项{change.afterCapacity != null && <em>容量 {minutesText(change.afterCapacity)}</em>}</span></div><p className={`load-delta ${delta > 0 ? 'load-delta-up' : delta < 0 ? 'load-delta-down' : 'load-delta-flat'}`}>{delta > 0 ? '↑ 负载增加' : delta < 0 ? '↓ 负载减少' : '— 负载不变'} {minutesText(Math.abs(delta))}</p>{capacityChanged && <p className={`capacity-delta ${capacityDelta > 0 ? 'capacity-delta-up' : 'capacity-delta-down'}`}>{capacityDelta > 0 ? '↑ 可用容量增加' : '↓ 可用容量减少'} {minutesText(Math.abs(capacityDelta))}</p>}<div className="proposal-date-task-lists"><div><small>之前的任务</small><ul>{change.beforeTaskIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></div><div><small>之后的任务</small><ul>{change.afterTaskIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></div></div></article>
    })}{proposal.dateChanges.length === 0 && <p className="muted-text">日期负载和可用容量没有变化。</p>}</div></details>

    <details><summary>目标影响（{proposal.goalImpacts.length}）</summary><div className="proposal-cards">{proposal.goalImpacts.map(impact => <article className="proposal-card" key={impact.goalId}><strong>{goalMap.get(impact.goalId)?.title ?? impact.goalId}</strong><div className="before-after"><span><small>之前</small>{Math.round(impact.beforeProgress * 100)}% · {impact.beforeExpectedCompletion ?? '无法预计'}</span><span><small>之后</small>{Math.round(impact.afterProgress * 100)}% · {impact.afterExpectedCompletion ?? '无法预计'}</span></div><p>{impact.summary}</p><small>期望日期风险：{impact.desiredRiskAfter ? '有' : '无'} · 最晚日期风险：{impact.latestRiskAfter ? '有' : '无'}</small></article>)}{proposal.goalImpacts.length === 0 && <p className="muted-text">目标进度和风险没有变化。</p>}</div></details>

    <details id={`proposal-${proposal.id}-new`}><summary>本次新增或纳入的任务（{newTaskIds.length}）</summary><ul className="proposal-name-list">{newTaskIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}{newTaskIds.length === 0 && <li>本次不是新增任务事件。</li>}</ul></details>
    <details id={`proposal-${proposal.id}-manual`}><summary>手动安排影响（{manualMoves.length}）</summary>{manualMoves.length ? <ul className="proposal-name-list">{manualMoves.map(item => <li key={item.assignmentId}>{assignmentMap.get(item.assignmentId)?.title ?? item.assignmentId}：{item.fromDate ?? '未安排'} → {item.toDate ?? '未安排'}</li>)}</ul> : <p className="muted-text">没有移动任何手动安排任务。</p>}</details>
    <details id={`proposal-${proposal.id}-structural`}><summary>字段与结构前后变化（{proposal.structuralChanges.length}）</summary><div className="proposal-cards">{proposal.structuralChanges.length ? proposal.structuralChanges.map(change => <article className="proposal-card structural-change-card" key={`${change.entityType}-${change.entityId}`}><div className="structural-change-head"><strong>{change.title}</strong><span>{change.changeType === 'added' ? '新增' : change.changeType === 'removed' ? '移除' : '修改'}</span></div>{change.fields.map(field => <div className="before-after structural-field" key={field.label}><span><small>{field.label} · 之前</small>{field.before ?? '—'}</span><span><small>{field.label} · 之后</small>{field.after ?? '—'}</span></div>)}</article>) : <p className="muted-text">除日期安排外，没有其他字段或结构变化。</p>}</div></details>
    <details id={`proposal-${proposal.id}-exceptions`}><summary>一次性例外（{proposal.exceptions.length}）</summary>{proposal.exceptions.length ? proposal.exceptions.map(item => <div className="exception-row" key={`${item.date}-${item.rawKey ?? item.key}`}><strong>{fmtDate(item.date)}</strong><span>{item.label}</span><em>只影响本次方案，不修改永久默认值</em></div>) : <p className="muted-text">没有使用任何一次性例外。</p>}</details>
    <details id={`proposal-${proposal.id}-calculation`}><summary>计算依据与稳定性（{proposal.metrics.stabilityScore}%）</summary><p>{proposal.description}</p><p>平均负载：{minutesText(proposal.metrics.beforeAverageLoad)} → {minutesText(proposal.metrics.afterAverageLoad)}；最高负载：{minutesText(proposal.metrics.beforeMaxLoad)} → {minutesText(proposal.metrics.afterMaxLoad)}；原日期保留率 {Math.round(proposal.metrics.originalDateRetention * 100)}%。稳定性同时考虑移动数量、移动距离、手动意图、受影响日期、负载变化、目标影响和日期保护。</p></details>
  </div>
}

function ExpandableMetric({ label, value, tone, onClick }: { label: string; value: number | string; tone?: 'danger' | 'warning' | 'success'; onClick: () => void }) {
  return <button type="button" className={tone ? `metric-${tone}` : ''} onClick={onClick}><strong>{value}</strong><span>{label}</span><small>展开查看</small></button>
}
