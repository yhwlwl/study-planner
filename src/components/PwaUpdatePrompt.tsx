import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { deferPwaUpdate, installPwaUpdate, subscribePwaUpdate } from '../lib/pwa-update'

export function PwaUpdatePrompt() {
  const [available, setAvailable] = useState(false)
  const [installing, setInstalling] = useState(false)
  useEffect(() => {
    const unsubscribe = subscribePwaUpdate(setAvailable)
    return () => { unsubscribe() }
  }, [])
  if (!available) return null
  return <aside className="pwa-update-prompt" role="status" aria-live="polite">
    <RefreshCw size={20}/>
    <div><strong>新版本已准备好</strong><span>先完成正在填写的内容，再刷新更新。当前页面不会自动重载。</span></div>
    <button className="secondary-button" onClick={deferPwaUpdate}>稍后</button>
    <button className="primary-button" disabled={installing} onClick={() => { setInstalling(true); void installPwaUpdate() }}>{installing ? '正在更新' : '现在更新'}</button>
  </aside>
}
