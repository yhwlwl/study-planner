import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'

export function isGuestResetButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  const button = target.closest('button.danger-button')
  return button instanceof HTMLButtonElement && button.textContent?.includes('重置计划') === true
}

/**
 * v0.9.1 的设置页把游客空间“重置计划”错误地传成 resetAll('demo')，
 * 因此确认后会立即恢复演示数据，看起来像完全没有重置。
 *
 * 这里在 React 根节点收到原 click 之前截获游客的危险重置操作，明确改成 blank。
 * 登录账号不受影响；“恢复演示计划”按钮也不会被拦截。
 */
export function DataResetCompatibilityGuard() {
  const { namespace, resetAll } = useApp()
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (namespace !== 'guest') return

    const handleClick = (event: MouseEvent) => {
      if (!isGuestResetButton(event.target)) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      const confirmed = window.confirm('确认清空当前游客数据空间？\n\n导出备份不是重置的前置条件。如果需要保留当前计划，请先点“取消”并导出 JSON；继续后会真正清空当前计划，不会自动恢复演示数据。')
      if (!confirmed) return

      void resetAll('blank')
        .then(() => {
          setNotice('当前游客数据空间已重置为空白。需要示例数据时可点击“恢复演示计划”。')
          window.setTimeout(() => setNotice(''), 5000)
        })
        .catch(() => {
          setNotice('重置失败，请刷新后重试。')
          window.setTimeout(() => setNotice(''), 5000)
        })
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [namespace, resetAll])

  if (!notice) return null
  return <div role="status" aria-live="polite" style={{ position: 'fixed', left: '50%', bottom: 'calc(24px + env(safe-area-inset-bottom))', transform: 'translateX(-50%)', zIndex: 240, width: 'min(92vw, 520px)', padding: '12px 14px', borderRadius: 12, background: '#172033', color: '#fff', boxShadow: '0 16px 44px rgba(15,23,42,.28)', fontSize: 13, lineHeight: 1.55, textAlign: 'center' }}>{notice}</div>
}
