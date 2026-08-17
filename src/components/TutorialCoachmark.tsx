import { LogOut, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  const [collapsed, setCollapsed] = useState(false)
  const [floating, setFloating] = useState(false)

  useEffect(() => { setCollapsed(false); setFloating(false) }, [step])

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

  if (collapsed) return <div className="tutorial-coachmark-collapsed" data-tutorial-control>
    <button type="button" className="secondary-button" onClick={() => setCollapsed(false)}>查看当前提示</button>
    <button type="button" className="text-button" onClick={onExit}>退出教程</button>
  </div>

  return <aside className={`tutorial-coachmark ${floating ? 'tutorial-coachmark-floating' : ''}`} role="region" aria-label="互动体验引导" aria-live="polite" data-tutorial-control>
    <div className="tutorial-coachmark-head">
      <span>{config.eyebrow ?? '互动体验'}</span>
      <div>
        <button type="button" className="tutorial-icon-button" aria-label="重新开始教程" title="重新开始" onClick={onRestart} data-tutorial-control><RotateCcw size={14}/></button>
        <button type="button" className="tutorial-icon-button" aria-label="收起当前提示" title="收起提示" onClick={() => setCollapsed(true)} data-tutorial-control><X size={15}/></button>
      </div>
    </div>
    <p>{config.text}</p>
    <div className="tutorial-coachmark-footer">
      <button type="button" className="tutorial-exit-button" onClick={onExit} data-tutorial-control><LogOut size={13}/>退出教程</button>
      {(config.actionLabel || config.secondaryLabel) && <div className="tutorial-coachmark-actions">
        {config.secondaryLabel && <button type="button" className="text-button" onClick={config.onSecondary} data-tutorial-control>{config.secondaryLabel}</button>}
        {config.actionLabel && <button type="button" className="primary-button" onClick={config.onAction} data-tutorial-control>{config.actionLabel}</button>}
      </div>}
    </div>
  </aside>
}
