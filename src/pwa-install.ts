export type InstallPlatform = 'ios' | 'android' | 'desktop' | 'other'

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const PROMPT_STATE_KEY = 'study-planner:pwa-install-prompt-v1'
const VISIT_COUNT_KEY = 'study-planner:pwa-browser-visits-v1'
const SESSION_COUNTED_KEY = 'study-planner:pwa-browser-visit-counted-v1'
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

export const PWA_INSTALL_EVENT = 'study-planner:pwa-install-open'

export function isStandaloneMode() {
  if (typeof window === 'undefined') return false
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches === true || standaloneNavigator.standalone === true
}

export function installPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent || ''
  const touchMac = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|iPod/i.test(ua) || touchMac) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop'
  return 'other'
}

export function isIosSafari() {
  if (installPlatform() !== 'ios') return false
  const ua = navigator.userAgent || ''
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)
}

function readState(): { snoozedUntil?: number; never?: boolean } {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROMPT_STATE_KEY) || '{}')
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

function writeState(next: { snoozedUntil?: number; never?: boolean }) {
  try { window.localStorage.setItem(PROMPT_STATE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

export function recordBrowserVisit() {
  if (typeof window === 'undefined' || isStandaloneMode()) return 0
  try {
    const existing = Math.max(0, Number.parseInt(window.localStorage.getItem(VISIT_COUNT_KEY) || '0', 10) || 0)
    if (window.sessionStorage.getItem(SESSION_COUNTED_KEY) === '1') return existing
    const next = existing + 1
    window.sessionStorage.setItem(SESSION_COUNTED_KEY, '1')
    window.localStorage.setItem(VISIT_COUNT_KEY, String(next))
    return next
  } catch {
    return 1
  }
}

export function shouldAutoOfferInstall(visitCount: number) {
  if (typeof window === 'undefined' || isStandaloneMode() || visitCount < 2) return false
  const state = readState()
  if (state.never) return false
  if (state.snoozedUntil && state.snoozedUntil > Date.now()) return false
  return true
}

export function snoozeInstallPrompt() {
  writeState({ snoozedUntil: Date.now() + SNOOZE_MS })
}

export function neverShowInstallPrompt() {
  writeState({ never: true })
}

export function resetInstallPromptPreference() {
  writeState({})
}

export function openInstallGuide() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PWA_INSTALL_EVENT, { detail: { open: true } }))
}
