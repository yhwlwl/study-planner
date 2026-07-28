import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ open, title, children, onClose, wide = false }: { open: boolean; title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className={`modal-card ${wide ? 'modal-wide' : ''}`} onMouseDown={e => e.stopPropagation()}>
        <header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  )
}
