import { Children, cloneElement, isValidElement, useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { X } from 'lucide-react'

type ChildElement = ReactElement<{ children?: ReactNode; className?: string }>

function isModalActions(node: ReactNode): node is ChildElement {
  if (!isValidElement(node)) return false
  const className = typeof node.props.className === 'string' ? node.props.className : ''
  return className.split(/\s+/).includes('modal-actions')
}

function splitTrailingModalActions(node: ReactNode): { content: ReactNode; actions?: ReactNode } {
  const items = Children.toArray(node)
  if (!items.length) return { content: node }

  const last = items[items.length - 1]
  if (isModalActions(last)) return { content: items.slice(0, -1), actions: last }

  if (isValidElement(last)) {
    const element = last as ChildElement
    const nested = splitTrailingModalActions(element.props.children)
    if (nested.actions) {
      return {
        content: [...items.slice(0, -1), cloneElement(element, undefined, nested.content)],
        actions: nested.actions,
      }
    }
  }

  return { content: node }
}

export function Modal({ open, title, children, footer, onClose, wide = false, mobileSheet = false, mobileFullscreen = false, className = '' }: { open: boolean; title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; mobileSheet?: boolean; mobileFullscreen?: boolean; className?: string }) {
  const titleIdRef = useRef<string>()
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  if (!titleIdRef.current) titleIdRef.current = `modal-title-${Math.random().toString(36).slice(2, 10)}`
  const titleId = titleIdRef.current

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    const focusFirst = window.requestAnimationFrame(() => {
      const focusable = dialogRef.current?.querySelector<HTMLElement>(focusableSelector)
      ;(focusable ?? dialogRef.current)?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector))
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFirst)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previous
      previousFocusRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || !mobileFullscreen) return
    const viewport = window.visualViewport
    const syncVisibleHeight = () => {
      const visibleHeight = Math.max(320, Math.round(viewport?.height ?? window.innerHeight))
      dialogRef.current?.style.setProperty('--modal-visible-height', `${visibleHeight}px`)
    }
    syncVisibleHeight()
    viewport?.addEventListener('resize', syncVisibleHeight)
    viewport?.addEventListener('scroll', syncVisibleHeight)
    window.addEventListener('resize', syncVisibleHeight)
    return () => {
      viewport?.removeEventListener('resize', syncVisibleHeight)
      viewport?.removeEventListener('scroll', syncVisibleHeight)
      window.removeEventListener('resize', syncVisibleHeight)
    }
  }, [open, mobileFullscreen])

  if (!open) return null

  const extracted = footer ? { content: children, actions: undefined } : splitTrailingModalActions(children)
  const effectiveFooter = footer ?? extracted.actions

  return (
    <div className="modal-backdrop">
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`modal-card ${wide ? 'modal-wide' : ''} ${mobileSheet ? 'modal-mobile-sheet' : ''} ${mobileFullscreen ? 'modal-mobile-fullscreen' : ''} ${effectiveFooter ? 'modal-with-footer' : ''} ${className}`.trim()} onMouseDown={e => e.stopPropagation()}>
        <header className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
        <div className="tutorial-modal-coachmark-slot" aria-live="polite"/>
        <div className="modal-body">{extracted.content}</div>
        {effectiveFooter && <footer className="modal-footer">{effectiveFooter}</footer>}
      </section>
    </div>
  )
}
