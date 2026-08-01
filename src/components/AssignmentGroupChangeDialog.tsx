import { useEffect, useMemo, useState } from 'react'
import type { AppState, Assignment, TaskGroup } from '../types'
import { Modal } from './Modal'
import { minutesText } from '../lib/date'

export function AssignmentGroupChangeDialog({ open, state, assignment, targetGroup, onClose, onSubmit }: {
  open: boolean
  state: AppState
  assignment?: Assignment
  targetGroup?: TaskGroup
  onClose: () => void
  onSubmit: (options: { adoptDefaultDuration: boolean; numberingChoice: 'preserve' | 'number-all' }) => void
}) {
  const canAdopt = Boolean(assignment && assignment.status === 'todo' && assignment.progress === 0 && assignment.actualMinutes === 0 && (assignment.timeEntries?.length ?? 0) === 0 && state.timer.assignmentId !== assignment.id)
  const targetItems = useMemo(() => targetGroup ? state.assignments.filter(item => item.groupId === targetGroup.id && item.id !== assignment?.id) : [], [state.assignments, targetGroup?.id, assignment?.id])
  const becomesMultiItem = targetItems.length === 1
  const [adoptDefaultDuration, setAdoptDefaultDuration] = useState(false)
  const [numberingChoice, setNumberingChoice] = useState<'preserve' | 'number-all'>('preserve')
  useEffect(() => {
    if (!open) return
    setAdoptDefaultDuration(false)
    setNumberingChoice('preserve')
  }, [open, assignment?.id, targetGroup?.id])

  return <Modal open={open} title="更换任务组 · 先预览影响" onClose={onClose} wide mobileFullscreen>
    {assignment && targetGroup && <div className="group-change-dialog">
      <section className="group-change-summary">
        <span>任务</span><strong>{assignment.title}</strong>
        <div className="before-after"><span><small>当前任务组</small>{state.taskGroups.find(item => item.id === assignment.groupId)?.title ?? assignment.groupId}</span><span><small>目标任务组</small>{targetGroup.title}</span></div>
      </section>
      <section className="inheritance-preview">
        <strong>应用后继承的新组规则</strong>
        <span>科目：{targetGroup.subject}</span><span>优先级：{targetGroup.priority}</span>
        <span>每日上限：{targetGroup.dailyMax ?? '按活动类型'}</span><span>{targetGroup.highIntensity ? '高强度任务' : '普通强度'}</span>
        <small>任务的进度、实际用时、计时记录、完成状态、备注、锁定和手动排期意图都会保留；新组关联目标会立即参与校验。</small>
      </section>
      <fieldset className="field group-change-options"><legend>预计时长</legend>
        <label><input type="radio" name="group-duration" checked={!adoptDefaultDuration} onChange={() => setAdoptDefaultDuration(false)}/><span><strong>保留当前预计 {minutesText(assignment.estimatedMinutes)}</strong><small>会标记为任务自己的预计，之后任务组默认时长变化不会覆盖。</small></span></label>
        <label className={!canAdopt ? 'disabled' : ''}><input type="radio" name="group-duration" disabled={!canAdopt} checked={adoptDefaultDuration} onChange={() => setAdoptDefaultDuration(true)}/><span><strong>采用新组默认 {minutesText(targetGroup.unitMinutes)}</strong><small>{canAdopt ? '仅修改尚未开始且没有真实记录的任务。' : '此任务已经开始、已有真实记录或正在计时，因此不能重写预计。'}</small></span></label>
      </fieldset>
      {becomesMultiItem && <fieldset className="field numbering-choice"><legend>目标任务组将首次变成多项任务</legend>
        <label><input type="radio" name="group-numbering" checked={numberingChoice === 'preserve'} onChange={() => setNumberingChoice('preserve')}/><span><strong>保留原任务名称</strong><small>原任务名称作为自定义标题保护；转入任务按新的序号显示。</small></span></label>
        <label><input type="radio" name="group-numbering" checked={numberingChoice === 'number-all'} onChange={() => setNumberingChoice('number-all')}/><span><strong>统一按当前顺序编号</strong><small>只修改非自定义标题，完整变化会在下一步逐项展示。</small></span></label>
      </fieldset>}
      <div className="form-note">继续后先生成调整方案：重新校验当前日期、容量、每日上限、强度、长任务、日期保护和目标期限。没有合法结果时不会强行应用。</div>
    </div>}
    <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!assignment || !targetGroup} onClick={() => onSubmit({ adoptDefaultDuration: canAdopt && adoptDefaultDuration, numberingChoice })}>继续并预览影响</button></div>
  </Modal>
}
