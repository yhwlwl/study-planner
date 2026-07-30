import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AppProvider } from './AppContext'
import { recordPageVisit } from './lib/analytics'

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider><App /></AppProvider>
  </StrictMode>
)

// Access logging is deliberately deferred until after the first paint so it
// never competes with plan restoration, rendering, or Supabase cloud sync.
const logVisit = () => { void recordPageVisit() }
const idleWindow = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }
if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(logVisit, { timeout: 3000 })
else globalThis.setTimeout(logVisit, 1200)
