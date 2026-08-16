import { RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { TutorialStep } from '../lib/tutorial'

export interface TutorialCoachmarkConfig {
  target?: string
  text: string
  eyebrow?: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}

type Position = { left: number; top: number; placement: 'above' | 'below' | 'fallback' }

function findTarget(target?: string) {
  if (!target || typeof document === 'undefined') return null
  for (const candidate of target.split('|').map(item => item.trim()).filter(Boolean)) {
    const node = document.querySelector<HTMLElement>(`[data-tutorial-target="${candidate}"]`)
    if (node) return node
  }
  return null
}

export function TutorialCoachmark({ step, config, onExit, onRestart }: {
  step: TutorialStep
  config: TutorialCoachmarkConfig
  onExit: () => void
  onRestart: () => void
}) {
  const [position, setPosition] = useState<Position>({ left: 16, top: 16, placement: 'fallback' })
  const key = `${step}:${config.target ?? 'none'}`

  const updatePosition = useMemo(() => () => {
    const target = findTarget(config.target)
    document.querySelectorAll('.tutorial-highlight').forEach(node => node.classList.remove('tutorial-highlight'))
    if (!target) {
      setPosition({ left: Math.max(12, Math.min(window.innerWidth - 332, window.innerWidth / 2 - 160)), top: Math.max(12, window.innerHeight - 150), placement: 'fallback' })
      return
    }
    target.classList.add('tutorial-highlight')
    const rect = target.getBoundingClientRect()
    if (rect.bottom < 72 || rect.top > window.innerHeight - 72) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const cardWidth = Math.min(320, window.innerWidth - 24)
    const left = Math.max(12, Math.min(window.innerWidth - cardWidth - 12, rect.left + rect.width / 2 - cardWidth / 2))
    const above = rect.top >= 120
    const top = above ? Math.max(12, rect.top - 102) : Math.min(window.innerHeight - 116, rect.bottom + 14)
    setPosition({ left, top, placement: above ? 'above' : 'below' })
  }, [config.target])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updatePosition)
    const delayed = window.setTimeout(updatePosition, 260)
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(delayed) }
  }, [key, updatePosition])

  useEffect(() => {
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    const observer = new MutationObserver(() => window.requestAnimationFrame(updatePosition))
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      observer.disconnect()
      document.querySelectorAll('.tutorial-highlight').forEach(node => node.classList.remove('tutorial-highlight'))
    }
  }, [updatePosition])

  return <aside
    className={`tutorial-coachmark tutorial-coachmark-${position.placement}`}
    style={{ left: position.left, top: position.top }}
    role="region"
    aria-label="互动体验引导"
    aria-live="polite"
    data-tutorial-control
  >
    <div className="tutorial-coachmark-head">
      <span>{config.eyebrow ?? '互动体验'}</span>
      <div>
        <button type="button" className="tutorial-icon-button" aria-label="重新开始教程" title="重新开始" onClick={onRestart} data-tutorial-control><RotateCcw size={14}/></button>
        <button type="button" className="tutorial-icon-button" aria-label="退出教程" title="退出教程" onClick={onExit} data-tutorial-control><X size={15}/></button>
      </div>
    </div>
    <p>{config.text}</p>
    {(config.actionLabel || config.secondaryLabel) && <div className="tutorial-coachmark-actions">
      {config.secondaryLabel && <button type="button" className="text-button" onClick={config.onSecondary} data-tutorial-control>{config.secondaryLabel}</button>}
      {config.actionLabel && <button type="button" className="primary-button" onClick={config.onAction} data-tutorial-control>{config.actionLabel}</button>}
    </div>}
  </aside>
}
