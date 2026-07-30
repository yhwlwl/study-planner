import { useEffect, useMemo, useState } from 'react'
import { Plus, RotateCcw, Settings, Target, Trash2 } from 'lucide-react'
import type { AppState, Goal, GoalCondition, GoalConditionMode, GoalDraft, PlanChangeEvent } from '../types'
import { useApp } from '../AppContext'
import { goalProgress } from '../lib/goals'
import { uid } from '../lib/id'
import { fmtDate, minutesText } from '../lib/date'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

export function GoalsPage({ onPrepared }: { onPrepared: (prepared: AppState, event: PlanChangeEvent) => void }) {
  const { state, commit, prepareGoalChange, prepareGoalDelete } = useApp()
  const [editing, setEditing] = useState<Goal | null | undefined>()
  const [deleteGoal, setDeleteGoal] = useState<Goal>()
  const goals = useMemo(() => [...state.goals].sort((a,b) => (a.status === 'archived' ? 1 : 0) - (b.status === 'archived' ? 1 : 0) || a.latestDate.localeCompare(b.latestDate)), [state.goals])
  const assignmentMap = useMemo(() => new Map(state.assignments.map(item => [item.id, item])), [state.assignments])
  const groupMap = useMemo(() => new Map(state.taskGroups.map(item => [item.id, item])), [state.taskGroups])

  const save = (draft: GoalDraft, goalId?: string) => {
    const prepared = prepareGoalChange(draft, goalId)
    setEditing(undefined)
    onPrepared(prepared.state, prepared.event)
  }
  const remove = () => {
    if (!deleteGoal) return
    const prepared = prepareGoalDelete(deleteGoal.id)
    setDeleteGoal(undefined)
    onPrepared(prepared.state, prepared.event)
  }
  const toggleArchive = (goal: Goal) => commit(draft => {
    const item = draft.goals.find(candidate => candidate.id === goal.id)
    if (!item) return
    item.status = item.status === 'archived' ? 'active' : 'archived'
    item.updatedAt = new Date().toISOString()
  })

  return <div className="goals-page">
    <div className="section-toolbar"><div><h2>目标</h2><p>目标定义要完成什么以及期望与最晚日期；修改目标只生成建议，不直接移动任务。</p></div><button className="primary-button" onClick={() => setEditing(null)}><Plus size={17}/>创建目标</button></div>
    {goals.length === 0 ? <div className="empty-state"><h3>还没有目标</h3><p>创建目标后，可以为一个或多个任务组设置全部、百分比或数量完成条件。</p><button className="primary-button" onClick={() => setEditing(null)}>创建第一个目标</button></div> : <div className="goal-grid">{goals.map(goal => {
      const progress = goalProgress(state, goal)
      const linkedGroups = new Set([...goal.linkedTaskGroupIds, ...goal.completionConditions.map(item => item.groupId)])
      const shared = state.goals.filter(other => other.id !== goal.id && [...linkedGroups].some(id => other.linkedTaskGroupIds.includes(id) || other.completionConditions.some(condition => condition.groupId === id)))
      return <article className={`goal-card goal-${goal.status}`} key={goal.id}>
        <header><div><span className="status-pill">{goal.status === 'active' ? '进行中' : goal.status === 'completed' ? '已完成' : '已归档'}</span><h3>{goal.title}</h3>{goal.description && <p>{goal.description}</p>}</div><div className="row-actions"><button className="icon-button" title="编辑" onClick={() => setEditing(goal)}><Settings size={17}/></button><button className="icon-button" title={goal.status === 'archived' ? '取消归档' : '归档'} onClick={() => toggleArchive(goal)}>{goal.status === 'archived' ? <RotateCcw size={17}/> : <Target size={17}/>}</button><button className="icon-button danger" title="删除" onClick={() => setDeleteGoal(goal)}><Trash2 size={17}/></button></div></header>
        <div className="goal-progress"><div><span style={{ width: `${Math.round(progress.progress * 100)}%` }}/></div><strong>{progress.completedCount} / {progress.requiredCount} · {Math.round(progress.progress * 100)}%</strong></div>
        <div className="goal-date-grid"><div><small>期望完成</small><strong>{goal.desiredDate ? fmtDate(goal.desiredDate) : '未设置'}</strong><em className={progress.desiredRisk ? 'risk' : ''}>{progress.desiredRisk ? '存在风险' : '正常'}</em></div><div><small>最晚完成</small><strong>{fmtDate(goal.latestDate)}</strong><em className={progress.latestRisk ? 'risk' : ''}>{progress.latestRisk ? '可能不可行' : '正常'}</em></div><div><small>预计完成</small><strong>{progress.expectedCompletion ? fmtDate(progress.expectedCompletion) : progress.completed ? '已完成' : '尚无法预计'}</strong></div><div><small>剩余工作</small><strong>{minutesText(progress.estimatedRemainingMinutes)}</strong></div></div>
        <details><summary>完成条件（{goal.completionConditions.length}）</summary><div className="goal-condition-list">{progress.conditionDetails.map(detail => <div key={detail.conditionId}><strong>{groupMap.get(detail.groupId)?.title ?? '已删除任务组'}</strong><span>{detail.mode === 'all' ? '全部完成' : detail.mode === 'percentage' ? `完成 ${goal.completionConditions.find(item => item.id === detail.conditionId)?.value ?? 0}%` : `完成 ${goal.completionConditions.find(item => item.id === detail.conditionId)?.value ?? 0} 项`} · 当前 {detail.completed}/{detail.required}</span><details><summary>查看计入的具体任务（{detail.countedAssignmentIds.length}）</summary><ul>{detail.countedAssignmentIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></details></div>)}</div></details>
        {goal.linkedAssignmentIds.length > 0 && <details><summary>直接关联任务（{goal.linkedAssignmentIds.length}）</summary><ul>{goal.linkedAssignmentIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></details>}
        {shared.length > 0 && <details><summary>共享任务组的其他目标（{shared.length}）</summary><ul>{shared.map(item => <li key={item.id}>{item.title} · 最晚 {fmtDate(item.latestDate)}</li>)}</ul></details>}
      </article>
    })}</div>}
    <GoalDialog open={editing !== undefined} state={state} initial={editing ?? undefined} onClose={() => setEditing(undefined)} onSave={save}/>
    <Modal open={Boolean(deleteGoal)} title="删除目标前影响预览" onClose={() => setDeleteGoal(undefined)}>
      {deleteGoal && <><p>将删除目标“{deleteGoal.title}”，不会删除任何任务，也不会自动把工作推迟。</p><ul><li>关联任务组：{deleteGoal.linkedTaskGroupIds.length}</li><li>完成条件：{deleteGoal.completionConditions.length}</li><li>直接关联任务：{deleteGoal.linkedAssignmentIds.length}</li></ul><p>删除后会显示“保持当前排期”与减负等候选方案，并创建可恢复版本。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setDeleteGoal(undefined)}>取消</button><button className="danger-button" onClick={remove}>继续查看方案</button></div></>}
    </Modal>
  </div>
}

function GoalDialog({ open, state, initial, onClose, onSave }: { open: boolean; state: AppState; initial?: Goal; onClose: () => void; onSave: (draft: GoalDraft, goalId?: string) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [desiredDate, setDesiredDate] = useState(initial?.desiredDate ?? '')
  const [latestDate, setLatestDate] = useState(initial?.latestDate ?? state.settings.endDate)
  const [conditions, setConditions] = useState<GoalCondition[]>(initial?.completionConditions ?? [])
  const [assignmentIds, setAssignmentIds] = useState<string[]>(initial?.linkedAssignmentIds ?? [])
  const resetKey = `${open}-${initial?.id ?? 'new'}`
  useEffect(() => { setTitle(initial?.title ?? ''); setDescription(initial?.description ?? ''); setDesiredDate(initial?.desiredDate ?? ''); setLatestDate(initial?.latestDate ?? state.settings.endDate); setConditions(initial?.completionConditions ?? []); setAssignmentIds(initial?.linkedAssignmentIds ?? []) }, [resetKey, initial, state.settings.endDate])
  const availableGroups = state.taskGroups.filter(group => !group.hiddenStandalone && group.status !== 'archived')
  const addCondition = () => { const groupId = availableGroups.find(group => !conditions.some(item => item.groupId === group.id))?.id; if (groupId) setConditions(current => [...current, { id: uid('condition'), groupId, mode: 'all' }]) }
  const patchCondition = (id: string, patch: Partial<GoalCondition>) => setConditions(current => current.map(item => item.id === id ? { ...item, ...patch } : item))
  const submit = () => { if (!title.trim() || !latestDate || (desiredDate && desiredDate > latestDate) || (conditions.length === 0 && assignmentIds.length === 0)) return; onSave({ title: title.trim(), description: description.trim() || undefined, desiredDate: desiredDate || undefined, latestDate, completionConditions: conditions, linkedTaskGroupIds: Array.from(new Set(conditions.map(item => item.groupId))), linkedAssignmentIds: assignmentIds }, initial?.id) }
  return <Modal open={open} title={initial ? '编辑目标' : '创建目标'} onClose={onClose} wide mobileFullscreen>
    <div className="form-grid"><label className="field span-2"><span>目标名称</span><input value={title} onChange={event => setTitle(event.target.value)}/></label><label className="field span-2"><span>说明</span><textarea rows={2} value={description} onChange={event => setDescription(event.target.value)}/></label><label className="field"><span>期望完成日期（软约束）</span><input type="date" value={desiredDate} onChange={event => setDesiredDate(event.target.value)}/></label><label className="field"><span>最晚完成日期（硬目标）</span><input type="date" value={latestDate} onChange={event => setLatestDate(event.target.value)}/></label>{desiredDate && desiredDate > latestDate && <div className="form-error span-2">期望完成日期不能晚于最晚完成日期。</div>}
      <fieldset className="field span-2 condition-editor"><legend>任务组完成条件</legend>{conditions.map(condition => <div className="condition-row" key={condition.id}><select value={condition.groupId} onChange={event => patchCondition(condition.id, { groupId: event.target.value })}>{availableGroups.map(group => <option key={group.id} value={group.id}>{group.subject} · {group.title}</option>)}</select><select value={condition.mode} onChange={event => patchCondition(condition.id, { mode: event.target.value as GoalConditionMode, value: event.target.value === 'all' ? undefined : condition.value ?? (event.target.value === 'percentage' ? 50 : 1) })}><option value="all">全部任务</option><option value="percentage">完成百分比</option><option value="count">完成数量</option></select>{condition.mode !== 'all' && <NumericInput min={1} max={condition.mode === 'percentage' ? 100 : 999} value={condition.value ?? 1} onValueChange={value => patchCondition(condition.id, { value })}/>}<button className="icon-button danger" onClick={() => setConditions(current => current.filter(item => item.id !== condition.id))}><Trash2 size={16}/></button></div>)}<button className="secondary-button" disabled={!availableGroups.some(group => !conditions.some(item => item.groupId === group.id))} onClick={addCondition}><Plus size={16}/>添加条件</button></fieldset>
      <fieldset className="field span-2 exceptional-links"><legend>直接关联的特殊单项任务（可选）</legend><div>{state.assignments.filter(item => item.standalone || state.taskGroups.find(group => group.id === item.groupId)?.hiddenStandalone).slice(0,100).map(item => <label key={item.id}><input type="checkbox" checked={assignmentIds.includes(item.id)} onChange={event => setAssignmentIds(current => event.target.checked ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))}/><span>{item.title}</span></label>)}</div></fieldset>
      <div className="form-note span-2">一个任务组可服务多个目标；调度按最近的相关期限判断紧迫性，不会因为关联目标更多而重复加权或重复统计。</div>
    </div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!title.trim() || !latestDate || Boolean(desiredDate && desiredDate > latestDate) || (conditions.length === 0 && assignmentIds.length === 0)} onClick={submit}>保存并预览影响</button></div>
  </Modal>
}
