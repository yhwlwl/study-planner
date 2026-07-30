import { useMemo, useState } from 'react'
import type { AppState, DurationSuggestion, PlanChangeEvent } from '../types'
import { useApp } from '../AppContext'
import { allDurationSuggestions } from '../lib/planner'
import { fmtDate, minutesText } from '../lib/date'
import { Modal } from './Modal'

export function ReviewDialog({ open, date, onClose, onPreparedDuration }: { open: boolean; date: string; onClose: () => void; onPreparedDuration: (state: AppState, event: PlanChangeEvent) => void }) {
  const { state, recordReview, prepareDurationChange } = useApp()
  const tasks = useMemo(() => state.assignments.filter(item => item.scheduledDate === date), [state.assignments, date])
  const groups = useMemo(() => new Map(state.taskGroups.map(item => [item.id, item])), [state.taskGroups])
  const suggestions = useMemo(() => allDurationSuggestions(state), [state])
  const [chartsOpen, setChartsOpen] = useState(false)
  const planned = tasks.reduce((sum,item) => sum + item.estimatedMinutes,0)
  const actual = tasks.reduce((sum,item) => sum + item.actualMinutes,0)
  const completed = tasks.filter(item => item.status === 'done')
  const unfinished = tasks.filter(item => item.status !== 'done')
  const closeAndRecord = () => { recordReview(date); onClose() }
  const acceptSuggestion = (suggestion: DurationSuggestion) => { const prepared = prepareDurationChange(suggestion); onClose(); onPreparedDuration(prepared.state, prepared.event) }
  const recentRecords = state.reviewRecords.slice(-10)
  const todayGroupRows = useMemo(() => {
    const rows = new Map<string, { label: string; first: number; second: number }>()
    for (const task of tasks) {
      const group = groups.get(task.groupId)
      const current = rows.get(task.groupId) ?? { label: group?.title ?? task.groupId, first: 0, second: 0 }
      current.first += task.estimatedMinutes
      current.second += task.actualMinutes
      rows.set(task.groupId, current)
    }
    return [...rows.values()]
  }, [groups, tasks])
  const groupAverageRows = useMemo(() => state.taskGroups.flatMap(group => {
    const completedItems = state.assignments.filter(item => item.groupId === group.id && item.status === 'done' && item.actualMinutes > 0).slice(-10)
    if (!completedItems.length) return []
    return [{ label: group.title, first: group.unitMinutes, second: Math.round(completedItems.reduce((sum, item) => sum + item.actualMinutes, 0) / completedItems.length) }]
  }), [state.assignments, state.taskGroups])
  return <Modal open={open} title={`${fmtDate(date)} · 每日复盘`} onClose={closeAndRecord} wide mobileFullscreen>
    <div className="review-summary-grid"><ReviewMetric label="已完成" value={`${completed.length} / ${tasks.length}`}/><ReviewMetric label="计划时间" value={minutesText(planned)}/><ReviewMetric label="实际时间" value={minutesText(actual)}/><ReviewMetric label="预计差异" value={`${actual-planned >= 0 ? '+' : ''}${minutesText(actual-planned)}`}/><ReviewMetric label="未完成任务" value={String(unfinished.length)}/><ReviewMetric label="时长建议" value={String(suggestions.length)}/></div>
    <details><summary>已完成任务（{completed.length}）</summary><ul>{completed.map(item => <li key={item.id}>{item.title} · 计划 {minutesText(item.estimatedMinutes)} / 实际 {minutesText(item.actualMinutes)}</li>)}</ul></details>
    <details open={unfinished.length > 0}><summary>未完成任务（{unfinished.length}）</summary>{unfinished.length ? <ul>{unfinished.map(item => <li key={item.id}>{item.title} · {item.progress}% · 剩余约 {minutesText(item.remainingMinutes ?? Math.max(0,item.estimatedMinutes-item.actualMinutes))}</li>)}</ul> : <p className="muted-text">今天的任务已经全部完成。</p>}<p className="muted-text">延期、保留今日或重新安排仍使用原有“结束今天”流程，不在复盘中重复实现。</p></details>
    <details open={suggestions.length > 0}><summary>自适应时长建议（{suggestions.length}）</summary><div className="duration-suggestion-list">{suggestions.map(item => <article key={item.groupId}><div><strong>{groups.get(item.groupId)?.title ?? item.groupId}</strong><span>当前 {item.currentEstimate} 分钟 · 最近 {item.sampleCount} 个有效样本平均 {Math.round(item.recentAverage)} 分钟</span><small>重复偏差 {Math.round(item.deviationRatio*100)}% · 建议 {item.suggestedEstimate} 分钟</small></div><div><button className="secondary-button" onClick={() => acceptSuggestion(item)}>考虑此建议</button></div><details><summary>查看样本（{item.samples.length}）</summary><ul>{item.samples.map(sample => <li key={sample.assignmentId}>{state.assignments.find(task => task.id === sample.assignmentId)?.title ?? sample.assignmentId}：预计 {sample.estimatedMinutes} / 实际 {sample.actualMinutes} 分钟</li>)}</ul></details></article>)}</div><p className="muted-text">历史只产生建议，不覆盖完成历史、自定义时长或当前日期；接受后仍要选择“只改预计”或排期方案。系统不评价正确率、掌握程度或学习质量。</p></details>
    <button className="secondary-button review-chart-toggle" onClick={() => setChartsOpen(value => !value)}>{chartsOpen ? '收起统计图表' : '展开统计图表'}</button>
    {chartsOpen && <div className="review-charts">
      <SimpleBars title="今日各任务：计划与实际" rows={tasks.map(item => ({ label:item.title, first:item.estimatedMinutes, second:item.actualMinutes }))} firstLabel="计划" secondLabel="实际"/>
      <SimpleBars title="今日各任务组：计划与实际" rows={todayGroupRows} firstLabel="计划" secondLabel="实际"/>
      <SimpleBars title="最近每日学习时间趋势" rows={recentRecords.map(record => ({ label:record.date.slice(5), first:record.plannedMinutes, second:record.actualMinutes }))} firstLabel="计划" secondLabel="实际"/>
      <SimpleBars title="最近完成率趋势" rows={recentRecords.map(record => ({ label:record.date.slice(5), first:record.totalCount, second:record.completedCount }))} firstLabel="总数" secondLabel="完成"/>
      <SimpleBars title="最近预计误差趋势" rows={recentRecords.map(record => ({ label:record.date.slice(5), first:0, second:Math.abs(record.actualMinutes-record.plannedMinutes) }))} firstLabel="基准" secondLabel="绝对误差"/>
      <SimpleBars title="任务组默认预计与近期平均" rows={groupAverageRows} firstLabel="默认预计" secondLabel="近期实际平均"/>
    </div>}
    <div className="modal-actions"><button className="primary-button" onClick={closeAndRecord}>完成复盘</button></div>
  </Modal>
}
function ReviewMetric({label,value}:{label:string;value:string}){return <div><strong>{value}</strong><span>{label}</span></div>}
function SimpleBars({title,rows,firstLabel='计划',secondLabel='实际'}:{title:string;rows:Array<{label:string;first:number;second:number}>;firstLabel?:string;secondLabel?:string}){const max=Math.max(1,...rows.flatMap(item=>[item.first,item.second]));return <section className="simple-chart"><h3>{title}</h3>{rows.length===0?<p className="muted-text">暂无足够数据。</p>:rows.slice(-12).map((row,index)=><div className="simple-chart-row" key={`${row.label}-${index}`}><span>{row.label}</span><div><i style={{width:`${row.first/max*100}%`}}/><b style={{width:`${row.second/max*100}%`}}/></div><small>{firstLabel} {row.first} / {secondLabel} {row.second}</small></div>)}<p>浅条：{firstLabel}；深条：{secondLabel}。</p></section>}
