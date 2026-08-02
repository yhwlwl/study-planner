import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

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
  if (!titleIdRef.current) titleIdRef.current = `drawer-title-${Math.random().toString(36).slice(2, 10)}`
  const titleId = titleIdRef.current
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])
  if (!open) return null
  return <div className="drawer-backdrop">
    <aside role="dialog" aria-modal="true" aria-labelledby={titleId} className={`side-drawer ${wide ? 'side-drawer-wide' : ''}`} onMouseDown={event => event.stopPropagation()}>
      <header className="drawer-header">
        <div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  </div>
}
