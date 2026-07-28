import { Check, ChevronLeft, ChevronRight, Clock3, Lock, Pause, Play, RotateCcw, Unlock } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Assignment, TaskGroup } from '../types'
import { minutesText, shiftDate } from '../lib/date'
import { useApp } from '../AppContext'

export function TaskCard({ assignment, group, onComplete, compact = false }: { assignment: Assignment; group: TaskGroup; onComplete: (assignment: Assignment) => void; compact?: boolean }) {
  const { state, updateAssignment, startTimer, pauseTimer, stopTimer, addTime } = useApp()
  const [tick, setTick] = useState(0)
  const timer = state.timer
  const active = timer.assignmentId === assignment.id
  useEffect(() => {
    if (!active || !timer.running) return
    const id = window.setInterval(() => setTick(x => x + 1), 1000)
    return () => window.clearInterval(id)
  }, [active, timer.running])
  void tick
  const elapsed = active ? timer.accumulatedSeconds + (timer.running && timer.startedAt ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0) : 0

  const toggle = () => {
    if (assignment.status === 'done') updateAssignment(assignment.id, { status: 'todo', progress: 0, completedAt: undefined })
    else onComplete(assignment)
  }

  const move = (delta: -1 | 1) => {
    if (!assignment.scheduledDate) return
    updateAssignment(assignment.id, { scheduledDate: shiftDate(assignment.scheduledDate, delta) })
  }

  const finishTimer = () => {
    const minutes = stopTimer()
    addTime(assignment.id, minutes)
  }

  return (
    <article className={`task-card ${assignment.status === 'done' ? 'task-done' : ''} ${compact ? 'task-compact' : ''}`} draggable={!assignment.locked} onDragStart={e => e.dataTransfer.setData('text/assignment-id', assignment.id)}>
      <button className="check-button" onClick={toggle} aria-label={assignment.status === 'done' ? '撤销完成' : '完成任务'}>
        {assignment.status === 'done' ? <Check size={18} /> : null}
      </button>
      <div className="task-main">
        <div className="task-title-row"><span className={`subject-pill subject-${group.subject}`}>{group.subject}</span><strong>{assignment.title}</strong></div>
        <div className="task-meta">
          <span>预计 {minutesText(assignment.estimatedMinutes)}</span>
          {assignment.actualMinutes > 0 && <span>实际 {minutesText(assignment.actualMinutes)}</span>}
          {assignment.status === 'partial' && <span>已完成 {assignment.progress}%</span>}
          {assignment.actualMinutes > 0 && assignment.status === 'done' && <span className={assignment.actualMinutes > assignment.estimatedMinutes ? 'diff-over' : 'diff-under'}>{assignment.actualMinutes - assignment.estimatedMinutes > 0 ? '+' : ''}{assignment.actualMinutes - assignment.estimatedMinutes} 分钟</span>}
        </div>
        {active && <div className="timer-strip"><Clock3 size={15}/><span>{String(Math.floor(elapsed / 3600)).padStart(2,'0')}:{String(Math.floor(elapsed % 3600 / 60)).padStart(2,'0')}:{String(elapsed % 60).padStart(2,'0')}</span></div>}
      </div>
      {!compact && <div className="task-actions">
        {assignment.status !== 'done' && (!active ? <button className="text-button" onClick={() => startTimer(assignment.id)}><Play size={15}/>计时</button> : timer.running ? <button className="text-button" onClick={pauseTimer}><Pause size={15}/>暂停</button> : <button className="text-button" onClick={() => startTimer(assignment.id)}><Play size={15}/>继续</button>)}
        {active && <button className="text-button" onClick={finishTimer}><Clock3 size={15}/>记入</button>}
        <button className="icon-button subtle" onClick={() => move(-1)} disabled={!assignment.scheduledDate || assignment.locked}><ChevronLeft size={17}/></button>
        <button className="icon-button subtle" onClick={() => move(1)} disabled={!assignment.scheduledDate || assignment.locked}><ChevronRight size={17}/></button>
        <button className="icon-button subtle" onClick={() => updateAssignment(assignment.id, { locked: !assignment.locked })}>{assignment.locked ? <Lock size={16}/> : <Unlock size={16}/>}</button>
        {assignment.status === 'done' && <button className="icon-button subtle" onClick={toggle}><RotateCcw size={16}/></button>}
      </div>}
    </article>
  )
}
