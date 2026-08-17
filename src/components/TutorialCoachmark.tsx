import { LogOut, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { TutorialStep } from '../lib/tutorial'

export interface TutorialCoachmarkConfig {
  target?: string
  text: string
  eyebrow?: string
  headline?: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}

function findTarget(target?: string) {
  if (!target || typeof document === 'undefined') return null
  for (const candidate of target.split('|').map(item => item.trim()).filter(Boolean)) {
    const node = document.querySelector<HTMLElement>(`[data-tutorial-target="${candidate}"]`)
    if (node) return node
  }
  return null
}

type FloatingPosition = 'top-right' | 'bottom-right' | 'bottom-left' | 'top-left' | 'middle-right' | 'middle-left'
const floatingPositions: FloatingPosition[] = ['top-right', 'bottom-right', 'bottom-left', 'top-left', 'middle-right', 'middle-left']

function overlapArea(a: DOMRect, b: DOMRect) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return width * height
}

function candidateRect(position: FloatingPosition, width: number, height: number) {
  const compact = window.innerWidth <= 640
  const side = compact ? 10 : 18
  const top = compact ? 82 : 80
  const bottom = compact ? 14 : 18
  const x = position.endsWith('right') ? Math.max(side, window.innerWidth - side - width) : side
  const y = position.startsWith('top') ? top
    : position.startsWith('bottom') ? Math.max(top, window.innerHeight - bottom - height)
      : Math.max(top, (window.innerHeight - height) / 2)
  return new DOMRect(x, y, width, height)
}

function safeFloatingPositions(target: HTMLElement, coach: HTMLElement) {
  const scope = target.closest<HTMLElement>('.modal-card') ?? document.body
  const targetRect = target.getBoundingClientRect()
  const width = Math.min(coach.offsetWidth || 300, Math.max(220, window.innerWidth - 20))
  const height = Math.min(coach.offsetHeight || 170, Math.max(120, window.innerHeight - 28))
  const controls = Array.from(scope.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [role="button"]')).filter(node => {
    if (node.closest('[data-tutorial-control]')) return false
    if (node.matches(':disabled, [aria-disabled="true"], .tutorial-disabled-control')) return false
    if (node.closest('.tutorial-disabled-control, [aria-disabled="true"]')) return false
    const rect = node.getBoundingClientRect()
    return rect.width > 2 && rect.height > 2
  })

  const ranked = floatingPositions.map(position => {
    const rect = candidateRect(position, width, height)
    const targetOverlap = overlapArea(rect, targetRect)
    const controlOverlap = controls.reduce((sum, node) => sum + overlapArea(rect, node.getBoundingClientRect()), 0)
    return { position, targetOverlap, controlOverlap, score: targetOverlap * 1000 + controlOverlap }
  }).sort((a, b) => a.score - b.score)

  const completelySafe = ranked.filter(item => item.targetOverlap === 0 && item.controlOverlap === 0)
  if (completelySafe.length) return completelySafe.map(item => item.position)
  const targetSafe = ranked.filter(item => item.targetOverlap === 0)
  if (targetSafe.length) return targetSafe.slice(0, 2).map(item => item.position)
  return [ranked[0].position]
}

function emphasizedText(text: string) {
  const parts = text.split(/(“[^”]+”|「[^」]+」|《[^》]+》)/g)
  return parts.map((part, index) => /^(“[^”]+”|「[^」]+」|《[^》]+》)$/.test(part)
    ? <strong className="tutorial-inline-emphasis" key={`${part}-${index}`}>{part}</strong>
    : part)
}

