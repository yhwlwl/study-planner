import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Target } from 'lucide-react'
import type { AppState, GoalDraft } from '../types'
import { useApp } from '../AppContext'
import { Modal } from './Modal'

export function GoalDeadlineDialog({ open, state, onClose, onPrepared, onOpenGoals }: {
  open: boolean
  state: AppState
  onClose: () => void
  onPrepared: (prepared: AppState, event: import('../types').PlanChangeEvent) => void
  onOpenGoals?: () => void
}) {
  const { prepareGoalChange } = useApp()
  const goals = useMemo(() => state.goals.filter(goal => goal.status === 'active'), [state.goals])
  const [goalId, setGoalId] = useState('')
  const selected = goals.find(goal => goal.id === goalId) ?? goals[0]
  const [desiredDate, setDesiredDate] = useState('')
  const [latestDate, setLatestDate] = useState('')

  useEffect(() => {
    if (!open) return
    const next = goals[0]
    setGoalId(next?.id ?? '')
    setDesiredDate(next?.desiredDate ?? '')
    setLatestDate(next?.latestDate ?? state.settings.endDate)
  }, [open, goals, state.settings.endDate])

  useEffect(() => {
    if (!selected) return
    setDesiredDate(selected.desiredDate ?? '')
    setLatestDate(selected.latestDate)
  }, [selected?.id])

  const submit = () => {
    if (!selected || !latestDate || (desiredDate && desiredDate > latestDate)) return
    const draft: GoalDraft = {
      title: selected.title,
      description: selected.description,
      priority: selected.priority,
      desiredDate: desiredDate || undefined,
      latestDate,
      completionConditions: selected.completionConditions,
      linkedTaskGroupIds: selected.linkedTaskGroupIds,
      linkedAssignmentIds: selected.linkedAssignmentIds,
    }
    const prepared = prepareGoalChange(draft, selected.id)
    onClose()
    onPrepared(prepared.state, prepared.event)
  }

  return <Modal open={open} title="修改任务或目标期限" onClose={onClose} wide mobileFullscreen>
    <div className="direct-operation-dialog">
      <section className="direct-operation-intro"><div className="direct-operation-icon"><Target size={20} /></div><div><strong>直接修改目标期限</strong><p>任务的期限由关联目标管理。修改后，系统会立即预览关联任务受到的影响。</p></div></section>
      {goals.length ? <>
        <div className="direct-operation-form">
          <label className="field span-2"><span>选择目标</span><select value={selected?.id ?? ''} onChange={event => setGoalId(event.target.value)}>{goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title} · 最晚 {goal.latestDate}</option>)}</select></label>
          <label className="field"><span>期望完成日期（可选）</span><input type="date" min={state.settings.startDate} max={latestDate || state.settings.endDate} value={desiredDate} onChange={event => setDesiredDate(event.target.value)} /></label>
          <label className="field"><span>最晚完成日期</span><input type="date" min={desiredDate || state.settings.startDate} max={state.settings.endDate} value={latestDate} onChange={event => setLatestDate(event.target.value)} /></label>
        </div>
        <div className="direct-operation-note"><CalendarClock size={17} /><span>这次只修改目标期限；不会直接覆盖任务日期。下一步会显示哪些任务需要提前、推迟或重新安排。</span></div>
        <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!selected || !latestDate || Boolean(desiredDate && desiredDate > latestDate)} onClick={submit}>分析期限变化</button></div>
      </> : <div className="direct-operation-empty"><Target size={26} /><strong>还没有可修改的活动目标</strong><span>先创建一个目标，再从这里直接调整它的期望日期和最晚日期。</span>{onOpenGoals && <button className="primary-button" onClick={() => { onClose(); onOpenGoals() }}>打开目标</button>}</div>}
    </div>
  </Modal>
}
