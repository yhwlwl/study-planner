import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AppProvider } from './AppContext'
import { AnalyticsObserver } from './components/AnalyticsObserver'
import { EmailVerificationBanner } from './components/EmailVerificationBanner'
import { initializeAnalytics, installVisitLogRetry, recordPageVisit } from './lib/analytics'
import './analytics.css'

registerSW({ immediate: true })
initializeAnalytics()
installVisitLogRetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <AnalyticsObserver />
      <EmailVerificationBanner />
      <App />
    </AppProvider>
  </StrictMode>
)

// Log shortly after the first paint. A deterministic timer is more reliable on
// mobile/PWA browsers than waiting indefinitely for an idle callback.
globalThis.setTimeout(() => { void recordPageVisit() }, 700)
