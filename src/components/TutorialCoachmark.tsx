import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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

type FloatingMode = 'above' | 'below' | 'top-dock' | 'bottom-dock'
type FloatingLayout = { mode: FloatingMode; style: CSSProperties }

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
    left: viewport?.offsetLeft ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function TutorialCoachmark({ step, config, onRestart, onExit }: {
  step: TutorialStep
  config?: TutorialCoachmarkConfig
  onRestart: () => void
  onExit: () => void
}) {
  const coachRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLElement>()
  const [collapsed, setCollapsed] = useState(false)
  const [floating, setFloating] = useState(false)
  const [layout, setLayout] = useState<FloatingLayout>()

  useEffect(() => { setCollapsed(false) }, [step])

  useEffect(() => {
    let target: HTMLElement | undefined
    let cancelled = false
    const timers: number[] = []
    const locate = () => {
      if (cancelled || collapsed) return
      const found = findTarget(config?.target)
      if (!found) return
      if (target && target !== found) target.classList.remove('tutorial-highlight')
      target = found
      targetRef.current = found
      found.classList.add('tutorial-highlight')
      const inModal = Boolean(found.closest('.modal-card'))
      setFloating(inModal)
      const rect = found.getBoundingClientRect()
      const viewport = visibleViewport()
      const safeTop = viewport.top + 76
      const safeBottom = viewport.top + viewport.height - 28
      if (rect.top < safeTop || rect.bottom > safeBottom) {
        found.scrollIntoView({ behavior: 'smooth', block: inModal ? 'nearest' : 'center', inline: 'nearest' })
      }
    }
    locate()
    for (const delay of [80, 220, 520, 900]) timers.push(window.setTimeout(locate, delay))
    return () => {
      cancelled = true
      timers.forEach(window.clearTimeout)
      target?.classList.remove('tutorial-highlight')
      if (targetRef.current === target) targetRef.current = undefined
    }
  }, [step, config?.target, collapsed])

  useEffect(() => {
    if (!floating || collapsed || !config) { setLayout(undefined); return }
    let frame = 0
    const update = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const target = targetRef.current
        const coach = coachRef.current
        if (!target || !coach) return
        const targetRect = target.getBoundingClientRect()
        const viewport = visibleViewport()
        const viewportBottom = viewport.top + viewport.height
        const viewportRight = viewport.left + viewport.width
        const isMobile = viewport.width <= 640
        const measuredHeight = Math.max(90, coach.offsetHeight)

        if (isMobile) {
          const width = Math.max(260, viewport.width - 20)
          const targetMiddle = targetRect.top + targetRect.height / 2
          const dockBottom = targetMiddle < viewport.top + viewport.height / 2
          const top = dockBottom
            ? Math.max(viewport.top + 10, viewportBottom - measuredHeight - 10)
            : viewport.top + 10
          setLayout({
            mode: dockBottom ? 'bottom-dock' : 'top-dock',
            style: { top, left: viewport.left + 10, width },
          })
          return
        }

        const width = Math.min(320, Math.max(260, viewport.width - 32))
        const gap = 12
        const roomBelow = viewportBottom - targetRect.bottom
        const roomAbove = targetRect.top - viewport.top
        const below = roomBelow >= measuredHeight + gap || roomBelow >= roomAbove
        const top = below
          ? Math.min(viewportBottom - measuredHeight - 12, targetRect.bottom + gap)
          : Math.max(viewport.top + 12, targetRect.top - measuredHeight - gap)
        const left = clamp(targetRect.left + targetRect.width / 2 - width / 2, viewport.left + 16, viewportRight - width - 16)
        setLayout({ mode: below ? 'below' : 'above', style: { top, left, width } })
      })
    }
    update()
    const delayed = window.setTimeout(update, 80)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(delayed)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [floating, collapsed, step, config])

  if (!config) return null
  if (collapsed) {
    return <div className={`tutorial-coachmark-collapsed ${floating ? 'tutorial-coachmark-reopen' : ''}`}>
      <button className="primary-button" onClick={() => setCollapsed(false)}>重新打开提示</button>
      <button className="text-button" onClick={onExit}>退出教程</button>
    </div>
  }

  const floatingClass = floating && layout ? ` tutorial-coachmark-floating tutorial-placement-${layout.mode}` : ''
  return <div ref={coachRef} style={floating && layout ? layout.style : undefined} className={`tutorial-coachmark${floatingClass}`} role="status" aria-live="polite">
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
}
