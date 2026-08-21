import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { lockPageScroll } from '../lib/scroll-lock'

export function Drawer({
  open,
  title,
  subtitle,
  children,
  onClose,
  wide = false
}: {
  open: boolean
  title: string
  subtitle?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const titleIdRef = useRef<string>()
  const drawerRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  if (!titleIdRef.current) titleIdRef.current = `drawer-title-${Math.random().toString(36).slice(2, 10)}`
  const titleId = titleIdRef.current
  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // 滚动锁使用引用计数（见 src/lib/scroll-lock.ts），避免多个抽屉/弹窗乱序关闭时把页面锁死。
    const unlockPageScroll = lockPageScroll()
    const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    const focusFirst = window.requestAnimationFrame(() => {
      const first = drawerRef.current?.querySelector<HTMLElement>(selector)
      ;(first ?? drawerRef.current)?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab' || !drawerRef.current) return
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(selector))
      if (!focusable.length) { event.preventDefault(); drawerRef.current.focus(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { window.cancelAnimationFrame(focusFirst); document.removeEventListener('keydown', handleKeyDown); unlockPageScroll(); previousFocusRef.current?.focus() }
  }, [open])
  if (!open) return null
  return <div className="drawer-backdrop">
    <aside ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`side-drawer ${wide ? 'side-drawer-wide' : ''}`} onMouseDown={event => event.stopPropagation()}>
      <header className="drawer-header">
        <div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  </div>
}
