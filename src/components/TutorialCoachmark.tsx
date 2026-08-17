import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, RotateCcw, X } from 'lucide-react'
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
  if (!target) return undefined
  for (const name of target.split('|').map(item => item.trim()).filter(Boolean)) {
    const matches = Array.from(document.querySelectorAll<HTMLElement>(`[data-tutorial-target="${name}"]`))
    const visible = matches.find(element => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    if (visible) return visible
  }
  return undefined
}

function renderEmphasized(text: string): ReactNode[] {
  return text.split(/([“”「」][^“”「」]+[“”「」])/g).filter(Boolean).map((part, index) => {
    if (/^[“「].+[”」]$/.test(part)) return <strong className="tutorial-inline-emphasis" key={`${part}-${index}`}>{part}</strong>
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

function visibleViewport() {
  const viewport = window.visualViewport
  return {
    top: viewport?.offsetTop ?? 0,
    height: viewport?.height ?? window.innerHeight,
  }
}

export function TutorialCoachmark({ step, config, onRestart, onExit }: {
  step: TutorialStep
  config?: TutorialCoachmarkConfig
  onRestart: () => void
  onExit: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)

  useEffect(() => { setCollapsed(false) }, [step])

  useEffect(() => {
    let target: HTMLElement | undefined
    let cancelled = false
    const timers: number[] = []
    const locate = () => {
      if (cancelled) return
      const found = findTarget(config?.target)
      if (!found) return
      if (target && target !== found) target.classList.remove('tutorial-highlight')
      target = found
      if (!collapsed) found.classList.add('tutorial-highlight')

      const modalCard = found.closest<HTMLElement>('.modal-card')
      const modalSlot = modalCard?.querySelector<HTMLElement>('.tutorial-modal-coachmark-slot') ?? null
      setPortalHost(current => current === modalSlot ? current : modalSlot)

      if (collapsed) return
      const rect = found.getBoundingClientRect()
      const viewport = visibleViewport()
      const safeTop = viewport.top + 72
      const safeBottom = viewport.top + viewport.height - 24
      if (rect.top < safeTop || rect.bottom > safeBottom) {
        found.scrollIntoView({ behavior: 'smooth', block: modalCard ? 'nearest' : 'center', inline: 'nearest' })
      }
    }
    locate()
    for (const delay of [80, 220, 520, 900]) timers.push(window.setTimeout(locate, delay))
    return () => {
      cancelled = true
      timers.forEach(window.clearTimeout)
      target?.classList.remove('tutorial-highlight')
    }
  }, [step, config?.target, collapsed])

  if (!config) return null

  const content = collapsed ? (
    <div className="tutorial-coachmark-collapsed">
      <button className="primary-button" onClick={() => setCollapsed(false)}>重新打开提示</button>
      <button className="text-button" onClick={onExit}>退出教程</button>
    </div>
  ) : (
    <div className="tutorial-coachmark" role="status" aria-live="polite">
      <div className="tutorial-coachmark-head">
        <span>{config.eyebrow ?? '互动教程'}</span>
        <div>
          <button className="tutorial-icon-button" onClick={onRestart} title="从头开始" aria-label="从头开始"><RotateCcw size={14}/></button>
          <button className="tutorial-icon-button" onClick={() => setCollapsed(true)} title="收起提示" aria-label="收起提示"><X size={15}/></button>
        </div>
      </div>
      <div className="tutorial-coachmark-copy">
        {config.headline && <strong className="tutorial-coachmark-title">{config.headline}</strong>}
        <p>{renderEmphasized(config.text)}</p>
      </div>
      {(config.secondaryLabel || config.actionLabel) && <div className="tutorial-coachmark-actions">
        {config.secondaryLabel && <button className="secondary-button" onClick={config.onSecondary}>{config.secondaryLabel}</button>}
        {config.actionLabel && <button className="primary-button" onClick={config.onAction}>{config.actionLabel}</button>}
      </div>}
      <div className="tutorial-coachmark-footer">
        <button className="tutorial-exit-button" onClick={onExit}><LogOut size={13}/>退出教程</button>
      </div>
    </div>
  )

  return portalHost ? createPortal(content, portalHost) : content
}
