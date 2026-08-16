import { RotateCcw, X } from 'lucide-react'
import { useEffect } from 'react'
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
  useEffect(() => {
    let stopped = false
    const timers: number[] = []
    const clearHighlight = () => document.querySelectorAll('.tutorial-highlight').forEach(node => node.classList.remove('tutorial-highlight'))
    const reveal = (scroll = false) => {
      if (stopped) return false
      clearHighlight()
      const target = findTarget(config.target)
      if (!target) return false
      target.classList.add('tutorial-highlight')
      if (scroll) {
        const rect = target.getBoundingClientRect()
        const comfortablyVisible = rect.top >= 96 && rect.bottom <= window.innerHeight - 48
        if (!comfortablyVisible) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return true
    }

    // 只在步骤切换时寻找目标，不再监听全页面 mutation/scroll 实时追着元素移动。
    // 页面或弹窗稍晚挂载时做有限次数重试，找到后即停止。
    const attempts = [0, 80, 220, 520]
    for (const delay of attempts) {
      timers.push(window.setTimeout(() => {
        if (reveal(delay >= 80)) timers.splice(0).forEach(id => window.clearTimeout(id))
      }, delay))
    }
    return () => {
      stopped = true
      timers.forEach(id => window.clearTimeout(id))
      clearHighlight()
    }
  }, [step, config.target])

  return <aside className="tutorial-coachmark" role="region" aria-label="互动体验引导" aria-live="polite" data-tutorial-control>
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
