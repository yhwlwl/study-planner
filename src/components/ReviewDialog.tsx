import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { AppState, DurationSuggestion, PlanChangeEvent } from '../types'
import { useApp } from '../AppContext'
import { actualMinutesForAssignmentOnDate, allDurationSuggestions, effectiveMinutes, reviewDaySnapshot, suggestMoveDates } from '../lib/planner'
import { fmtDate, getCapacity, minutesText, todayISO } from '../lib/date'
import { Modal } from './Modal'

export function ReviewDialog({ open, date, onClose, onPreparedDuration }: {
  open: boolean
  date: string
  onClose: () => void
  onPreparedDuration: (state: AppState, event: PlanChangeEvent) => void
}) {
  const { state, completeReview, prepareDurationChange, prepareReviewCompletion } = useApp()
  const snapshot = useMemo(() => reviewDaySnapshot(state, date), [state, date])
  const savedRecord = useMemo(() => state.reviewRecords.find(item => item.date === date), [state.reviewRecords, date])
  const useSavedHistory = Boolean(savedRecord && date < todayISO())
  const plannedIds = useSavedHistory && savedRecord?.plannedAssignmentIds ? savedRecord.plannedAssignmentIds : snapshot.plannedAssignmentIds
  const executedIds = useSavedHistory && savedRecord?.executedAssignmentIds ? savedRecord.executedAssignmentIds : snapshot.executedAssignmentIds
  const unionIds = Array.from(new Set([...plannedIds, ...executedIds]))
  const assignmentMap = useMemo(() => new Map(state.assignments.map(item => [item.id, item])), [state.assignments])
  const plannedTasks = useMemo(() => plannedIds.flatMap(id => assignmentMap.get(id) ? [assignmentMap.get(id)!] : []), [plannedIds.join('|'), assignmentMap])
  const tasks = useMemo(() => unionIds.flatMap(id => assignmentMap.get(id) ? [assignmentMap.get(id)!] : []), [unionIds.join('|'), assignmentMap])
  const groups = useMemo(() => new Map(state.taskGroups.map(item => [item.id, item])), [state.taskGroups])
  const reviewedGroupIds = useMemo(() => new Set(tasks.map(item => item.groupId)), [tasks])
  const suggestions = useMemo(() => allDurationSuggestions(state).filter(item => reviewedGroupIds.has(item.groupId)), [state, reviewedGroupIds])
  const [chartsOpen, setChartsOpen] = useState(false)
  const [completedOpen, setCompletedOpen] = useState(false)
  const [carryDates, setCarryDates] = useState<Record<string, string>>({})

  const completedIds = useSavedHistory && savedRecord?.completedAssignmentIds ? savedRecord.completedAssignmentIds : snapshot.completedAssignmentIds
  const completedSet = useMemo(() => new Set(completedIds), [completedIds.join('|')])
  const plannedSet = useMemo(() => new Set(plannedIds), [plannedIds.join('|')])
  const completed = plannedTasks.filter(item => completedSet.has(item.id))
  const completedDetails = tasks.filter(item => completedSet.has(item.id))
  const unfinishedIds = useSavedHistory && savedRecord ? savedRecord.unfinishedAssignmentIds : snapshot.unfinishedAssignmentIds
  const unfinished = unfinishedIds.flatMap(id => assignmentMap.get(id) ? [assignmentMap.get(id)!] : [])
  const recurringUnfinished = useSavedHistory ? [] : snapshot.recurringUnfinishedAssignmentIds.flatMap(id => assignmentMap.get(id) ? [assignmentMap.get(id)!] : [])
  const executedOutsidePlan = executedIds.filter(id => !plannedIds.includes(id)).length
  const planned = useSavedHistory && savedRecord ? savedRecord.plannedMinutes : snapshot.plannedMinutes
  const actual = useSavedHistory && savedRecord ? savedRecord.actualMinutes : snapshot.actualMinutes
  const inferred = useSavedHistory && savedRecord ? savedRecord.inferredMinutes ?? 0 : snapshot.inferredMinutes
  const actualByTask = useMemo(() => new Map(tasks.map(item => [item.id, actualMinutesForAssignmentOnDate(state, item, date)])), [state, tasks, date])
  const difference = actual - planned
  const displayCompletedCount = useSavedHistory && savedRecord ? savedRecord.completedCount : completed.length
  const displayTotalCount = useSavedHistory && savedRecord ? savedRecord.totalCount : plannedTasks.length
  const completionRate = displayTotalCount ? Math.round(displayCompletedCount / displayTotalCount * 100) : 100
  const selectedCarryCount = Object.values(carryDates).filter(Boolean).length

  useEffect(() => {
    if (!open) return
    const initial: Record<string, string> = {}
    for (const assignment of unfinished) {
      if (assignment.locked || state.timer.assignmentId === assignment.id) {
        initial[assignment.id] = ''
        continue
      }
      initial[assignment.id] = suggestMoveDates(state, assignment.id, 8).find(candidate => candidate > date) ?? ''
    }
    setCarryDates(initial)
    setChartsOpen(false)
    setCompletedOpen(false)
  }, [open, date])

  const recentRecords = useMemo(() => {
    const current = { date, plannedMinutes: planned, actualMinutes: actual, totalCount: displayTotalCount, completedCount: displayCompletedCount }
    return [...state.reviewRecords.filter(record => record.date !== date && record.date <= date), current]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7)
  }, [state.reviewRecords, date, planned, actual, displayTotalCount, displayCompletedCount])
  const todayGroupRows = useMemo(() => {
    const rows = new Map<string, { label: string; first: number; second: number }>()
    for (const task of tasks) {
      const group = groups.get(task.groupId)
      const current = rows.get(task.groupId) ?? { label: group?.title ?? task.groupId, first: 0, second: 0 }
      if (plannedSet.has(task.id)) current.first += task.estimatedMinutes
      current.second += actualByTask.get(task.id) ?? 0
      rows.set(task.groupId, current)
    }
    return [...rows.values()]
  }, [groups, tasks, actualByTask, plannedSet])
  const groupAverageRows = useMemo(() => state.taskGroups.flatMap(group => {
    const completedItems = state.assignments
      .filter(item => item.groupId === group.id && item.status === 'done' && item.actualMinutes > 0)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      .slice(0, 10)
    if (!completedItems.length) return []
    return [{ label: group.title, first: group.unitMinutes, second: Math.round(completedItems.reduce((sum, item) => sum + item.actualMinutes, 0) / completedItems.length) }]
  }), [state.assignments, state.taskGroups])

  const projectedLabel = (assignmentId: string, targetDate: string) => {
    const assignment = state.assignments.find(item => item.id === assignmentId)
    if (!assignment) return targetDate
    const targetLoad = state.assignments
      .filter(item => item.id !== assignment.id && item.scheduledDate === targetDate)
      .reduce((sum, item) => sum + effectiveMinutes(item), 0)
    const projected = targetLoad + effectiveMinutes(assignment)
    const capacity = getCapacity(state, targetDate)
    return `${fmtDate(targetDate)} · ${minutesText(projected)} / ${minutesText(capacity)}${projected > capacity ? ' · 超载' : ''}`
  }

  const finishReview = () => {
    if (selectedCarryCount > 0) {
      const prepared = prepareReviewCompletion(date, carryDates)
      onClose()
      onPreparedDuration(prepared.state, prepared.event)
      return
    }
    completeReview(date)
    onClose()
  }
  const closeAndRecord = () => {
    completeReview(date)
    onClose()
  }
  const acceptSuggestion = (suggestion: DurationSuggestion) => {
    const prepared = prepareDurationChange(suggestion, suggestion.suggestedEstimate, date)
    onClose()
    onPreparedDuration(prepared.state, prepared.event)
  }
  const openReviewSection = (id: string, expand?: 'completed' | 'charts') => {
    if (expand === 'completed') setCompletedOpen(true)
    if (expand === 'charts') setChartsOpen(true)
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return <Modal open={open} title={`${fmtDate(date)} · 结束今天并复盘`} onClose={onClose} wide mobileFullscreen>
    <section className="review-hero">
      <div className="review-progress-ring" style={{ '--review-progress': `${completionRate * 3.6}deg` } as CSSProperties}>
        <div><strong>{completionRate}%</strong><span>完成率</span></div>
      </div>
      <div className="review-hero-copy">
        <span className="review-eyebrow">今日执行结果</span>
        <h2>{displayCompletedCount} / {displayTotalCount} 项计划任务完成</h2>
        <p>{unfinished.length > 0 ? `还有 ${unfinished.length} 项普通任务需要决定是否顺延。` : '普通任务已全部处理完成。'}{recurringUnfinished.length > 0 ? ` 另有 ${recurringUnfinished.length} 项每日重复任务保留原规则。` : ''}{executedOutsidePlan > 0 ? ` 当天还实际执行了 ${executedOutsidePlan} 项原计划外任务，已纳入用时与明细。` : ''}{useSavedHistory ? ' 当前显示的是当日保存的复盘快照，之后的重开或改期不会改写这些汇总。' : ''}</p>
        <div className="review-time-compare"><span>计划 <strong>{minutesText(planned)}</strong></span><b>→</b><span>实际 <strong>{minutesText(actual)}</strong></span><em className={difference > 0 ? 'over' : difference < 0 ? 'under' : 'exact'}>{difference === 0 ? '与预计一致' : `${difference > 0 ? '多' : '少'} ${minutesText(Math.abs(difference))}`}</em></div>
      </div>
    </section>

    <div className="review-summary-grid">
      <ReviewMetric label="已完成" value={`${displayCompletedCount} / ${displayTotalCount}`} detail={`${completionRate}% · 展开任务`} onClick={() => openReviewSection('review-completed', 'completed')}/>
      <ReviewMetric label="计划时间" value={minutesText(planned)} detail="展开计划/实际图表" onClick={() => openReviewSection('review-charts', 'charts')}/>
      <ReviewMetric label="实际时间" value={minutesText(actual)} detail={inferred > 0 ? `另有 ${minutesText(inferred)} 推断负载 · 展开图表` : "展开计划/实际图表"} onClick={() => openReviewSection('review-charts', 'charts')}/>
      <ReviewMetric label="预计差异" value={`${difference > 0 ? '+' : difference < 0 ? '−' : ''}${minutesText(Math.abs(difference))}`} detail="展开误差趋势" onClick={() => openReviewSection('review-charts', 'charts')}/>
      <ReviewMetric label="待处理" value={String(unfinished.length)} detail="展开逐项决定" onClick={() => openReviewSection('review-unfinished')}/>
      <ReviewMetric label="时长建议" value={String(suggestions.length)} detail="展开建议与样本" onClick={() => openReviewSection('review-duration')}/>
    </div>

    <section id="review-unfinished" className="review-section review-unfinished-section">
      <header><div><span className="review-section-index">01</span><div><h3>处理未完成任务</h3><p>原“结束今天”的顺延、保留逾期和完整方案入口已合并到这里。</p></div></div><strong>{unfinished.length} 项</strong></header>
      {unfinished.length === 0 ? <div className="review-empty-success"><strong>无需顺延普通任务</strong><span>可继续查看时长建议或统计图表。</span></div> : <div className="review-task-decision-list">{unfinished.map(item => {
        const group = groups.get(item.groupId)
        const options = suggestMoveDates(state, item.id, 8).filter(candidate => candidate > date).slice(0, 5)
        const movable = !item.locked && state.timer.assignmentId !== item.id
        return <article key={item.id} className="review-task-decision">
          <div className="review-task-decision-main">
            <div className="review-task-title"><span className={`subject-pill subject-${group?.subject ?? '其他'}`}>{group?.subject ?? '其他'}</span><strong>{item.title}</strong>{item.locked && <em>已锁定</em>}{state.timer.assignmentId === item.id && <em>正在计时</em>}</div>
            <div className="review-task-progress"><div><i style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }}/></div><span>{item.progress}% · 剩余约 {minutesText(item.remainingMinutes ?? Math.max(0, item.estimatedMinutes - item.actualMinutes))}</span></div>
          </div>
          <label className="review-carry-choice"><span>结束今天后的安排</span><select disabled={!movable} value={carryDates[item.id] ?? ''} onChange={event => setCarryDates(current => ({ ...current, [item.id]: event.target.value }))}><option value="">保留在 {fmtDate(date)}，之后显示为逾期</option>{options.map(target => <option key={target} value={target}>{projectedLabel(item.id, target)}</option>)}</select>{!movable && <small>锁定或正在计时的任务不能在这里移动。</small>}</label>
        </article>
      })}</div>}
    </section>

    <section id="review-completed" className="review-section">
      <button className="review-section-toggle" onClick={() => setCompletedOpen(value => !value)}><div><span className="review-section-index">02</span><div><h3>已完成任务</h3><p>展开查看每项任务的预计与实际用时。</p></div></div><strong>{completedDetails.length} 项 · {completedOpen ? '收起' : '展开'}</strong></button>
      {completedOpen && <div className="review-completed-grid">{completedDetails.map(item => {
        const taskActual = actualByTask.get(item.id) ?? 0
        const delta = taskActual - item.estimatedMinutes
        return <article key={item.id}><div><strong>{item.title}</strong><span>{groups.get(item.groupId)?.subject ?? '其他'}</span></div><div className="review-completed-times"><span>计划 {minutesText(item.estimatedMinutes)}</span><span>实际 {minutesText(taskActual)}</span><em className={delta > 0 ? 'over' : delta < 0 ? 'under' : 'exact'}>{delta === 0 ? '一致' : `${delta > 0 ? '+' : '−'}${minutesText(Math.abs(delta))}`}</em></div></article>
      })}{completedDetails.length === 0 && <p className="muted-text">当天还没有完成任务。</p>}</div>}
    </section>

    <section id="review-duration" className="review-section review-duration-section">
      <header><div><span className="review-section-index">03</span><div><h3>自适应时长建议</h3><p>历史只提出新预计；先验证现有日期，只有新增冲突才建议最小修复。</p></div></div><strong>{suggestions.length} 项</strong></header>
      {suggestions.length === 0 ? <div className="review-empty-neutral"><strong>暂时没有稳定偏差</strong><span>达到有效样本数和偏差阈值后才会主动建议。</span></div> : <div className="duration-suggestion-list">{suggestions.map(item => {
        const title = groups.get(item.groupId)?.title ?? item.groupId
        const change = item.suggestedEstimate - item.currentEstimate
        return <article key={item.groupId}>
          <div><strong>{title}</strong><span>当前 {item.currentEstimate} 分钟 · 最近 {item.sampleCount} 个有效样本平均 {Math.round(item.recentAverage)} 分钟</span><small>重复偏差 {Math.round(item.deviationRatio * 100)}% · 建议 {item.suggestedEstimate} 分钟</small><div className="duration-delta-track"><i style={{ width: `${Math.min(100, item.currentEstimate / Math.max(item.currentEstimate, item.suggestedEstimate, 1) * 100)}%` }}/><b style={{ width: `${Math.min(100, item.suggestedEstimate / Math.max(item.currentEstimate, item.suggestedEstimate, 1) * 100)}%` }}/></div><em className={change > 0 ? 'over' : 'under'}>{change > 0 ? `建议增加 ${change} 分钟` : `建议减少 ${Math.abs(change)} 分钟`}</em></div>
          <div><button className="secondary-button" onClick={() => acceptSuggestion(item)}>预览更新影响</button></div>
          <details><summary>查看样本（{item.samples.length}）</summary><div className="review-sample-grid">{item.samples.map(sample => <div key={sample.assignmentId}><strong>{state.assignments.find(task => task.id === sample.assignmentId)?.title ?? sample.assignmentId}</strong><span>预计 {sample.estimatedMinutes} / 实际 {sample.actualMinutes} 分钟</span></div>)}</div></details>
        </article>
      })}</div>}
      <p className="review-rule-note">系统不评价正确率、掌握程度或学习质量，也不会自动改变每日上限。</p>
    </section>

    <section id="review-charts" className="review-section review-chart-section">
      <button className="review-section-toggle" onClick={() => setChartsOpen(value => !value)}><div><span className="review-section-index">04</span><div><h3>统计图表</h3><p>默认保持简洁，展开后查看任务、任务组和最近趋势。</p></div></div><strong>{chartsOpen ? '收起图表' : '展开图表'}</strong></button>
      {chartsOpen && <div className="review-charts">
        <SimpleBars title="今日各任务：计划与实际" rows={tasks.map(item => ({ label: item.title, first: plannedSet.has(item.id) ? item.estimatedMinutes : 0, second: actualByTask.get(item.id) ?? 0 }))} firstLabel="计划" secondLabel="实际"/>
        <SimpleBars title="今日各任务组：计划与实际" rows={todayGroupRows} firstLabel="计划" secondLabel="实际"/>
        <SimpleBars title="最近每日学习时间趋势" rows={recentRecords.map(record => ({ label: record.date.slice(5), first: record.plannedMinutes, second: record.actualMinutes }))} firstLabel="计划" secondLabel="实际"/>
        <SimpleBars title="最近完成率趋势" rows={recentRecords.map(record => ({ label: record.date.slice(5), first: record.totalCount, second: record.completedCount }))} firstLabel="总数" secondLabel="完成"/>
        <SimpleBars title="最近预计误差趋势" rows={recentRecords.map(record => ({ label: record.date.slice(5), first: 0, second: Math.abs(record.actualMinutes - record.plannedMinutes) }))} firstLabel="基准" secondLabel="绝对误差"/>
        <SimpleBars title="任务组默认预计与近期平均" rows={groupAverageRows} firstLabel="默认预计" secondLabel="近期实际平均"/>
      </div>}
    </section>

    <div className="modal-actions review-sticky-actions"><button className="secondary-button" onClick={closeAndRecord}>仅保存复盘，暂不顺延</button><button className="primary-button" onClick={finishReview}>完成复盘{selectedCarryCount > 0 ? `并预览顺延 ${selectedCarryCount} 项` : ''}</button></div>
  </Modal>
}

function ReviewMetric({ label, value, detail, onClick }: { label: string; value: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}><strong>{value}</strong><span>{label}</span><small>{detail}</small></button>
}

function SimpleBars({ title, rows, firstLabel = '计划', secondLabel = '实际' }: { title: string; rows: Array<{ label: string; first: number; second: number }>; firstLabel?: string; secondLabel?: string }) {
  const max = Math.max(1, ...rows.flatMap(item => [item.first, item.second]))
  return <section className="simple-chart"><header><h3>{title}</h3><div><span><i/>{firstLabel}</span><span><b/>{secondLabel}</span></div></header>{rows.length === 0 ? <p className="muted-text">暂无足够数据。</p> : <div className="simple-chart-rows">{rows.slice(-12).map((row, index) => <div className="simple-chart-row" key={`${row.label}-${index}`}><span title={row.label}>{row.label}</span><div><i style={{ width: `${row.first / max * 100}%` }}/><b style={{ width: `${row.second / max * 100}%` }}/></div><small>{row.first} / {row.second}</small></div>)}</div>}</section>
}
