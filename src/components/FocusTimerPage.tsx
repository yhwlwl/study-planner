import { Check, Clock3, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import { minutesText, timestampForDate, todayISO } from '../lib/date'
import { uid } from '../lib/id'
import { appendStatusEvent } from '../lib/execution'
import { getTimerElapsedSeconds } from '../lib/timer'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

function formatElapsed(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

export function FocusTimerPage({ onExit }: { onExit: () => void }) {
  const {
    state, commit, startTimer, pauseTimer, stopTimer, addTime, finishAssignment
  } = useApp()
  const [tick, setTick] = useState(0)
  const [finishOpen, setFinishOpen] = useState(false)
  const [sessionMinutes, setSessionMinutes] = useState('')
  const [progress, setProgress] = useState(50)
  const [wasRunningBeforeFinish, setWasRunningBeforeFinish] = useState(false)

  const timer = state.timer
  const assignment = state.assignments.find(item => item.id === timer.assignmentId)
  const group = assignment ? state.taskGroups.find(item => item.id === assignment.groupId) : undefined

  useEffect(() => {
    if (!timer.running) return
    const id = window.setInterval(() => setTick(value => value + 1), 250)
    return () => window.clearInterval(id)
  }, [timer.running])
  void tick

  const elapsedSeconds = getTimerElapsedSeconds(timer)
  const elapsedText = formatElapsed(elapsedSeconds)
  const expectedSeconds = Math.max(60, (assignment?.estimatedMinutes ?? 1) * 60)
  const progressRatio = Math.min(1, elapsedSeconds / expectedSeconds)
  const progressDegrees = Math.round(progressRatio * 360)
  const overtimeSeconds = Math.max(0, elapsedSeconds - expectedSeconds)

  useEffect(() => {
    if (!assignment) return
    const previous = document.title
    document.title = `${elapsedText} · ${assignment.title}`
    return () => { document.title = previous }
  }, [assignment, elapsedText])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (finishOpen || !assignment) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (timer.running) pauseTimer()
        else startTimer(assignment.id)
      }
      if (event.key === 'Escape') onExit()
      if (event.key === 'Enter') openFinish()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const openFinish = () => {
    if (!assignment) return
    const running = timer.running
    setWasRunningBeforeFinish(running)
    if (running) pauseTimer()
    const roundedMinutes = Math.max(1, Math.round(elapsedSeconds / 60))
    setSessionMinutes(String(roundedMinutes))
    setProgress(assignment.status === 'partial' ? Math.max(1, Math.min(99, assignment.progress)) : 50)
    setFinishOpen(true)
  }

  const closeFinish = () => {
    setFinishOpen(false)
    if (assignment && wasRunningBeforeFinish) startTimer(assignment.id)
  }

  const commitSession = (mode: 'time' | 'partial' | 'done') => {
    if (!assignment) return
    const minutes = Math.max(1, Math.round(Number(sessionMinutes) || 1))
    // Reset the running session first. The chosen minute value below is authoritative.
    stopTimer()
    if (mode === 'time') addTime(assignment.id, minutes, 'timer')
    if (mode === 'done') finishAssignment(assignment.id, minutes, 'timer')
    if (mode === 'partial') {
      commit(draft => {
        const item = draft.assignments.find(candidate => candidate.id === assignment.id)
        if (!item) return
        item.actualMinutes += minutes
        const date = todayISO()
        const changedAt = new Date().toISOString()
        item.timeEntries.push({ id: uid('time'), minutes, date, createdAt: changedAt, source: 'timer' })
        item.progress = Math.max(1, Math.min(99, progress))
        item.remainingMinutes = Math.max(1, Math.round(item.estimatedMinutes * (1 - item.progress / 100)))
        item.status = 'partial'
        item.completedAt = undefined
        appendStatusEvent(item, 'partial', item.progress, date, 'partial', changedAt)
        draft.timer = { accumulatedSeconds: 0, running: false }
      })
    }
    setFinishOpen(false)
    onExit()
  }

  const stateLabel = timer.running ? '专注中' : '已暂停'
  const remainingLabel = overtimeSeconds > 0
    ? `已超过预计 ${minutesText(Math.ceil(overtimeSeconds / 60))}`
    : `距预计时间还有 ${minutesText(Math.ceil((expectedSeconds - elapsedSeconds) / 60))}`

  if (!assignment || !group) {
    return (
      <main className="focus-timer-page focus-timer-empty">
        <div className="focus-empty-card">
          <Clock3 size={42}/>
          <h1>当前没有正在计时的任务</h1>
          <p>返回今日任务后，点击“开始计时”即可进入沉浸计时页。</p>
          <button className="primary-button" onClick={onExit}>返回今日任务</button>
        </div>
      </main>
    )
  }

  return (
    <main className={`focus-timer-page ${timer.running ? 'is-running' : 'is-paused'}`}>
      <button className="focus-exit-button" onClick={onExit} aria-label="退出专注页面"><X size={22}/><span>退出专注</span></button>

      <section className="focus-timer-stage">
        <div className="focus-task-heading">
          <span className={`subject-pill subject-${group.subject}`}>{group.subject}</span>
          <h1>{assignment.title}</h1>
          <p>{stateLabel} · 预计 {minutesText(assignment.estimatedMinutes)}</p>
        </div>

        <div className="focus-clock-wrap" style={{ '--timer-progress': `${progressDegrees}deg` } as any}>
          <div className="focus-clock-inner">
            <span className="focus-clock-status">{stateLabel}</span>
            <strong>{elapsedText}</strong>
            <small>{remainingLabel}</small>
          </div>
        </div>

        <div className="focus-primary-controls">
          <button
            className={`focus-control-button ${timer.running ? 'pause' : 'play'}`}
            onClick={() => timer.running ? pauseTimer() : startTimer(assignment.id)}
          >
            {timer.running ? <Pause size={28}/> : <Play size={28}/>}<span>{timer.running ? '暂停' : '继续'}</span>
          </button>
          <button className="focus-finish-button" onClick={openFinish}><Check size={22}/><span>结束计时</span></button>
        </div>

        <div className="focus-shortcuts"><span>空格：暂停/继续</span><span>Enter：结束计时</span><span>Esc：退出专注</span></div>
      </section>

      <Modal open={finishOpen} title="结束本次计时" onClose={closeFinish}>
        <div className="focus-finish-summary">
          <Clock3 size={22}/>
          <div><strong>{assignment.title}</strong><span>本次计时 {elapsedText}</span></div>
        </div>
        <div className="form-stack">
          <label className="field"><span>记入实际用时（分钟）</span><NumericInput min={1} max={1440} step={1} value={sessionMinutes === '' ? undefined : Number(sessionMinutes)} onValueChange={value => setSessionMinutes(String(value))} onEmpty={() => setSessionMinutes('')} autoFocus/></label>
          <label className="field"><span>保存为部分完成时的当前进度</span><NumericInput min={1} max={99} value={progress} onValueChange={setProgress}/></label>
        </div>
        <p className="focus-finish-tip">仅记入时间不会改变任务完成状态；选择部分完成或标记完成后，计时结果会同时写入任务记录。</p>
        <div className="modal-actions focus-finish-actions">
          <button className="secondary-button" onClick={() => commitSession('time')}>仅记入时间</button>
          <button className="secondary-button" onClick={() => commitSession('partial')}>保存为部分完成</button>
          <button className="primary-button" onClick={() => commitSession('done')}>标记完成</button>
        </div>
      </Modal>
    </main>
  )
}
