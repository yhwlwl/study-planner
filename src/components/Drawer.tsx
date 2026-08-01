import { X } from 'lucide-react'
import type { ReactNode } from 'react'

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
  if (!open) return null
  return <div className="drawer-backdrop">
    <aside className={`side-drawer ${wide ? 'side-drawer-wide' : ''}`} onMouseDown={event => event.stopPropagation()}>
      <header className="drawer-header">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  </div>
}
