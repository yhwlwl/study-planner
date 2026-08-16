import { useEffect, useMemo, useState } from 'react'
import { Plus, RotateCcw, Settings, Target, Trash2 } from 'lucide-react'
import type { AppState, Goal, GoalCondition, GoalConditionMode, GoalDraft, PlanChangeEvent, Priority } from '../types'
import { useApp } from '../AppContext'
import { goalProgress } from '../lib/goals'
import { uid } from '../lib/id'
import { fmtDate, minutesText } from '../lib/date'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

export function GoalsPage({ onPrepared, tutorialMode = false, onTutorialBlocked }: { onPrepared: (prepared: AppState, event: PlanChangeEvent) => void; tutorialMode?: boolean; onTutorialBlocked?: (message?: string) => void }) {
  const { state, commit, prepareGoalChange, prepareGoalDelete, updateGoalMetadata } = useApp()
  const [editing, setEditing] = useState<Goal | null | undefined>()
  const goals = useMemo(() => [...state.goals].sort((a,b) => (a.status === 'archived' ? 1 : 0) - (b.status === 'archived' ? 1 : 0) || a.latestDate.localeCompare(b.latestDate)), [state.goals])
  const assignmentMap = useMemo(() => new Map(state.assignments.map(item => [item.id, item])), [state.assignments])
  const groupMap = useMemo(() => new Map(state.taskGroups.map(item => [item.id, item])), [state.taskGroups])

  const save = (draft: GoalDraft, goalId?: string) => {
    const existing = goalId ? state.goals.find(goal => goal.id === goalId) : undefined
    if (!existing && draft.completionConditions.length === 0 && draft.linkedAssignmentIds.length === 0) {
      const now = new Date().toISOString()
      commit(next => {
        next.goals.push({
          id: uid('goal'), title: draft.title, description: draft.description, priority: draft.priority,
          desiredDate: draft.desiredDate, latestDate: draft.latestDate, status: 'active',
          completionConditions: [], linkedTaskGroupIds: [], linkedAssignmentIds: [], createdAt: now, updatedAt: now,
        })
      })
      setEditing(undefined)
      return
    }
    const sameScheduling = Boolean(existing
      && draft.priority === existing.priority
      && (draft.desiredDate ?? undefined) === (existing.desiredDate ?? undefined)
      && draft.latestDate === existing.latestDate
      && JSON.stringify(draft.completionConditions.map(condition => [condition.groupId, condition.mode, condition.value ?? null]))
        === JSON.stringify(existing.completionConditions.map(condition => [condition.groupId, condition.mode, condition.value ?? null]))
      && Array.from(draft.linkedTaskGroupIds).sort().join('|') === Array.from(existing.linkedTaskGroupIds).sort().join('|')
      && Array.from(draft.linkedAssignmentIds).sort().join('|') === Array.from(existing.linkedAssignmentIds).sort().join('|'))
    if (existing && sameScheduling) {
      // 名称/描述等纯展示字段属于元数据：直接保存，不触发调度/冲突/方案/版本；无变化则只关闭。
      if (draft.title !== existing.title || (draft.description ?? '') !== (existing.description ?? '')) {
        updateGoalMetadata(existing.id, { title: draft.title, description: draft.description })
      }
      setEditing(undefined)
      return
    }
    const prepared = prepareGoalChange(draft, goalId)
    setEditing(undefined)
    onPrepared(prepared.state, prepared.event)
  }
  const toggleArchive = (goal: Goal) => commit(draft => {
    const item = draft.goals.find(candidate => candidate.id === goal.id)
    if (!item || item.status === 'active') return
    item.status = item.status === 'archived' ? 'completed' : 'archived'
    item.updatedAt = new Date().toISOString()
  })

  return <div className="goals-page">
    <div className="section-toolbar"><div><h2>目标</h2><p>目标定义要完成什么以及期望与最晚日期；修改目标只生成建议，不直接移动任务。</p></div><button className={`primary-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} onClick={() => tutorialMode ? onTutorialBlocked?.('教程中先查看现有目标，不新增目标') : setEditing(null)}><Plus size={17}/>创建目标</button></div>
    {goals.length === 0 ? <div className="empty-state"><h3>还没有目标</h3><p>{tutorialMode ? '教程数据正在恢复，请稍候。' : '创建目标后，可以为一个或多个任务组设置全部、百分比或数量完成条件。'}</p><button className={`primary-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} onClick={() => tutorialMode ? onTutorialBlocked?.('教程中先查看现有目标') : setEditing(null)}>创建第一个目标</button></div> : <div className="goal-grid">{goals.map(goal => {
      const progress = goalProgress(state, goal)
      const linkedGroups = new Set([...goal.linkedTaskGroupIds, ...goal.completionConditions.map(item => item.groupId)])
      const shared = state.goals.filter(other => other.id !== goal.id && [...linkedGroups].some(id => other.linkedTaskGroupIds.includes(id) || other.completionConditions.some(condition => condition.groupId === id)))
      return <article className={`goal-card goal-${goal.status}`} data-tutorial-target={goal.id === 'tutorial-goal-math' ? 'tutorial-goal' : undefined} key={goal.id}>
        <header><div><div className="goal-card-kicker"><span className="status-pill">{goal.status === 'active' ? '进行中' : goal.status === 'completed' ? '已完成' : '已归档'}</span><span className="goal-priority-pill">{goal.priority === 5 ? '核心' : goal.priority === 3 ? '高' : goal.priority === 2 ? '中' : goal.priority === 1 ? '低' : '可选'}</span></div><h3>{goal.title}</h3>{goal.description && <p>{goal.description}</p>}</div><div className="row-actions"><button className={`icon-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} title="编辑" onClick={() => tutorialMode ? onTutorialBlocked?.('教程中先查看目标，不修改它') : setEditing(goal)}><Settings size={17}/><span className="mobile-action-label">编辑</span></button><button className={`icon-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || goal.status === 'active' ? true : undefined} disabled={!tutorialMode && goal.status === 'active'} title={goal.status === 'active' ? '目标完成后才能归档' : goal.status === 'archived' ? '取消归档' : '归档'} onClick={() => tutorialMode ? onTutorialBlocked?.('教程中暂不归档目标') : toggleArchive(goal)}>{goal.status === 'archived' ? <RotateCcw size={17}/> : <Target size={17}/>}<span className="mobile-action-label">{goal.status === 'archived' ? '取消归档' : '归档'}</span></button><button className={`icon-button danger ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} aria-label={`删除目标${goal.title}`} onClick={() => { if (tutorialMode) { onTutorialBlocked?.('教程中暂不删除目标'); return }; const prepared = prepareGoalDelete(goal.id); onPrepared(prepared.state, prepared.event) }}><Trash2 size={17}/><span className="mobile-action-label">删除</span></button></div></header>
        <div className="goal-progress"><div><span style={{ width: `${Math.round(progress.progress * 100)}%` }}/></div><strong>{progress.completedCount} / {progress.requiredCount} · {Math.round(progress.progress * 100)}%</strong></div>
        <div className="goal-date-grid"><div><small>期望完成</small><strong>{goal.desiredDate ? fmtDate(goal.desiredDate) : '未设置'}</strong><em className={!progress.completed && progress.desiredRisk ? 'risk' : progress.completed && progress.desiredMet === false ? 'risk' : ''}>{progress.completed ? (goal.desiredDate ? progress.desiredMet ? '按期达到' : '晚于期望' : '未设置软日期') : progress.desiredRisk ? '存在风险' : '正常'}</em></div><div><small>最晚完成</small><strong>{fmtDate(goal.latestDate)}</strong><em className={!progress.completed && progress.latestRisk ? 'risk' : progress.completed && progress.latestMet === false ? 'risk' : ''}>{progress.completed ? progress.latestMet ? '按期完成' : '逾期完成' : progress.latestRisk ? '可能不可行' : '正常'}</em></div><div><small>{progress.completed ? '实际完成' : '预计完成'}</small><strong>{progress.completed ? progress.actualCompletionDate ? fmtDate(progress.actualCompletionDate) : '已完成' : progress.expectedCompletion ? fmtDate(progress.expectedCompletion) : '尚无法预计'}</strong></div><div><small>剩余工作</small><strong>{minutesText(progress.estimatedRemainingMinutes)}</strong></div></div>{progress.completed && <div className={`goal-completion-outcome ${progress.latestMet === false ? 'late' : 'on-time'}`}><strong>{progress.latestMet === false ? '目标已完成，但晚于最晚日期' : '目标已完成并满足最晚日期'}</strong><span>{progress.actualCompletionDate ? `实际达成：${fmtDate(progress.actualCompletionDate)}` : '已保留完成历史'}；归档只整理展示，不会删除任务或执行记录。</span></div>}
        <details><summary>完成条件（{goal.completionConditions.length}）</summary><div className="goal-condition-list">{progress.conditionDetails.map(detail => <div key={detail.conditionId}><strong>{groupMap.get(detail.groupId)?.title ?? '已删除任务组'}</strong><span>{detail.mode === 'all' ? '全部完成' : detail.mode === 'percentage' ? `完成 ${goal.completionConditions.find(item => item.id === detail.conditionId)?.value ?? 0}%` : `完成 ${goal.completionConditions.find(item => item.id === detail.conditionId)?.value ?? 0} 项`} · 当前 {detail.completed}/{detail.required}</span><details><summary>查看计入的具体任务（{detail.countedAssignmentIds.length}）</summary><ul>{detail.countedAssignmentIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></details></div>)}</div></details>
        {goal.linkedAssignmentIds.length > 0 && <details><summary>直接关联任务（{goal.linkedAssignmentIds.length}）</summary><ul>{goal.linkedAssignmentIds.map(id => <li key={id}>{assignmentMap.get(id)?.title ?? id}</li>)}</ul></details>}
        {shared.length > 0 && <details><summary>共享任务组的其他目标（{shared.length}）</summary><ul>{shared.map(item => <li key={item.id}>{item.title} · 最晚 {fmtDate(item.latestDate)}</li>)}</ul></details>}
      </article>
    })}</div>}
    <GoalDialog open={!tutorialMode && editing !== undefined} state={state} initial={editing ?? undefined} onClose={() => setEditing(undefined)} onSave={save}/>
  </div>
}

function GoalDialog({ open, state, initial, onClose, onSave }: { open: boolean; state: AppState; initial?: Goal; onClose: () => void; onSave: (draft: GoalDraft, goalId?: string) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 3)
  const [desiredDate, setDesiredDate] = useState(initial?.desiredDate ?? '')
  const [latestDate, setLatestDate] = useState(initial?.latestDate ?? state.settings.endDate)
  const [conditions, setConditions] = useState<GoalCondition[]>(initial?.completionConditions ?? [])
  const [assignmentIds, setAssignmentIds] = useState<string[]>(initial?.linkedAssignmentIds ?? [])
  const [assignmentQuery, setAssignmentQuery] = useState('')
  const resetKey = `${open}-${initial?.id ?? 'new'}`
  useEffect(() => { setTitle(initial?.title ?? ''); setDescription(initial?.description ?? ''); setPriority(initial?.priority ?? 3); setDesiredDate(initial?.desiredDate ?? ''); setLatestDate(initial?.latestDate ?? state.settings.endDate); setConditions(initial?.completionConditions ?? []); setAssignmentIds(initial?.linkedAssignmentIds ?? []); setAssignmentQuery('') }, [resetKey, initial, state.settings.endDate])
  const availableGroups = state.taskGroups.filter(group => !group.hiddenStandalone && group.status !== 'archived')
  const groupById = new Map(state.taskGroups.map(group => [group.id, group]))
  const directAssignmentOptions = state.assignments
    .filter(item => groupById.get(item.groupId)?.status !== 'archived')
    .filter(item => !assignmentQuery.trim() || `${item.title} ${groupById.get(item.groupId)?.title ?? ''} ${groupById.get(item.groupId)?.subject ?? ''}`.toLowerCase().includes(assignmentQuery.trim().toLowerCase()))
    .slice(0, 200)
  const addCondition = () => { const groupId = availableGroups.find(group => !conditions.some(item => item.groupId === group.id))?.id; if (groupId) setConditions(current => [...current, { id: uid('condition'), groupId, mode: 'all' }]) }
  const patchCondition = (id: string, patch: Partial<GoalCondition>) => setConditions(current => current.map(item => item.id === id ? { ...item, ...patch } : item))
  const submit = () => { if (!title.trim() || !latestDate || (desiredDate && desiredDate > latestDate)) return; onSave({ title: title.trim(), description: description.trim() || undefined, priority, desiredDate: desiredDate || undefined, latestDate, completionConditions: conditions, linkedTaskGroupIds: Array.from(new Set(conditions.map(item => item.groupId))), linkedAssignmentIds: assignmentIds }, initial?.id) }
  return <Modal open={open} title={initial ? '编辑目标' : '创建目标'} onClose={onClose} wide mobileFullscreen>
    <div className="form-grid"><label className="field span-2"><span>目标名称</span><input value={title} onChange={event => setTitle(event.target.value)}/></label><label className="field span-2"><span>说明</span><textarea rows={2} value={description} onChange={event => setDescription(event.target.value)}/></label><label className="field"><span>目标优先级</span><select value={priority} onChange={event => setPriority(Number(event.target.value) as Priority)}><option value={5}>核心</option><option value={3}>高</option><option value={2}>中</option><option value={1}>低</option><option value={0}>可选</option></select><small>期限更近始终先判断；期限相同时再参考目标优先级。</small></label><label className="field"><span>期望完成日期（软约束）</span><input type="date" value={desiredDate} onChange={event => setDesiredDate(event.target.value)}/></label><label className="field"><span>最晚完成日期（硬目标）</span><input type="date" value={latestDate} onChange={event => setLatestDate(event.target.value)}/></label>{desiredDate && desiredDate > latestDate && <div className="form-error span-2">期望完成日期不能晚于最晚完成日期。</div>}
      <fieldset className="field span-2 condition-editor"><legend>任务组完成条件</legend>{conditions.map(condition => <div className="condition-row" key={condition.id}><select value={condition.groupId} onChange={event => patchCondition(condition.id, { groupId: event.target.value })}>{availableGroups.map(group => <option key={group.id} value={group.id}>{group.subject} · {group.title}</option>)}</select><select value={condition.mode} onChange={event => patchCondition(condition.id, { mode: event.target.value as GoalConditionMode, value: event.target.value === 'all' ? undefined : condition.value ?? (event.target.value === 'percentage' ? 50 : 1) })}><option value="all">全部任务</option><option value="percentage">完成百分比</option><option value="count">完成数量</option></select>{condition.mode !== 'all' && <NumericInput min={1} max={condition.mode === 'percentage' ? 100 : 999} value={condition.value ?? 1} onValueChange={value => patchCondition(condition.id, { value })}/>}<button className="icon-button danger" onClick={() => setConditions(current => current.filter(item => item.id !== condition.id))}><Trash2 size={16}/></button></div>)}<button className="secondary-button" disabled={!availableGroups.some(group => !conditions.some(item => item.groupId === group.id))} onClick={addCondition}><Plus size={16}/>添加条件</button></fieldset>
      <details className="form-advanced span-2" open={assignmentIds.length > 0}><summary>直接关联特殊单项任务（可选）{assignmentIds.length ? ` · 已选 ${assignmentIds.length} 项` : ''}</summary><div className="form-advanced-body"><fieldset className="field exceptional-links"><legend>特殊单项任务</legend><input className="assignment-link-search" value={assignmentQuery} onChange={event => setAssignmentQuery(event.target.value)} placeholder="搜索任务、任务组或科目"/><small>只有少数不适合用任务组条件表达的任务才需要直接关联；重复关联会自动去重。</small><div>{directAssignmentOptions.map(item => { const group = groupById.get(item.groupId); return <label key={item.id}><input type="checkbox" checked={assignmentIds.includes(item.id)} onChange={event => setAssignmentIds(current => event.target.checked ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))}/><span>{item.title}<small>{group ? `${group.subject} · ${group.title}` : '任务组已删除'}</small></span></label> })}</div></fieldset></div></details>
      <div className="form-note span-2">一个任务组可服务多个目标；暂时没有任务时也可以先保存目标草稿，之后在录入或编辑目标时关联任务。</div>
    </div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!title.trim() || !latestDate || Boolean(desiredDate && desiredDate > latestDate)} onClick={submit}>{!initial && conditions.length === 0 && assignmentIds.length === 0 ? '保存目标草稿' : '保存并预览影响'}</button></div>
  </Modal>
}
