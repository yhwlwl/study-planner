import { useEffect, useState } from 'react'
import { CalendarClock, ChevronLeft, FolderPlus, Inbox, ListTodo } from 'lucide-react'
import { Modal } from './Modal'

export type TaskCreationMode = 'intake' | 'schedule'
export type TaskCreationKind = 'single' | 'group'

export function AddTaskDialog({ open, onClose, onSelect }: {
  open: boolean
  onClose: () => void
  onSelect: (mode: TaskCreationMode, kind: TaskCreationKind) => void
}) {
  const [step, setStep] = useState<'mode' | 'kind'>('mode')
  const [mode, setMode] = useState<TaskCreationMode>()

  useEffect(() => {
    if (!open) return
    setStep('mode')
    setMode(undefined)
  }, [open])

  const chooseMode = (nextMode: TaskCreationMode) => {
    setMode(nextMode)
    setStep('kind')
  }

  return <Modal open={open} title={step === 'mode' ? '添加任务' : '选择任务类型'} onClose={onClose} mobileSheet className="add-task-dialog">
    {step === 'mode' ? <>
      <div className="add-task-dialog-intro">
        <strong>添加后要立即安排吗？</strong>
        <span>先选择任务的去向，再填写具体内容。</span>
      </div>
      <div className="add-task-mode-grid">
        <button type="button" className="add-task-mode-card" onClick={() => chooseMode('intake')}>
          <span className="add-task-mode-icon intake"><Inbox size={21}/></span>
          <strong>添加到录入，暂不安排</strong>
          <small>先保存任务，之后可以继续补充、批量整理和统一安排。</small>
        </button>
        <button type="button" className="add-task-mode-card primary" onClick={() => chooseMode('schedule')}>
          <span className="add-task-mode-icon schedule"><CalendarClock size={21}/></span>
          <strong>添加任务并安排</strong>
          <small>填写完成后立即生成安排预览，确认后加入正式计划。</small>
        </button>
      </div>
    </> : <>
      <button type="button" className="add-task-back" onClick={() => setStep('mode')}><ChevronLeft size={16}/>返回</button>
      <div className="add-task-selected-mode">
        <span>{mode === 'intake' ? '暂不安排' : '立即安排'}</span>
        <strong>{mode === 'intake' ? '任务会先保存在“录入”中' : '填写后会生成安排预览'}</strong>
      </div>
      <div className="add-task-dialog-intro">
        <strong>要添加哪一种任务？</strong>
        <span>独立任务是一项具体事项，任务组是一批同类事项。</span>
      </div>
      <div className="add-task-kind-grid">
        <button type="button" className="add-task-kind-card" onClick={() => mode && onSelect(mode, 'single')}>
          <span className="add-task-kind-icon"><ListTodo size={20}/></span>
          <strong>独立任务</strong>
          <small>例如“今晚看完第三章”。</small>
        </button>
        <button type="button" className="add-task-kind-card" onClick={() => mode && onSelect(mode, 'group')}>
          <span className="add-task-kind-icon"><FolderPlus size={20}/></span>
          <strong>任务组</strong>
          <small>例如“化学错题 10 组，每组 30 分钟”。</small>
        </button>
      </div>
    </>}
  </Modal>
}
