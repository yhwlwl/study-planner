import { Check, Clock3, Ellipsis, Lock, Play, Unlock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Assignment, TaskGroup } from '../types'
import { minutesText } from '../lib/date'
import { useApp } from '../AppContext'

export function nativeTaskDragAvailable(matchMedia: ((query: string) => MediaQueryList) | undefined = typeof window === 'undefined' ? undefined : window.matchMedia?.bind(window)) {
  if (!matchMedia) return false
  return matchMedia('(hover: hover) and (pointer: fine)').matches
}

export function TaskCard({ assignment, group, onComplete, onOpenTimer, compact = false, tutorialTarget = false, tutorialLocked = false, tutorialDisabled = false, onTutorialBlocked }: { assignment: Assignment; group: TaskGroup; onComplete: (assignment: Assignment) => void; onOpenTimer: (assignment: Assignment) => void; compact?: boolean; tutorialTarget?: boolean; tutorialLocked?: boolean; tutorialDisabled?: boolean; onTutorialBlocked?: (message?: string) => void }) {
  const { state, updateAssignment, startTimer } = useApp()
  const [tick, setTick] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const timer = state.timer
  const active = timer.assignmentId === assignment.id
  const anotherTimerActive = Boolean(timer.assignmentId && !active)
  // HTML5 draggable 会在部分 Android Chromium / Edge（尤其桌面图标/PWA 模式）里抢占手指纵向滑动。
  // 只有明确支持鼠标悬停且主指针为 fine 的桌面环境才启用原生拖拽；触屏仍保留点击/计时等全部操作。
  const nativeDragEnabled = nativeTaskDragAvailable()

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
    if (tutorialDisabled) { onTutorialBlocked?.('教程中先完成高亮任务'); return }
    if (assignment.status === 'done') return
    // 正在计时的任务必须回到统一的计时结束流程，避免首页勾选后丢失尚未结算的秒数。
    if (active) { onOpenTimer(assignment); return }
    onComplete(assignment)
  }

  const reopen = () => {
    setMenuOpen(false)
    const confirmed = window.confirm(`重新打开“${assignment.title}”？\n\n任务将恢复为待完成，进度重置为 0%；已经记录的学习时间会保留。`)
    if (!confirmed) return
    updateAssignment(assignment.id, { status: 'todo', progress: 0, completedAt: undefined, remainingMinutes: undefined })
  }

  return (
    <article
      data-assignment-id={assignment.id}
      className={`task-card ${assignment.status === 'done' ? 'task-done' : ''} ${compact ? 'task-compact' : ''}`}
      draggable={nativeDragEnabled && !tutorialLocked && !assignment.locked && assignment.status !== 'done'}
      onDragStart={event => {
        if (!nativeDragEnabled) { event.preventDefault(); return }
        event.dataTransfer.setData('text/assignment-id', assignment.id)
      }}
    >
      <button className={`check-button ${tutorialDisabled ? 'tutorial-disabled-control' : ''}`} data-tutorial-target={tutorialTarget ? 'tutorial-execute' : undefined} data-tutorial-action={tutorialTarget ? 'complete-tutorial-task' : undefined} onClick={complete} disabled={assignment.status === 'done'} aria-disabled={tutorialDisabled || undefined} aria-label={assignment.status === 'done' ? '任务已完成' : '完成任务'} title={assignment.status === 'done' ? '任务已完成；重新打开请使用更多菜单' : tutorialDisabled ? '教程中先完成高亮任务' : '完成任务'}>
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
          ? <button className={`text-button timer-start-button ${tutorialLocked ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialLocked || undefined} onClick={() => tutorialLocked ? onTutorialBlocked?.('教程中暂不操作计时器') : onOpenTimer(assignment)}><Clock3 size={15}/>返回计时</button>
          : anotherTimerActive
            ? <button className={`text-button timer-start-button ${tutorialLocked ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialLocked || undefined} onClick={() => tutorialLocked ? onTutorialBlocked?.('教程中暂不操作计时器') : onOpenTimer(assignment)} title="请先结束当前任务的计时"><Clock3 size={15}/>查看当前计时</button>
            : <button className={`text-button timer-start-button ${tutorialLocked ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialLocked || undefined} onClick={() => { if (tutorialLocked) { onTutorialBlocked?.('教程中暂不操作计时器'); return }; startTimer(assignment.id); onOpenTimer(assignment) }}><Play size={15}/>开始计时</button>)}
        <button className={`icon-button subtle task-lock-action ${tutorialLocked ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialLocked || undefined} aria-label={assignment.locked ? '解锁任务' : '锁定任务'} onClick={() => tutorialLocked ? onTutorialBlocked?.('教程中暂不修改任务锁定状态') : updateAssignment(assignment.id, { locked: !assignment.locked })}>{assignment.locked ? <Lock size={16}/> : <Unlock size={16}/>}<span className="mobile-action-label">{assignment.locked ? '解锁' : '锁定'}</span></button>
        {assignment.status === 'done' && <div className="task-more" ref={menuRef}>
          <button className={`icon-button subtle ${tutorialLocked ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialLocked || undefined} onClick={() => tutorialLocked ? onTutorialBlocked?.('教程中暂不重新打开已完成任务') : setMenuOpen(value => !value)} aria-label="更多任务操作" title="更多"><Ellipsis size={18} aria-hidden="true"/></button>
          {menuOpen && <div className="task-more-menu"><button onClick={reopen}>重新打开任务</button><small>会先再次确认，已记录时间不会删除。</small></div>}
        </div>}
      </div>}
    </article>
  )
}