export function TutorialCoachmark({ step, config, onExit, onRestart }: {
  step: TutorialStep
  config: TutorialCoachmarkConfig
  onExit: () => void
  onRestart: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [floating, setFloating] = useState(false)
  const [safePositions, setSafePositions] = useState<FloatingPosition[]>(floatingPositions)
  const [position, setPosition] = useState<FloatingPosition>('top-right')
  const coachRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setCollapsed(false)
    setFloating(false)
    setSafePositions(floatingPositions)
    setPosition('top-right')
  }, [step])

  useEffect(() => {
    let stopped = false
    const timers: number[] = []
    const clearHighlight = () => document.querySelectorAll('.tutorial-highlight').forEach(node => node.classList.remove('tutorial-highlight'))
    if (collapsed) {
      clearHighlight()
      return () => clearHighlight()
    }
    const reveal = (scroll = false) => {
      if (stopped) return false
      clearHighlight()
      const target = findTarget(config.target)
      if (!target) return false
      target.classList.add('tutorial-highlight')
      setFloating(Boolean(target.closest('.modal-card')))
      if (scroll) {
        const rect = target.getBoundingClientRect()
        const comfortablyVisible = rect.top >= 112 && rect.bottom <= window.innerHeight - 48
        if (!comfortablyVisible) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return true
    }
    for (const delay of [0, 100, 280, 650]) {
      timers.push(window.setTimeout(() => {
        if (reveal(delay >= 100)) timers.splice(0).forEach(id => window.clearTimeout(id))
      }, delay))
    }
    return () => {
      stopped = true
      timers.forEach(id => window.clearTimeout(id))
      clearHighlight()
    }
  }, [step, config.target, collapsed])

  useEffect(() => {
    if (!floating || collapsed) return
    let frame = 0
    const refresh = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const target = findTarget(config.target)
        const coach = coachRef.current
        if (!target || !coach) return
        const next = safeFloatingPositions(target, coach)
        setSafePositions(current => current.join('|') === next.join('|') ? current : next)
        setPosition(current => next.includes(current) ? current : next[0])
      })
    }
    refresh()
    window.addEventListener('resize', refresh)
    window.addEventListener('scroll', refresh, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', refresh)
      window.removeEventListener('scroll', refresh, true)
    }
  }, [floating, collapsed, config.target, step])

  if (collapsed) return <div className="tutorial-coachmark-collapsed tutorial-coachmark-reopen" data-tutorial-control>
    <button type="button" className="primary-button" onClick={() => setCollapsed(false)}>重新打开提示</button>
    <button type="button" className="text-button" onClick={onExit}>退出教程</button>
  </div>

  const moveToNextSafePosition = () => setPosition(current => {
    const index = Math.max(0, safePositions.indexOf(current))
    return safePositions[(index + 1) % safePositions.length] ?? current
  })

  return <aside ref={coachRef} className={`tutorial-coachmark ${floating ? `tutorial-coachmark-floating tutorial-position-${position}` : ''}`} role="region" aria-label="互动体验引导" aria-live="polite" data-tutorial-control>
    <div className="tutorial-coachmark-head">
      <span>{config.eyebrow ?? '互动体验'}</span>
      <div>
        {floating && safePositions.length > 1 && <button type="button" className="tutorial-position-button" aria-label="移动到其他安全位置" title="只在不遮挡当前操作的位置之间切换" onClick={moveToNextSafePosition} data-tutorial-control>换空位</button>}
        <button type="button" className="tutorial-icon-button" aria-label="重新开始教程" title="重新开始" onClick={onRestart} data-tutorial-control><RotateCcw size={14}/></button>
        <button type="button" className="tutorial-icon-button" aria-label="收起当前提示" title="收起提示，可稍后重新打开" onClick={() => setCollapsed(true)} data-tutorial-control><X size={15}/></button>
      </div>
    </div>
    <div className="tutorial-coachmark-copy">
      {config.headline && <strong className="tutorial-coachmark-title">{config.headline}</strong>}
      <p>{emphasizedText(config.text)}</p>
    </div>
    <div className="tutorial-coachmark-footer">
      <button type="button" className="tutorial-exit-button" onClick={onExit} data-tutorial-control><LogOut size={13}/>退出教程</button>
      {(config.actionLabel || config.secondaryLabel) && <div className="tutorial-coachmark-actions">
        {config.secondaryLabel && <button type="button" className="text-button" onClick={config.onSecondary} data-tutorial-control>{config.secondaryLabel}</button>}
        {config.actionLabel && <button type="button" className="primary-button" onClick={config.onAction} data-tutorial-control>{config.actionLabel}</button>}
      </div>}
    </div>
  </aside>
}
