import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AppProvider } from './AppContext'
import { installVisitLogRetry, recordPageVisit } from './lib/analytics'

registerSW({ immediate: true })
installVisitLogRetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider><App /></AppProvider>
  </StrictMode>
)

// Log shortly after the first paint. A deterministic timer is more reliable on
// mobile/PWA browsers than waiting indefinitely for an idle callback.
globalThis.setTimeout(() => { void recordPageVisit() }, 700)
