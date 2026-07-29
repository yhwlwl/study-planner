import { Check, ChevronLeft, ChevronRight, Clock3, Lock, Play, Unlock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Assignment, TaskGroup } from '../types'
import { minutesText, shiftDate } from '../lib/date'
import { useApp } from '../AppContext'

export function TaskCard({ assignment, group, onComplete, onOpenTimer, compact = false }: { assignment: Assignment; group: TaskGroup; onComplete: (assignment: Assignment) => void; onOpenTimer: (assignment: Assignment) => void; compact?: boolean }) {
  const { state, updateAssignment, startTimer } = useApp()
  const [tick, setTick] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const timer = state.timer
  const active = timer.assignmentId === assignment.id
  const anotherTimerActive = Boolean(timer.assignmentId && !active)

  useEffect(() => {
    if (!active || !timer.running) return
    const id = window.setInterval(() => setTick(value => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [active, timer.running])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  void tick
  const elapsed = active ? timer.accumulatedSeconds + (timer.running && timer.startedAt ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0) : 0

  const complete = () => {
    if (assignment.status !== 'done') onComplete(assignment)
  }

  const reopen = () => {
    setMenuOpen(false)
    const confirmed = window.confirm(`重新打开“${assignment.title}”？\n\n任务将恢复为待完成，进度重置为 0%；已经记录的学习时间会保留。`)
    if (!confirmed) return
    updateAssignment(assignment.id, { status: 'todo', progress: 0, completedAt: undefined, remainingMinutes: undefined })
  }

  const move = (delta: -1 | 1) => {
    if (!assignment.scheduledDate) return
    updateAssignment(assignment.id, { scheduledDate: shiftDate(assignment.scheduledDate, delta) })
  }

  return (
    <article className={`task-card ${assignment.status === 'done' ? 'task-done' : ''} ${compact ? 'task-compact' : ''}`} draggable={!assignment.locked && assignment.status !== 'done'} onDragStart={event => event.dataTransfer.setData('text/assignment-id', assignment.id)}>
      <button className="check-button" onClick={complete} disabled={assignment.status === 'done'} aria-label={assignment.status === 'done' ? '任务已完成' : '完成任务'} title={assignment.status === 'done' ? '任务已完成；重新打开请使用更多菜单' : '完成任务'}>
        {assignment.status === 'done' ? <Check size={18} /> : null}
      </button>
      <div className="task-main">
        <div className="task-title-row"><span className={`subject-pill subject-${group.subject}`}>{group.subject}</span><strong>{assignment.title}</strong>{assignment.intentStrength === 'manual' && !assignment.locked && <span className="task-intent-badge">手动优先</span>}{assignment.locked && <span className="task-lock-badge">已锁定</span>}</div>
        <div className="task-meta">
          <span>{group.flexibleDuration && assignment.actualMinutes === 0 ? `参考 ${minutesText(assignment.estimatedMinutes)}` : `预计 ${minutesText(assignment.estimatedMinutes)}`}</span>
          {assignment.actualMinutes > 0 && <span>实际 {minutesText(assignment.actualMinutes)}</span>}
          {assignment.status === 'partial' && <span>已完成 {assignment.progress}%</span>}
          {assignment.status === 'partial' && assignment.remainingMinutes !== undefined && <span>剩余参考 {minutesText(assignment.remainingMinutes)}</span>}
          {assignment.actualMinutes > 0 && assignment.status === 'done' && <span className={assignment.actualMinutes > assignment.estimatedMinutes ? 'diff-over' : 'diff-under'}>{assignment.actualMinutes - assignment.estimatedMinutes > 0 ? '+' : ''}{assignment.actualMinutes - assignment.estimatedMinutes} 分钟</span>}
        </div>
        {active && <div className="timer-strip"><Clock3 size={15}/><span>{String(Math.floor(elapsed / 3600)).padStart(2,'0')}:{String(Math.floor(elapsed % 3600 / 60)).padStart(2,'0')}:{String(elapsed % 60).padStart(2,'0')}</span></div>}
      </div>
      {!compact && <div className="task-actions">
        {assignment.status !== 'done' && (active
          ? <button className="text-button timer-start-button" onClick={() => onOpenTimer(assignment)}><Clock3 size={15}/>返回计时</button>
          : anotherTimerActive
            ? <button className="text-button timer-start-button" onClick={() => onOpenTimer(assignment)} title="请先结束当前任务的计时"><Clock3 size={15}/>查看当前计时</button>
            : <button className="text-button timer-start-button" onClick={() => { startTimer(assignment.id); onOpenTimer(assignment) }}><Play size={15}/>开始计时</button>)}
        <button className="icon-button subtle" onClick={() => move(-1)} disabled={!assignment.scheduledDate || assignment.locked || assignment.status === 'done'}><ChevronLeft size={17}/></button>
        <button className="icon-button subtle" onClick={() => move(1)} disabled={!assignment.scheduledDate || assignment.locked || assignment.status === 'done'}><ChevronRight size={17}/></button>
        <button className="icon-button subtle" onClick={() => updateAssignment(assignment.id, { locked: !assignment.locked })}>{assignment.locked ? <Lock size={16}/> : <Unlock size={16}/>}</button>
        {assignment.status === 'done' && <div className="task-more" ref={menuRef}>
          <button className="icon-button subtle" onClick={() => setMenuOpen(value => !value)} aria-label="更多任务操作" title="更多"><span className="more-dots" aria-hidden="true">···</span></button>
          {menuOpen && <div className="task-more-menu"><button onClick={reopen}>重新打开任务</button><small>会先再次确认，已记录时间不会删除。</small></div>}
        </div>}
      </div>}
    </article>
  )
}
