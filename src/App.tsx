import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowUpRight, BarChart3, BookOpen, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Cloud, CloudOff, Github, Target,
  Download, FileDown, Filter, Inbox, LayoutDashboard, ListTodo, Lock, Menu, Plus, RefreshCw,
  RotateCcw, Search, Settings as SettingsIcon, Sparkles, Trash2, Upload, X, Printer
} from 'lucide-react'
import { addMonths, endOfMonth, format, getDay, isWithinInterval, parseISO, startOfMonth } from 'date-fns'
import { useApp } from './AppContext'
import type { AppState, Assignment, BufferPreference, DayType, PlanAdjustmentPolicy, PlanChangeEvent, Priority, SchedulingIntent, SchedulingProposal, SequenceRenumberSuggestion, ConstraintException, Subject, TaskGroup } from './types'
import { clampDate, constraintsForDate, dateRange, dayTypeLabel, fmtDate, fmtWeekday, getCapacity, getDayConfig, isDateProtected, minutesText, shiftDate, timestampForDate, todayISO } from './lib/date'
import { actualLearningSnapshot, allDurationSuggestions, analyzePlan, checkAssignmentPlacement, effectiveMinutes, planningDayLoad, predictCompletion, previewPreparedChange } from './lib/planner'
import { allGoalProgress, nearestRelevantGoalDate } from './lib/goals'
import { uid } from './lib/id'
import { cloneActiveState, hydratePortableState } from './lib/state'
import { buildBlankState, buildGuestDemoState, normalizeState } from './lib/seed'
import {
  TUTORIAL_EXECUTE_ASSIGNMENT_ID, TUTORIAL_NAMESPACE, advanceTutorialSession, buildTutorialCheckpoint, buildTutorialState,
  clearTutorialSession, createTutorialSession, ensureTutorialIntakeBatch, isTutorialNamespace, readTutorialSession, recoverTutorialSession,
  tutorialAcceptsEvent, tutorialAllowsPage, tutorialCompleted, tutorialIssueCount, tutorialPageForStep, tutorialRecoveryStep, tutorialStateHealth,
  writeTutorialSession, type TutorialSession, type TutorialStep,
} from './lib/tutorial'
import { loadLocalState } from './lib/db'
import { Modal } from './components/Modal'
import { Drawer } from './components/Drawer'
import { TaskCard } from './components/TaskCard'
import { AdjustmentIntentDialog } from './components/AdjustmentIntentDialog'
import { BulkMoveCenterDialog } from './components/BulkMoveCenterDialog'
import { GoalDeadlineDialog } from './components/GoalDeadlineDialog'
import { TaskGroupDialog } from './components/TaskGroupDialog'
import { SingleTaskDialog } from './components/SingleTaskDialog'
import { AddTaskDialog, type TaskCreationKind, type TaskCreationMode } from './components/AddTaskDialog'
import { AssignmentGroupChangeDialog } from './components/AssignmentGroupChangeDialog'
import { ProposalDialog } from './components/ProposalDialog'
import { GoalsPage } from './components/GoalsPage'
import { CalendarConstraintManager } from './components/CalendarConstraintManager'
import { ReviewDialog } from './components/ReviewDialog'
import { HistoryDiffDialog } from './components/HistoryDiffDialog'
import { FocusTimerPage, getTimerElapsedSeconds } from './components/FocusTimerPage'
import { GuidePage, GITHUB_REPO_URL } from './components/GuidePage'
import { TutorialCoachmark, type TutorialCoachmarkConfig } from './components/TutorialCoachmark'
import { IntakePage } from './components/IntakePage'
import { ExportPage } from './components/ExportPage'
import { NumericInput } from './components/NumericInput'
import { adjustmentPolicyForEvent, eventWithPreferences } from './lib/adjustment'
import { applyConflictDecisions, mergeConstraintExceptions } from './lib/conflicts'
import { downloadSnapshot, getSession, preparePortableState, signIn, signOut, signUp, supabase, supabaseConfigured, uploadSnapshot } from './lib/supabase'
import { buildCalendarPrintHtml, buildCalendarSvg, downloadSvgAsPng, safeExportName } from './lib/exports'
import { Analytics } from '@vercel/analytics/react'
import './styles.css'
import './tutorial.css'

const StatsPage = lazy(() => import('./components/StatsPage').then(module => ({ default: module.StatsPage })))

type Page = 'today' | 'calendar' | 'tasks' | 'intake' | 'goals' | 'stats' | 'export' | 'guide' | 'settings' | 'timer'
type ShiftScope = 'today' | 'future'
type CloudSyncStatus = 'local' | 'restoring' | 'queued' | 'saving' | 'saved' | 'error'

type CloudSaveQueue = {
  scope?: string
  pending?: AppState
  timer?: number
  inFlight?: Promise<void>
  lastSavedUpdatedAt?: string
}

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'today', label: '今日', icon: LayoutDashboard },
  { id: 'calendar', label: '月历', icon: CalendarDays },
  { id: 'tasks', label: '任务', icon: ListTodo },
  { id: 'intake', label: '录入', icon: Inbox },
  { id: 'goals', label: '目标', icon: Target },
  { id: 'stats', label: '统计', icon: BarChart3 },
  { id: 'export', label: '导出', icon: FileDown },
  { id: 'guide', label: '使用教程', icon: BookOpen },
  { id: 'settings', label: '设置', icon: SettingsIcon }
]

function priorityLabel(priority: Priority) {
  return priority === 5 ? '核心' : priority === 3 ? '高' : priority === 2 ? '中' : priority === 1 ? '低' : '可选'
}

export default function App() {
  const {
    state, namespace, ready, loadedFromStorage, updateSettings, prepareSingleAssignment, prepareTaskGroup,
    generateProposals, applySchedulingProposal, applyPreparedWithoutScheduling, replaceState, loadDataSpace, setDataSpace, clearDataSpace, sequenceRenumberSuggestion,
    dismissSequenceRenumberSuggestion, applySequenceRenumber, completeReview, undo, canUndo, updateIntakeBatch, prepareDurationChange
  } = useApp()
  const [page, setPage] = useState<Page>('today')
  const initialRouteHandled = useRef(false)
  const mainAreaRef = useRef<HTMLElement>(null)
  const [singleTaskOpen, setSingleTaskOpen] = useState(false)
  const [singleTaskDate, setSingleTaskDate] = useState<string>()
  const [singleTaskIntent, setSingleTaskIntent] = useState<SchedulingIntent>('system')
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [addTaskOpen, setAddTaskOpen] = useState(false)
  const [addTaskContext, setAddTaskContext] = useState<{ date?: string; intent: SchedulingIntent; intakeBatchId?: string }>({ intent: 'system' })
  const [intakeAddRequest, setIntakeAddRequest] = useState<{ id: string; kind: TaskCreationKind; batchId?: string }>()
  const [reviewDate, setReviewDate] = useState<string>()
  const [proposalSession, setProposalSession] = useState<{ baseline: AppState; prepared: AppState; event: PlanChangeEvent; policy: PlanAdjustmentPolicy; proposals: SchedulingProposal[]; expansionLevel: number; calculationRevision: number; acceptedExceptions?: ConstraintException[]; decisionSummary?: string; moreExhausted?: boolean }>()
  const [proposalGeneration, setProposalGeneration] = useState<{ baseline: AppState; prepared: AppState; event: PlanChangeEvent; policy: PlanAdjustmentPolicy; seedProposals: SchedulingProposal[]; worker?: Worker; error?: string }>()
  const [mobileNav, setMobileNav] = useState(false)
  const [adjustmentOpen, setAdjustmentOpen] = useState(false)
  const [adjustmentDate, setAdjustmentDate] = useState<string>()
  const [adjustmentReason, setAdjustmentReason] = useState<'current-conflicts' | 'too-tiring' | 'future-replan' | 'execution-difference'>('current-conflicts')
  const [deadlineDialogOpen, setDeadlineDialogOpen] = useState(false)
  const [bulkMoveCenterOpen, setBulkMoveCenterOpen] = useState(false)
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string }>()
  const [authResolved, setAuthResolved] = useState(!supabase)
  const [tutorialSession, setTutorialSession] = useState<TutorialSession | undefined>(() => readTutorialSession())
  const [tutorialBootReady, setTutorialBootReady] = useState(false)
  const [tutorialBlockedNotice, setTutorialBlockedNotice] = useState<string>()
  const tutorialBootstrapRunning = useRef(false)
  const tutorialBootHandled = useRef(false)
  const tutorialTransitionRunning = useRef(false)
  const tutorialSessionRef = useRef(tutorialSession)
  const [cloudReady, setCloudReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('local')
  const [firstLoginOpen, setFirstLoginOpen] = useState(false)
  const [cloudMessage, setCloudMessage] = useState('')
  const [actionNotice, setActionNotice] = useState<string>()
  const [dataSwitching, setDataSwitching] = useState(false)
  const tutorialActive = Boolean(tutorialSession && isTutorialNamespace(namespace))
  const tutorialStepValue = tutorialSession?.step
  const effectiveToday = tutorialSession?.anchorDate ?? todayISO()
  const currentIssueCount = useMemo(() => tutorialActive ? tutorialIssueCount(state, effectiveToday) : analyzePlan(state, effectiveToday).filter(issue => issue.level === 'danger').length, [state, effectiveToday, tutorialActive])
  const previousUserId = useRef<string>()
  const guestSnapshotRef = useRef<AppState>()
  const [guestImportAvailable, setGuestImportAvailable] = useState(false)
  const stateRef = useRef(state)
  const namespaceRef = useRef(namespace)
  const cloudSaveQueue = useRef<CloudSaveQueue>({})
  stateRef.current = state
  namespaceRef.current = namespace
  tutorialSessionRef.current = tutorialSession

  const tutorialReturnPage = (value: Page): TutorialSession['returnPage'] => value === 'timer' ? 'today' : value

  const tutorialNotice = (message = '教程中先完成当前这一步') => {
    setTutorialBlockedNotice(message)
    window.setTimeout(() => setTutorialBlockedNotice(current => current === message ? undefined : current), 1800)
  }

  const closeTutorialTransients = () => {
    setProposalSession(undefined)
    proposalGeneration?.worker?.terminate()
    setProposalGeneration(undefined)
    setAdjustmentOpen(false)
    setReviewDate(undefined)
    setAddTaskOpen(false)
    setSingleTaskOpen(false)
    setGroupDialogOpen(false)
    setDeadlineDialogOpen(false)
    setBulkMoveCenterOpen(false)
    setMobileNav(false)
  }

  const persistTutorialState = async (next: AppState) => {
    try {
      await setDataSpace(TUTORIAL_NAMESPACE, next, false)
      return true
    } catch (error) {
      console.warn('教程状态暂时无法持久化；当前标签页仍可继续。', error)
      tutorialNotice('教程仍可继续；本机保存暂时不可用')
      return false
    }
  }

  const updateTutorialSession = (session: TutorialSession) => {
    tutorialSessionRef.current = session
    setTutorialSession(session)
    writeTutorialSession(session)
    return session
  }

  const advanceTutorialOnly = (expected: TutorialStep | TutorialStep[], next: TutorialStep) => {
    const current = tutorialSessionRef.current
    if (!current) return undefined
    const updated = advanceTutorialSession(current, expected, next)
    if (updated === current) return undefined
    tutorialSessionRef.current = updated
    setTutorialSession(updated)
    return updated
  }


  const advanceTutorialStable = (expected: TutorialStep | TutorialStep[], next: TutorialStep) => {
    if (tutorialTransitionRunning.current) return false
    const updated = advanceTutorialOnly(expected, next)
    if (!updated) return false
    closeTutorialTransients()
    setPage(tutorialPageForStep(next) as Page)
    return true
  }

  const enterTutorialIntake = async () => {
    const current = tutorialSessionRef.current
    if (!current || current.step !== 'goal' || tutorialTransitionRunning.current) return
    const updated = advanceTutorialOnly('goal', 'intake')
    if (!updated) return
    tutorialTransitionRunning.current = true
    closeTutorialTransients()
    try {
      const next = ensureTutorialIntakeBatch(stateRef.current, updated.anchorDate)
      await persistTutorialState(next)
      setPage('intake')
    } finally {
      tutorialTransitionRunning.current = false
    }
  }

  const tutorialProposalState = (proposal: SchedulingProposal) => hydratePortableState(proposal.stateAfter, {
    replanHistory: stateRef.current.replanHistory,
    conflictBackups: stateRef.current.conflictBackups,
    planVersions: stateRef.current.planVersions,
  })

  const applyTutorialProposal = async (proposal: SchedulingProposal, expected: TutorialStep, next: TutorialStep) => {
    const current = tutorialSessionRef.current
    if (!current || current.step !== expected || tutorialTransitionRunning.current) return false
    const nextState = tutorialProposalState(proposal)
    const candidateSession: TutorialSession = { ...current, step: next, updatedAt: new Date().toISOString() }
    const health = tutorialStateHealth(nextState, candidateSession)
    if (!health.ok) {
      tutorialNotice(`这个方案暂时不能进入下一步：${health.reason}`)
      return false
    }
    const updated = advanceTutorialOnly(expected, next)
    if (!updated) return false
    tutorialTransitionRunning.current = true
    closeTutorialTransients()
    try {
      await persistTutorialState(nextState)
      setPage(tutorialPageForStep(next) as Page)
      return true
    } finally {
      tutorialTransitionRunning.current = false
    }
  }

  const recoverTutorialTo = async (step?: TutorialStep, message?: string) => {
    const current = tutorialSessionRef.current
    if (!current) return
    const safeStep = step ?? tutorialRecoveryStep(current.step)
    const recovered = updateTutorialSession({ ...current, step: safeStep, updatedAt: new Date().toISOString() })
    closeTutorialTransients()
    const health = tutorialStateHealth(stateRef.current, recovered)
    if (!health.ok) await persistTutorialState(buildTutorialCheckpoint(safeStep, recovered.anchorDate))
    setPage(tutorialPageForStep(safeStep) as Page)
    if (message) tutorialNotice(message)
  }

  const startTutorial = async (options?: { auto?: boolean }) => {
    if (tutorialBootstrapRunning.current) return
    tutorialBootstrapRunning.current = true
    setDataSwitching(true)
    closeTutorialTransients()
    setFirstLoginOpen(false)
    try {
      const returnNamespace = namespaceRef.current
      const returnHadData = options?.auto ? false : loadedFromStorage || stateRef.current.assignments.length > 0 || stateRef.current.taskGroups.length > 0 || stateRef.current.intakeBatches.length > 0
      if (returnHadData) await setDataSpace(returnNamespace, stateRef.current, false)
      const session = createTutorialSession(returnNamespace, returnHadData, todayISO(), tutorialReturnPage(page))
      tutorialSessionRef.current = session
      setTutorialSession(session)
      await persistTutorialState(buildTutorialState(session.anchorDate))
      setPage('today')
    } finally {
      setDataSwitching(false)
      tutorialBootstrapRunning.current = false
    }
  }

  const restartTutorial = async () => {
    const current = tutorialSessionRef.current
    if (!current || tutorialBootstrapRunning.current) return
    tutorialBootstrapRunning.current = true
    setDataSwitching(true)
    closeTutorialTransients()
    try {
      const restarted = updateTutorialSession({ ...current, step: 'repair-entry', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      await persistTutorialState(buildTutorialCheckpoint('repair-entry', restarted.anchorDate))
      setPage('today')
    } finally {
      setDataSwitching(false)
      tutorialBootstrapRunning.current = false
    }
  }

  const exitTutorial = async (markCompleted = false) => {
    const current = tutorialSessionRef.current
    if (!current || tutorialBootstrapRunning.current) return
    tutorialBootstrapRunning.current = true
    setDataSwitching(true)
    closeTutorialTransients()
    let switched = false
    try {
      let returnNamespace = current.returnNamespace
      if (sessionUser?.id) returnNamespace = `user:${sessionUser.id}`
      else if (returnNamespace.startsWith('user:')) returnNamespace = 'guest'

      if (returnNamespace.startsWith('user:')) {
        const userId = returnNamespace.slice('user:'.length)
        if (current.returnHadData) {
          try {
            await loadDataSpace(returnNamespace, buildBlankState())
            switched = true
          } catch (error) {
            console.warn('无法恢复教程前的账号计划。', error)
            tutorialNotice('暂时无法恢复你的原计划，请稍后再退出教程')
            return
          }
        } else {
          const blank = buildBlankState()
          blank.guestModified = false
          try { await setDataSpace(returnNamespace, blank, false) } catch (error) { console.warn('空白账号计划暂时无法持久化。', error) }
          switched = true
          if (markCompleted && sessionUser?.id === userId) {
            try {
              await uploadSnapshot(blank, userId)
              resetCloudQueue(returnNamespace, blank.updatedAt)
              setCloudReady(true)
              setSyncStatus('saved')
              setCloudMessage('教程已结束，已创建独立的空白个人计划。')
            } catch (error) {
              setCloudReady(false)
              setSyncStatus('error')
              setCloudMessage(error instanceof Error ? `个人计划已保存在本机；云端初始化失败：${error.message}` : '个人计划已保存在本机；云端初始化失败。')
            }
          } else {
            setCloudReady(false)
            setSyncStatus('local')
            setFirstLoginOpen(true)
          }
        }
      } else if (current.returnHadData) {
        try {
          await loadDataSpace(returnNamespace, buildGuestDemoState())
          switched = true
        } catch (error) {
          console.warn('无法恢复教程前的游客计划。', error)
          tutorialNotice('暂时无法恢复你的原计划，请稍后再退出教程')
          return
        }
      } else {
        const blank = buildBlankState()
        try { await setDataSpace(returnNamespace, blank, false) } catch (error) { console.warn('空白游客计划暂时无法持久化。', error) }
        switched = true
      }

      if (!switched) return
      clearTutorialSession(markCompleted)
      tutorialSessionRef.current = undefined
      setTutorialSession(undefined)
      void clearDataSpace(TUTORIAL_NAMESPACE).catch(() => undefined)
      setPage(current.returnPage as Page)
    } finally {
      setDataSwitching(false)
      tutorialBootstrapRunning.current = false
    }
  }


  const navigate = (target: Page) => {
    const current = tutorialSessionRef.current
    if (current && !tutorialAllowsPage(current.step, target)) {
      tutorialNotice()
      setMobileNav(false)
      return
    }
    setPage(target)
    setMobileNav(false)
  }

  useEffect(() => {
    if (!ready || !authResolved || tutorialBootHandled.current) return
    tutorialBootHandled.current = true
    const stored = tutorialSessionRef.current
    if (stored) {
      const recoveredBase = recoverTutorialSession(stored)
      const returnNamespace = sessionUser?.id ? `user:${sessionUser.id}` : recoveredBase.returnNamespace.startsWith('user:') ? 'guest' : recoveredBase.returnNamespace
      const recovered = returnNamespace === recoveredBase.returnNamespace ? recoveredBase : { ...recoveredBase, returnNamespace, updatedAt: new Date().toISOString() }
      updateTutorialSession(recovered)
      tutorialBootstrapRunning.current = true
      setDataSwitching(true)
      closeTutorialTransients()
      const fallback = buildTutorialCheckpoint(recovered.step, recovered.anchorDate)
      void loadDataSpace(TUTORIAL_NAMESPACE, fallback)
        .then(async loaded => {
          const health = tutorialStateHealth(loaded, recovered)
          if (!health.ok) await persistTutorialState(fallback)
          setPage(tutorialPageForStep(recovered.step) as Page)
        })
        .catch(async error => {
          console.warn('教程本地状态读取失败，使用当前版本 checkpoint 恢复。', error)
          await persistTutorialState(fallback)
          setPage(tutorialPageForStep(recovered.step) as Page)
        })
        .finally(() => { tutorialBootstrapRunning.current = false; setDataSwitching(false); setTutorialBootReady(true) })
      return
    }
    if (namespace === 'guest' && !sessionUser && !loadedFromStorage && !tutorialCompleted()) {
      void startTutorial({ auto: true }).finally(() => setTutorialBootReady(true))
      return
    }
    setTutorialBootReady(true)
  }, [ready, authResolved, namespace, loadedFromStorage, sessionUser?.id])

  useEffect(() => {
    const current = tutorialSessionRef.current
    if (!tutorialBootReady || !current || current.step === 'free') return
    const target = tutorialPageForStep(current.step) as Page
    if (page !== target) setPage(target)
  }, [tutorialBootReady, tutorialSession?.step, page])

  useEffect(() => {
    // Pages share the document scroller. Starting a newly selected module at the
    // previous module's scroll offset is especially disorienting on mobile.
    const resetScroll = () => {
      window.scrollTo(0, 0)
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      mainAreaRef.current?.scrollIntoView({ block: 'start' })
    }
    resetScroll()
    const frame = window.requestAnimationFrame(resetScroll)
    const afterNavigation = window.setTimeout(resetScroll, 260)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(afterNavigation)
    }
  }, [page])

  useEffect(() => {
    if (!ready || tutorialSession || initialRouteHandled.current) return
    initialRouteHandled.current = true
    const trulyBlank = state.assignments.length === 0 && state.taskGroups.length === 0 && state.intakeBatches.length === 0
    if (trulyBlank && (state.templateKind === 'blank' || namespace !== 'guest')) setPage('intake')
  }, [ready, tutorialSession, namespace, state.assignments.length, state.taskGroups.length, state.intakeBatches.length, state.templateKind])

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const resolved = state.settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : state.settings.theme
      root.dataset.theme = resolved
      root.style.colorScheme = resolved
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [state.settings.theme])

  const resetCloudQueue = (scope?: string, lastSavedUpdatedAt?: string) => {
    const queue = cloudSaveQueue.current
    if (queue.timer) window.clearTimeout(queue.timer)
    queue.scope = scope
    queue.pending = undefined
    queue.timer = undefined
    queue.lastSavedUpdatedAt = lastSavedUpdatedAt
  }

  const flushCloudQueue = async () => {
    const queue = cloudSaveQueue.current
    if (queue.inFlight || !queue.pending || !queue.scope) return
    const scope = queue.scope
    const userId = scope.replace(/^user:/, '')
    const next = queue.pending
    queue.pending = undefined
    queue.timer = undefined
    setSyncStatus('saving')

    const rawRequest = uploadSnapshot(next, userId)
    const request = rawRequest.then(() => undefined, () => undefined)
    queue.inFlight = request
    try {
      await rawRequest
      if (queue.scope === scope) queue.lastSavedUpdatedAt = next.updatedAt
    } catch {
      if (queue.scope === scope) setSyncStatus('error')
    } finally {
      if (queue.inFlight === request) queue.inFlight = undefined
      if (queue.scope !== scope) return
      const pendingAfter = cloudSaveQueue.current.pending as AppState | undefined
      if (pendingAfter && pendingAfter.updatedAt !== queue.lastSavedUpdatedAt) {
        setSyncStatus('queued')
        queue.timer = window.setTimeout(() => { void flushCloudQueue() }, 120)
      } else if (queue.lastSavedUpdatedAt === next.updatedAt) {
        setSyncStatus('saved')
      }
    }
  }

  const queueCloudSave = (next: AppState, userId: string, delay = 450) => {
    const scope = `user:${userId}`
    const queue = cloudSaveQueue.current
    if (queue.scope !== scope) resetCloudQueue(scope)
    if (queue.lastSavedUpdatedAt === next.updatedAt) return
    queue.pending = next
    if (queue.timer) window.clearTimeout(queue.timer)
    if (!queue.inFlight) setSyncStatus('queued')
    queue.timer = window.setTimeout(() => { void flushCloudQueue() }, delay)
  }

  const uploadCloudNow = async () => {
    if (!sessionUser?.id) throw new Error('请先登录')
    const userId = sessionUser.id
    const scope = `user:${userId}`
    const queue = cloudSaveQueue.current
    if (queue.scope !== scope) resetCloudQueue(scope)
    if (queue.timer) window.clearTimeout(queue.timer)
    queue.timer = undefined
    if (queue.inFlight) {
      try { await queue.inFlight } catch { /* retry below with latest state */ }
    }
    if (queue.timer) window.clearTimeout(queue.timer)
    queue.timer = undefined
    const latest = stateRef.current
    queue.pending = undefined
    setSyncStatus('saving')
    const rawRequest = uploadSnapshot(latest, userId)
    const request = rawRequest.then(() => undefined, () => undefined)
    queue.inFlight = request
    try {
      const savedAt = await rawRequest
      queue.lastSavedUpdatedAt = latest.updatedAt
      setSyncStatus('saved')
      return savedAt
    } catch (error) {
      setSyncStatus('error')
      throw error
    } finally {
      if (queue.inFlight === request) queue.inFlight = undefined
      const pendingAfter = cloudSaveQueue.current.pending as AppState | undefined
      if (pendingAfter && pendingAfter.updatedAt !== queue.lastSavedUpdatedAt) {
        setSyncStatus('queued')
        queue.timer = window.setTimeout(() => { void flushCloudQueue() }, 120)
      }
    }
  }

  useEffect(() => {
    if (!supabase) { setAuthResolved(true); return }
    let disposed = false
    const applySession = async (session: Session | null) => {
      const user = session ? { id: session.user.id, email: session.user.email } : undefined
      const tutorialRunning = Boolean(tutorialSessionRef.current)

      // Supabase may emit TOKEN_REFRESHED / SIGNED_IN again when a background tab
      // becomes visible. That is not an account change.
      if (user && previousUserId.current === user.id) {
        setSessionUser(current => (current?.id === user.id && current.email === user.email ? current : user))
        return
      }

      if (!user && !previousUserId.current) {
        setSessionUser(undefined)
        return
      }

      // Tutorial is an isolated local workspace. Auth can change in another tab or
      // because a token refreshes, but it must never replace tutorial data mid-step.
      if (tutorialRunning) {
        previousUserId.current = user?.id
        setSessionUser(user)
        setCloudReady(false)
        resetCloudQueue(user ? `user:${user.id}` : undefined)
        setSyncStatus('local')
        setFirstLoginOpen(false)
        return
      }

      if (!user) {
        setDataSwitching(true)
        const oldUser = previousUserId.current
        previousUserId.current = undefined
        setSessionUser(undefined)
        setCloudReady(false)
        resetCloudQueue()
        setSyncStatus('local')
        setFirstLoginOpen(false)
        const keepOffline = stateRef.current.settings.keepOfflineOnLogout
        try {
          await loadDataSpace('guest', buildGuestDemoState())
          if (oldUser && !keepOffline) await clearDataSpace(`user:${oldUser}`)
        } finally {
          setDataSwitching(false)
        }
        return
      }
      previousUserId.current = user.id
      resetCloudQueue(`user:${user.id}`)
      setDataSwitching(true)
      setSessionUser(user)
    }
    getSession()
      .then(session => void applySession(session))
      .finally(() => { if (!disposed) setAuthResolved(true) })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session).finally(() => { if (!disposed) setAuthResolved(true) })
    })
    return () => { disposed = true; data.subscription.unsubscribe() }
  }, [clearDataSpace, loadDataSpace])

  useEffect(() => {
    if (!ready || !sessionUser?.id || tutorialSession || isTutorialNamespace(namespace)) return
    let cancelled = false
    setCloudReady(false)
    setSyncStatus('restoring')
    const bootstrapCloud = async () => {
      try {
        const userId = sessionUser.id
        const userNamespace = `user:${userId}`
        // Local cache and cloud snapshot are independent; read them in parallel.
        const [localUser, cloud] = await Promise.all([
          loadLocalState(userNamespace),
          downloadSnapshot(userId)
        ])
        if (cancelled) return

        const normalizedLocal = localUser ? normalizeState(localUser) : undefined
        if (cloud) {
          const cloudNeedsCompaction = Boolean(cloud.replanHistory?.length || cloud.conflictBackups?.length)
          const normalizedCloud = normalizeState({
            ...cloud,
            // Replan history and conflict backups are device-local performance data.
            replanHistory: normalizedLocal?.replanHistory ?? [],
            conflictBackups: normalizedLocal?.conflictBackups ?? [],
            planVersions: normalizedLocal?.planVersions ?? []
          })
          const localNewer = normalizedLocal && Date.parse(normalizedLocal.updatedAt) > Date.parse(normalizedCloud.updatedAt)
          if (localNewer) {
            const useLocal = window.confirm(`检测到此设备的个人计划比云端更新。

确定：使用本机版本并上传云端。
取消：恢复云端版本，并把本机版本保存为冲突备份。`)
            if (useLocal) {
              await setDataSpace(userNamespace, normalizedLocal, false)
              await uploadSnapshot(normalizedLocal, userId)
              resetCloudQueue(userNamespace, normalizedLocal.updatedAt)
              setCloudMessage('已使用较新的本机版本并同步到云端。')
            } else {
              const backup = JSON.stringify(preparePortableState(normalizedLocal))
              normalizedCloud.conflictBackups = [...(normalizedLocal.conflictBackups ?? []).slice(-2), backup].slice(-3)
              await setDataSpace(userNamespace, normalizedCloud, false)
              resetCloudQueue(userNamespace, cloudNeedsCompaction ? undefined : normalizedCloud.updatedAt)
              setCloudMessage('已恢复云端版本，本机版本已保留为冲突备份。')
            }
          } else {
            if (normalizedLocal && normalizedLocal.updatedAt !== normalizedCloud.updatedAt) {
              const backup = JSON.stringify(preparePortableState(normalizedLocal))
              normalizedCloud.conflictBackups = [...(normalizedLocal.conflictBackups ?? []).slice(-2), backup].slice(-3)
            }
            await setDataSpace(userNamespace, normalizedCloud, false)
            resetCloudQueue(userNamespace, cloudNeedsCompaction ? undefined : normalizedCloud.updatedAt)
            setCloudMessage(cloudNeedsCompaction ? '已恢复个人计划，正在压缩旧版云端快照。' : '已从云端恢复个人计划。')
          }
          if (!cancelled) {
            setCloudReady(true)
            setSyncStatus('saved')
            setDataSwitching(false)
          }
          return
        }

        if (normalizedLocal && normalizedLocal.taskGroups.length > 0) {
          await setDataSpace(userNamespace, normalizedLocal, false)
          const uploadLocal = window.confirm('云端没有计划，但此设备保存了一份个人计划。是否把它作为云端初始版本？')
          if (uploadLocal) {
            await uploadSnapshot(normalizedLocal, userId)
            resetCloudQueue(userNamespace, normalizedLocal.updatedAt)
            setCloudReady(true)
            setSyncStatus('saved')
            setCloudMessage('已把本机个人计划设为云端初始版本。')
            setDataSwitching(false)
          } else {
            setSyncStatus('local')
            setFirstLoginOpen(true)
            setDataSwitching(false)
          }
          return
        }

        // 云端为空时绝不上传游客数据，先让用户选择模板或明确导入。
        const guestSource = normalizeState((await loadLocalState('guest')) ?? buildGuestDemoState())
        guestSnapshotRef.current = guestSource
        setGuestImportAvailable(Boolean(guestSource.guestModified))
        await loadDataSpace(userNamespace, buildBlankState())
        if (!cancelled) {
          resetCloudQueue(userNamespace)
          setSyncStatus('local')
          setFirstLoginOpen(true)
          setDataSwitching(false)
        }
      } catch (error) {
        if (!cancelled) {
          setCloudReady(false)
          setSyncStatus('error')
          setCloudMessage(error instanceof Error ? error.message : '云端恢复失败')
          setDataSwitching(false)
        }
      }
    }
    void bootstrapCloud()
    return () => { cancelled = true }
  }, [ready, sessionUser?.id, tutorialSession, namespace, loadDataSpace, setDataSpace])

  useEffect(() => {
    if (!ready || !sessionUser?.id || !cloudReady || namespace !== `user:${sessionUser.id}`) return
    queueCloudSave(state, sessionUser.id)
  }, [state, ready, sessionUser?.id, cloudReady, namespace])

  useEffect(() => {
    const retry = () => {
      if (!sessionUser?.id || !cloudReady || namespace !== `user:${sessionUser.id}`) return
      queueCloudSave(stateRef.current, sessionUser.id, 0)
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [sessionUser?.id, cloudReady, namespace])

  useEffect(() => {
    const flushBeforeBackground = () => {
      if (document.visibilityState === 'hidden' && cloudSaveQueue.current.pending) void flushCloudQueue()
    }
    const flushBeforePageHide = () => {
      if (cloudSaveQueue.current.pending) void flushCloudQueue()
    }
    document.addEventListener('visibilitychange', flushBeforeBackground)
    window.addEventListener('pagehide', flushBeforePageHide)
    return () => {
      document.removeEventListener('visibilitychange', flushBeforeBackground)
      window.removeEventListener('pagehide', flushBeforePageHide)
      const queue = cloudSaveQueue.current
      if (queue.timer) window.clearTimeout(queue.timer)
    }
  }, [])

  const openAdjustment = (date?: string, reason: 'current-conflicts' | 'too-tiring' | 'future-replan' | 'execution-difference' = 'current-conflicts') => {
    const tutorial = tutorialSessionRef.current
    if (tutorial && tutorial.step !== 'free') {
      if (tutorial.step === 'repair-entry') {
        if (!advanceTutorialOnly('repair-entry', 'repair-action')) return
        setAdjustmentDate(tutorial.anchorDate)
        setAdjustmentReason('current-conflicts')
        setAdjustmentOpen(true)
        return
      }
      if (tutorial.step === 'future-entry') {
        if (!advanceTutorialOnly('future-entry', 'future-action')) return
        setAdjustmentDate(shiftDate(tutorial.anchorDate, 1))
        setAdjustmentReason('future-replan')
        setAdjustmentOpen(true)
        return
      }
      tutorialNotice()
      return
    }
    setAdjustmentDate(date)
    setAdjustmentReason(reason)
    setAdjustmentOpen(true)
  }

  const closeAdjustment = () => {
    const tutorial = tutorialSessionRef.current
    setAdjustmentOpen(false)
    if (tutorial?.step === 'repair-action') void recoverTutorialTo('repair-entry')
    else if (tutorial?.step === 'future-action') void recoverTutorialTo('future-entry')
  }

  const openReview = (date: string) => {
    const tutorial = tutorialSessionRef.current
    if (tutorial && tutorial.step !== 'free') {
      if (tutorial.step !== 'review-entry' || date !== tutorial.anchorDate) { tutorialNotice(); return }
      if (!advanceTutorialOnly('review-entry', 'review-carry')) return
    }
    setReviewDate(date)
  }

  const closeReview = () => {
    const tutorial = tutorialSessionRef.current
    setReviewDate(undefined)
    if (tutorial?.step === 'review-carry') void recoverTutorialTo('review-entry')
  }

  const initializeAccount = async (kind: 'blank' | 'demo' | 'import' | 'separate') => {
    if (!sessionUser?.id) return
    let initial: AppState
    if (kind === 'import' && guestSnapshotRef.current) {
      initial = normalizeState(structuredClone(guestSnapshotRef.current))
      initial.guestModified = false
      initial.updatedAt = new Date().toISOString()
    } else {
      initial = kind === 'demo' ? buildGuestDemoState() : buildBlankState()
      initial.guestModified = false
    }
    await setDataSpace(`user:${sessionUser.id}`, initial, false)
    await uploadSnapshot(initial, sessionUser.id)
    resetCloudQueue(`user:${sessionUser.id}`, initial.updatedAt)
    setCloudReady(true)
    setSyncStatus('saved')
    setFirstLoginOpen(false)
    setDataSwitching(false)
    setCloudMessage(kind === 'import' ? '已把游客计划复制到个人账号；游客本地数据仍独立保留。' : kind === 'separate' ? '已创建独立空白账号计划；游客数据继续保留在本机游客空间。' : '个人计划已初始化。')
  }

  const openPrepared = (prepared: AppState, event: PlanChangeEvent, options?: { forceAlternatives?: boolean }) => {
    const tutorial = tutorialSessionRef.current
    const tutorialRestricted = Boolean(tutorial && tutorial.step !== 'free')
    const baseline = stateRef.current
    const policy = adjustmentPolicyForEvent(event)
    if (tutorialRestricted && tutorial) {
      if (!tutorialAcceptsEvent(tutorial, event)) { tutorialNotice(); return }
      const previewStep: Partial<Record<TutorialStep, TutorialStep>> = {
        'repair-action': 'repair-preview',
        intake: 'intake-preview',
        'review-carry': 'review-preview',
        'future-action': 'future-preview',
      }
      const nextPreview = previewStep[tutorial.step]
      if (!nextPreview) { tutorialNotice(); return }

      // 教程使用正式调度/校验核心。固定 fixture、固定策略和操作白名单负责一致性，
      // checkpoint 只负责验证，不再预先写死“正确答案”。
      const direct = previewPreparedChange(baseline, prepared, event, policy.directPreviewLabel)
      const generated = tutorial.step === 'review-carry'
        ? []
        : generateProposals(prepared, event, baseline, undefined, 0)
      const proposals = tutorial.step === 'review-carry'
      ? (direct.infeasible ? [] : [direct])
      : generated.filter(item => !item.infeasible)
      if (!proposals.length) {
        // 保留问题详情给用户看，不自动把整个教程跳回上一层。
        if (!advanceTutorialOnly(tutorial.step, nextPreview)) return
        setProposalSession({ baseline, prepared, event, policy, proposals: generated.length ? generated : [direct], expansionLevel: 0, calculationRevision: 0, moreExhausted: true })
        tutorialNotice('当前条件下没有直接可应用方案，请查看预览中的具体原因')
        return
      }
      if (!advanceTutorialOnly(tutorial.step, nextPreview)) return
      setProposalSession({ baseline, prepared, event, policy, proposals, expansionLevel: 0, calculationRevision: 0, moreExhausted: true })
      return
    }
    const directPreview = previewPreparedChange(baseline, prepared, event, policy.directPreviewLabel)
    const explicitLocalOperation = event.metadata?.explicitLocalOperation === true || event.metadata?.operationScope === 'requested-change-only'
    const useDirectFirst = policy.mode === 'validate-and-commit' || policy.mode === 'optional-optimization'

    // 明确的局部操作永远先展示“只执行用户操作”的精确预览。
    // 即使它产生了需要决定的新问题，也不自动启动全局搜索；用户可以处理这些问题，或主动获取更大范围方案。
    if (explicitLocalOperation && !options?.forceAlternatives) {
      setProposalSession({ baseline, prepared, event, policy, proposals: [directPreview], expansionLevel: 0, calculationRevision: 0 })
      return
    }

    // 用户已经明确指定结果，或变化只是放宽约束时，合法结果立即进入精确预览。
    // 其他优化方案仍可由用户在预览中主动生成，不让“保持现状”也先等待一轮重排。
    if (useDirectFirst && !directPreview.infeasible && !options?.forceAlternatives) {
      setProposalSession({ baseline, prepared, event, policy, proposals: [directPreview], expansionLevel: 0, calculationRevision: 0 })
      return
    }

    // 精确选择存在冲突时，仅把冲突任务交给系统；其余合法选择继续固定。
    const conflictIds = directPreview.infeasible
      ? Array.from(new Set(directPreview.issues.flatMap(issue => issue.assignmentIds))).filter(id => event.affectedAssignmentIds.includes(id))
      : []
    const eventForRouting: PlanChangeEvent = {
      ...event,
      affectedAssignmentIds: conflictIds.length ? conflictIds : event.affectedAssignmentIds,
      metadata: {
        ...(event.metadata ?? {}),
        directValidationConflictIds: conflictIds,
        fixedAssignmentIds: conflictIds.length ? event.affectedAssignmentIds.filter(id => !conflictIds.includes(id)) : [],
      },
    }

    // 首屏只计算一个推荐方案；其他策略在用户点击“生成更多不同方案”时按需加载。
    // 这样批量录入和常规调整都能先快速得到一个可执行结果。
    const initialPreferences = [policy.primaryPreference] as typeof policy.alternativePreferences
    const routedEvent = eventWithPreferences(eventForRouting, initialPreferences)
    const seedProposals = useDirectFirst || directPreview.infeasible ? [directPreview] : []

    const complete = (generated: SchedulingProposal[]) => {
      const intakeBatchId = typeof event.metadata?.intakeBatchId === 'string' ? event.metadata.intakeBatchId : undefined
      if (intakeBatchId) updateIntakeBatch(intakeBatchId, { status: 'pending' })
      const merged = [...seedProposals]
      const signatures = new Set(merged.map(item => item.distinctSignature))
      for (const proposal of generated) if (!signatures.has(proposal.distinctSignature)) {
        signatures.add(proposal.distinctSignature)
        merged.push(proposal)
      }
      if (tutorialRestricted && merged.length === 0) merged.push(directPreview)
      setProposalSession({ baseline, prepared, event: routedEvent, policy, proposals: merged, expansionLevel: 0, calculationRevision: 0 })
    }

    if (tutorialRestricted || typeof Worker === 'undefined') {
      complete(generateProposals(prepared, routedEvent, baseline))
      return
    }
    const worker = new Worker(new URL('./workers/proposal.worker.ts', import.meta.url), { type: 'module' })
    const intakeBatchId = typeof event.metadata?.intakeBatchId === 'string' ? event.metadata.intakeBatchId : undefined
    if (intakeBatchId) updateIntakeBatch(intakeBatchId, { status: 'calculating' })
    setProposalGeneration({ baseline, prepared, event: routedEvent, policy, seedProposals, worker })
    worker.onmessage = (message: MessageEvent<{ ok: boolean; proposals?: SchedulingProposal[]; message?: string }>) => {
      worker.terminate()
      if (message.data.ok) {
        setProposalGeneration(undefined)
        complete(message.data.proposals ?? [])
      } else {
        if (intakeBatchId) updateIntakeBatch(intakeBatchId, { status: 'pending' })
        setProposalGeneration({ baseline, prepared, event: routedEvent, policy, seedProposals, error: message.data.message ?? '方案计算失败' })
      }
    }
    worker.onerror = eventValue => {
      worker.terminate()
      if (intakeBatchId) updateIntakeBatch(intakeBatchId, { status: 'pending' })
      setProposalGeneration({ baseline, prepared, event: routedEvent, policy, seedProposals, error: eventValue.message || '方案计算失败' })
    }
    worker.postMessage({ preparedState: prepared, baseline, event: routedEvent })
  }
  const cancelProposalGeneration = () => {
    proposalGeneration?.worker?.terminate()
    const intakeBatchId = typeof proposalGeneration?.event.metadata?.intakeBatchId === 'string' ? proposalGeneration.event.metadata.intakeBatchId : undefined
    if (intakeBatchId) updateIntakeBatch(intakeBatchId, { status: 'pending' })
    setProposalGeneration(undefined)
  }

  const applyCurrentReviewPlan = (prepared: AppState, event: PlanChangeEvent) => {
    const tutorial = tutorialSessionRef.current
    if (tutorial?.step === 'review-carry') {
      openPrepared(prepared, event)
      return
    }
    const baseline = stateRef.current
    const policy = adjustmentPolicyForEvent(event)
    const directPreview = previewPreparedChange(baseline, prepared, event, policy.directPreviewLabel)
    if (!directPreview.infeasible) {
      applyPreparedWithoutScheduling(prepared, event, `完成复盘并按当前方案顺延 ${directPreview.movements.length} 项`)
      setActionNotice(`已完成复盘并顺延 ${directPreview.movements.length} 项任务`)
      return
    }
    // 复盘中用户已逐项决定日期。发现冲突时只打开精确冲突预览，
    // 不自动耗时生成其他方案；用户仍可在页面中主动“生成更多不同方案”。
    setProposalSession({ baseline, prepared, event, policy, proposals: [directPreview], expansionLevel: 0, calculationRevision: 0 })
  }

  const openMoreReviewPlans = (prepared: AppState, event: PlanChangeEvent) => {
    openPrepared(prepared, event, { forceAlternatives: true })
  }

  const openAddTask = (date?: string, intent: SchedulingIntent = date ? 'prefer-date' : 'system', intakeBatchId?: string) => {
    const tutorial = tutorialSessionRef.current
    if (tutorial && tutorial.step !== 'free') { tutorialNotice(); return }
    setAddTaskContext({ date, intent, intakeBatchId })
    setAddTaskOpen(true)
  }

  const selectTaskCreation = (mode: TaskCreationMode, kind: TaskCreationKind) => {
    setAddTaskOpen(false)
    if (mode === 'intake') {
      setIntakeAddRequest({ id: uid('intake-add'), kind, batchId: addTaskContext.intakeBatchId })
      navigate('intake')
      return
    }
    if (kind === 'single') {
      setSingleTaskDate(addTaskContext.date)
      setSingleTaskIntent(addTaskContext.intent)
      setSingleTaskOpen(true)
    } else {
      setGroupDialogOpen(true)
    }
  }

  const pendingIntakeCount = state.intakeBatches.reduce((sum, batch) => sum + (batch.status === 'archived' ? 0 : batch.taskGroups.filter(item => !item.appliedAt).length), 0)

  const tutorialRestricted = Boolean(tutorialActive && tutorialStepValue && tutorialStepValue !== 'free')
  let tutorialCoachConfig: TutorialCoachmarkConfig | undefined
  if (tutorialRestricted && tutorialStepValue) {
    const base: Partial<Record<TutorialStep, TutorialCoachmarkConfig>> = {
      'repair-entry': { target: 'replan-center', text: '这份教程计划故意有逾期、超载和目标风险。先打开重排中心。' },
      'repair-action': { target: 'repair-submit|repair-current', text: '选择“修复当前计划问题”，然后生成方案。' },
      'repair-preview': { target: 'proposal-primary', text: '先看它会改什么；已完成和锁定任务不会随便动。确认应用。' },
      goal: { target: 'tutorial-goal', text: '排期会考虑目标和截止时间，不只是把任务塞进日历。', actionLabel: '继续：加入新任务', onAction: () => { void enterTutorialIntake() } },
      intake: { target: 'schedule-intake', text: '新任务已录入，但还没进正式计划。生成排期预览。' },
      'intake-preview': { target: 'proposal-primary', text: '确认后，新任务才会进入今日和月历。' },
      execute: { target: 'tutorial-complete-confirm|tutorial-execute', text: '按实际情况完成高亮任务。' },
      'review-entry': { target: 'today-review', text: '今天还有未完成内容，结束今天并复盘。' },
      'review-carry': { target: 'review-carry', text: '没做完的不用重新录入；系统已经选好可行日期，确认顺延。' },
      'review-preview': { target: 'proposal-primary', text: '先预览未完成任务会移到哪里，再确认。' },
      'future-entry': { target: 'replan-center', text: '当前问题处理完了。再看看没有出问题时怎么主动重新安排未来。' },
      'future-action': { target: 'future-submit|future-replan', text: '选择“重新安排剩余计划”，用均衡方式重新规划未来。' },
      'future-preview': { target: 'proposal-primary', text: '这次是主动规划未来，不是修复故障。确认看看结果。' },
      complete: { text: '你已经走完一次完整计划循环：目标 → 排期 → 执行 → 复盘 → 调整。', actionLabel: '开始我的计划', onAction: () => { void exitTutorial(true) }, secondaryLabel: '继续看看', onSecondary: () => { const updated = advanceTutorialOnly('complete', 'free'); if (updated) setPage('today') } },
    }
    tutorialCoachConfig = base[tutorialStepValue]
  }


  if (!ready || !authResolved || !tutorialBootReady || dataSwitching) return <div className="loading-screen"><div className="spinner"/><p>{dataSwitching ? '正在安全切换数据空间……' : '正在载入学习计划……'}</p></div>

  if (page === 'timer') return <FocusTimerPage onExit={() => navigate('today')}/>

  return (
    <div className={`app-shell ${state.settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${mobileNav ? 'sidebar-mobile-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><CheckCircle2 size={22}/></div><div><strong>学习计划</strong><small>{state.settings.planName}</small></div></div>
        <nav>
          {navItems.map(item => {
            const Icon = item.icon
            const intakeLabel = item.id === 'intake' && pendingIntakeCount ? `${item.label}，${pendingIntakeCount} 项待安排内容` : item.label
            const tutorialDisabled = Boolean(tutorialSession && !tutorialAllowsPage(tutorialSession.step, item.id))
            return <button key={item.id} aria-label={intakeLabel} aria-disabled={tutorialDisabled || undefined} title={tutorialDisabled ? '教程中先完成当前步骤' : state.settings.sidebarCollapsed ? intakeLabel : undefined} className={`${page === item.id ? 'nav-active' : ''} ${tutorialDisabled ? 'tutorial-disabled-control' : ''}`.trim()} onClick={() => navigate(item.id)}><Icon size={19}/><span>{item.label}</span>{item.id === 'intake' && pendingIntakeCount > 0 && <em className="intake-nav-badge">{pendingIntakeCount > 99 ? '99+' : pendingIntakeCount}</em>}</button>
          })}
        </nav>
        <div className="sidebar-bottom">
          <a className="sidebar-repo-link" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" title={state.settings.sidebarCollapsed ? 'GitHub 仓库' : undefined}><Github size={18}/><span>GitHub 仓库</span><ArrowUpRight className="sidebar-repo-arrow" size={14}/></a>
          <div className={`sync-status ${sessionUser && !tutorialActive ? 'online' : ''} ${syncStatus === 'error' && !tutorialActive ? 'sync-error' : ''}`}>{tutorialActive || !sessionUser ? <CloudOff size={16}/> : <Cloud size={16}/>}<span>{tutorialActive ? '交互教程 · 独立本地空间' : !sessionUser ? '游客 · 仅本地保存' : syncStatus === 'restoring' ? '正在从云端恢复' : syncStatus === 'queued' ? '已保存到本机 · 等待云同步' : syncStatus === 'saving' ? '正在同步到云端' : syncStatus === 'error' ? '云同步失败' : cloudReady ? '已自动保存到云端' : '等待初始化个人计划'}</span></div>
          <button className={`collapse-button ${tutorialRestricted ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialRestricted || undefined} title={tutorialRestricted ? '教程中保持当前布局' : state.settings.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} aria-label={state.settings.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'} onClick={() => tutorialRestricted ? tutorialNotice('教程中暂时保持当前布局') : updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed })}><ChevronLeft size={18}/><span>{state.settings.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}</span></button>
        </div>
      </aside>
      {mobileNav && <button className="mobile-overlay" onClick={() => setMobileNav(false)} aria-label="关闭菜单"/>}
      <main ref={mainAreaRef} className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="打开菜单" onClick={() => setMobileNav(true)}><Menu size={21}/></button>
          <div className="page-heading"><h1>{navItems.find(n => n.id === page)?.label}</h1><span>{tutorialActive ? format(parseISO(effectiveToday), 'yyyy年M月d日') : format(new Date(), 'yyyy年M月d日')}</span></div>
          <div className="topbar-actions"><ActiveTimerReturnButton onOpen={() => tutorialRestricted ? tutorialNotice('教程中先完成当前步骤，再进入专注计时') : navigate('timer')}/><button data-tutorial-target={tutorialRestricted && (tutorialStepValue === 'repair-entry' || tutorialStepValue === 'future-entry') ? 'replan-center' : undefined} aria-disabled={tutorialRestricted && tutorialStepValue !== 'repair-entry' && tutorialStepValue !== 'future-entry' ? true : undefined} className={`secondary-button ${tutorialRestricted && tutorialStepValue !== 'repair-entry' && tutorialStepValue !== 'future-entry' ? 'tutorial-disabled-control' : ''}`} aria-label={currentIssueCount ? `计划有 ${currentIssueCount} 个问题，打开处理` : '打开计划变化入口'} onClick={() => openAdjustment()}><RefreshCw size={16}/><span>{currentIssueCount ? `${currentIssueCount} 个问题需处理` : '计划有变化'}</span></button>{tutorialActive && tutorialStepValue === 'free' && <button className="secondary-button" onClick={() => void exitTutorial(false)}>返回我的计划</button>}</div>
        </header>
        {tutorialActive && tutorialCoachConfig && tutorialStepValue && <TutorialCoachmark step={tutorialStepValue} config={tutorialCoachConfig} onRestart={() => { void restartTutorial() }} onExit={() => { void exitTutorial(false) }}/>}
        <div className="page-content">
          {page === 'today' && <TodayPage onNavigate={navigate} onPrepared={openPrepared} onAddTask={date => openAddTask(date, 'prefer-date')} onReview={openReview} todayOverride={tutorialSession?.anchorDate} tutorialMode={tutorialRestricted} tutorialStep={tutorialStepValue} tutorialTargetId={TUTORIAL_EXECUTE_ASSIGNMENT_ID} onTutorialTaskRecorded={() => { advanceTutorialStable('execute', 'review-entry') }} onTutorialBlocked={tutorialNotice}/>}
          {page === 'calendar' && <CalendarPage onPrepared={openPrepared} onOpenAdjustment={date => openAdjustment(date, 'current-conflicts')} onAddTask={date => openAddTask(date, 'prefer-date')}/>}
          {page === 'tasks' && <TasksPage onOpenIntake={() => navigate('intake')} onPrepared={openPrepared}/>}
          {page === 'intake' && <IntakePage onPrepared={openPrepared} onNavigate={target => navigate(target)} onAddTask={batchId => openAddTask(undefined, 'system', batchId)} addRequest={intakeAddRequest} onAddRequestHandled={() => setIntakeAddRequest(undefined)} tutorialMode={tutorialStepValue === 'intake'} onStartTutorial={() => { void startTutorial() }} onTutorialBlocked={tutorialNotice}/>}
          {page === 'goals' && <GoalsPage onPrepared={openPrepared} tutorialMode={tutorialStepValue === 'goal'} onTutorialBlocked={tutorialNotice}/>}
          {page === 'stats' && <Suspense fallback={<div className="page-loading"><div className="spinner"/><p>正在载入统计图表……</p></div>}><StatsPage onOpenReplan={date => openAdjustment(date, 'current-conflicts')}/></Suspense>}
          {page === 'export' && <ExportPage onNavigate={target => navigate(target)}/>}
          {page === 'guide' && <GuidePage onNavigate={target => navigate(target)}/>}
          {page === 'settings' && <SettingsPage sessionUserId={sessionUser?.id} sessionEmail={sessionUser?.email} cloudMessage={cloudMessage} onCloudUpload={uploadCloudNow} onPrepared={openPrepared} onStartTutorial={() => { void startTutorial() }}/>}
        </div>
      </main>
      <AddTaskDialog open={addTaskOpen} onClose={() => setAddTaskOpen(false)} onSelect={selectTaskCreation}/>
      <SingleTaskDialog open={singleTaskOpen} state={state} defaultDate={singleTaskDate} defaultIntent={singleTaskIntent} creationMode="schedule" onClose={() => setSingleTaskOpen(false)} onSubmit={draft => {
        const prepared = prepareSingleAssignment(draft)
        setSingleTaskOpen(false)
        openPrepared(prepared.state, prepared.event)
      }}/>
      <TaskGroupDialog open={groupDialogOpen} state={state} defaultDate={addTaskContext.date} onClose={() => setGroupDialogOpen(false)} onCreate={draft => {
        const prepared = prepareTaskGroup(draft)
        setGroupDialogOpen(false)
        openPrepared(prepared.state, prepared.event)
      }}/>
      {proposalGeneration && <Modal open title="正在生成计划调整方案" onClose={cancelProposalGeneration}>
        <div className="proposal-generation-state"><div className={proposalGeneration.error ? 'proposal-generation-error' : 'spinner'}/><h3>{proposalGeneration.error ? '方案计算未完成' : proposalGeneration.event.title}</h3><p>{proposalGeneration.error ?? '正在独立线程中核对容量、上限、目标期限、手动安排和日期保护。取消不会修改当前计划。'}</p></div>
        <div className="modal-actions"><button className="secondary-button" onClick={cancelProposalGeneration}>{proposalGeneration.error ? '关闭' : '取消计算'}</button>{proposalGeneration.error && <button className="primary-button" onClick={() => { const { prepared, event, baseline, policy, seedProposals } = proposalGeneration; setProposalGeneration(undefined); const proposals = generateProposals(prepared, event, baseline); setProposalSession({ baseline, prepared, event, policy, proposals: [...seedProposals, ...proposals.filter(item => !seedProposals.some(seed => seed.distinctSignature === item.distinctSignature))], expansionLevel: 0, calculationRevision: 0 }) }}>在当前线程重试</button>}</div>
      </Modal>}
      {proposalSession && <ProposalDialog
        open baseline={proposalSession.baseline} preparedState={proposalSession.prepared} event={proposalSession.event}
        proposals={proposalSession.proposals} policy={proposalSession.policy} calculationRevision={proposalSession.calculationRevision} decisionSummary={proposalSession.decisionSummary} moreExhausted={proposalSession.moreExhausted} tutorialMode={tutorialRestricted} onTutorialBlocked={tutorialNotice}
        onClose={() => {
          const step = tutorialSessionRef.current?.step
          setProposalSession(undefined)
          if (step === 'repair-preview') void recoverTutorialTo('repair-entry')
          else if (step === 'intake-preview') void recoverTutorialTo('intake')
          else if (step === 'review-preview') void recoverTutorialTo('review-entry')
          else if (step === 'future-preview') void recoverTutorialTo('future-entry')
        }}
        onKeep={() => {
          const type = proposalSession.event.type
          const reviewDate = typeof proposalSession.event.metadata?.reviewDate === 'string' ? proposalSession.event.metadata.reviewDate : undefined
          if (reviewDate && proposalSession.event.metadata?.containsReviewRecord) {
            const isDurationEstimateChange = type === 'rule-change' && proposalSession.event.metadata?.currentEstimate != null
            if (isDurationEstimateChange) {
              // The Review already asked the user to accept the new estimate. “Keep dates” must
              // apply that estimate plus the Review record, not silently discard the accepted change.
              applyPreparedWithoutScheduling(proposalSession.prepared, proposalSession.event, '只应用新预计，日期保持不变')
            } else completeReview(reviewDate)
            setProposalSession(undefined)
            return
          }
          if (type === 'bulk-move' || type === 'execution-difference' || type === 'load-preference-change' || type === 'future-replanning') {
            setProposalSession(undefined)
            return
          }
          applyPreparedWithoutScheduling(proposalSession.prepared, proposalSession.event, '保留本次基础变化，不调整现有日期')
          setProposalSession(undefined)
        }}
        onGenerateMore={() => {
          setProposalSession(current => {
            if (!current || current.moreExhausted) return current
            const allPreferences = [current.policy.primaryPreference, ...current.policy.alternativePreferences]
            const generatedPreferences = new Set(current.proposals.map(item => item.preference))
            const remainingPreferences = allPreferences.filter(item => !generatedPreferences.has(item))
            const nextLevel = remainingPreferences.length ? current.expansionLevel : Math.min(2, current.expansionLevel + 1)
            const preferences = remainingPreferences.length ? remainingPreferences : allPreferences
            const localOperation = current.event.metadata?.explicitLocalOperation === true
            const expansionBaseEvent: PlanChangeEvent = localOperation
              ? { ...current.event, action: 'optimize', metadata: { ...(current.event.metadata ?? {}), operationScope: 'broader-future-plan', broaderOptimizationRequested: true } }
              : current.event
            const expandedEvent = eventWithPreferences(expansionBaseEvent, preferences)
            const extra = generateProposals(current.prepared, expandedEvent, current.baseline, undefined, nextLevel, {
              acceptedExceptions: current.acceptedExceptions,
              disableAutomaticExceptions: Boolean(current.acceptedExceptions),
            })
            const merged = [...current.proposals]
            const signatures = new Set(merged.map(item => item.distinctSignature))
            for (const proposal of extra) if (!signatures.has(proposal.distinctSignature)) { signatures.add(proposal.distinctSignature); merged.push(proposal) }
            const added = merged.length - current.proposals.length
            return { ...current, event: expandedEvent, proposals: merged, expansionLevel: nextLevel, moreExhausted: added === 0 && nextLevel >= 2 && remainingPreferences.length === 0 }
          })
        }}
        onResolveConflicts={(proposal, decisions, exceptionDecisions) => {
          const applied = applyConflictDecisions(proposalSession.baseline, proposalSession.prepared, proposal, proposalSession.event, decisions, exceptionDecisions)
          const acceptedExceptions = mergeConstraintExceptions(applied.acceptedExceptions)
          const preferences = Array.from(new Set([proposal.preference, proposalSession.policy.primaryPreference, ...proposalSession.policy.alternativePreferences.slice(0, 1)]))
          const routedEvent = eventWithPreferences(applied.event, preferences)
          const recalculated = generateProposals(applied.preparedState, routedEvent, proposalSession.baseline, undefined, proposalSession.expansionLevel, {
            acceptedExceptions,
            disableAutomaticExceptions: true,
          })
          const fallback = previewPreparedChange(
            proposalSession.baseline,
            applied.preparedState,
            routedEvent,
            '按你的冲突决定重新校验',
            acceptedExceptions,
          )
          const merged = [...recalculated]
          if (!merged.some(item => item.distinctSignature === fallback.distinctSignature)) merged.unshift(fallback)
          setProposalSession(current => current ? {
            ...current,
            prepared: applied.preparedState,
            event: routedEvent,
            proposals: merged.length ? merged : [fallback],
            acceptedExceptions,
            calculationRevision: current.calculationRevision + 1,
            decisionSummary: `已处理 ${decisions.length + exceptionDecisions.length} 项决定，其中接受 ${acceptedExceptions.length} 项一次性例外；未接受的条件继续按原规则约束。`,
            moreExhausted: false,
          } : current)
        }}
        onRequestExternalChange={action => {
          setProposalSession(undefined)
          navigate(action === 'change-goal' ? 'goals' : 'settings')
        }}
        onApply={proposal => {
          const step = tutorialSessionRef.current?.step
          if (step === 'repair-preview') { void applyTutorialProposal(proposal, 'repair-preview', 'goal'); return }
          if (step === 'intake-preview') { void applyTutorialProposal(proposal, 'intake-preview', 'execute'); return }
          if (step === 'review-preview') { void applyTutorialProposal(proposal, 'review-preview', 'future-entry'); return }
          if (step === 'future-preview') { void applyTutorialProposal(proposal, 'future-preview', 'complete'); return }
          applySchedulingProposal(proposal, proposalSession.event)
          setActionNotice(`已应用“${proposal.title}”，移动 ${proposal.metrics.movedTaskCount} 项任务`)
          setProposalSession(undefined)
        }}
      />} 
      <ReviewDialog
        open={Boolean(reviewDate)}
        date={reviewDate ?? effectiveToday}
        onClose={closeReview}
        onPreparedDuration={openPrepared}
        onApplyCurrentPlan={applyCurrentReviewPlan}
        onRequestMorePlans={openMoreReviewPlans}
        tutorialMode={tutorialStepValue === 'review-carry'}
        onTutorialBlocked={tutorialNotice}
      />
      <SequenceRenumberDialog
        suggestion={sequenceRenumberSuggestion}
        onKeep={dismissSequenceRenumberSuggestion}
        onApply={applySequenceRenumber}
      />
      <AdjustmentIntentDialog
        open={adjustmentOpen}
        state={state}
        initialDate={adjustmentDate}
        initialReason={adjustmentReason}
        onClose={closeAdjustment}
        onPrepared={(prepared, event) => { setAdjustmentOpen(false); openPrepared(prepared, event) }}
        onOpenIntake={() => openAddTask()}
        onOpenDeadline={() => tutorialRestricted ? tutorialNotice() : setDeadlineDialogOpen(true)}
        onOpenBulkMove={() => tutorialRestricted ? tutorialNotice() : setBulkMoveCenterOpen(true)}
        onDurationSuggestion={suggestion => { if (tutorialRestricted) { tutorialNotice(); return }; const prepared = prepareDurationChange(suggestion); openPrepared(prepared.state, prepared.event) }}
        tutorialMode={tutorialStepValue === 'repair-action' ? 'repair' : tutorialStepValue === 'future-action' ? 'future' : undefined}
        onTutorialBlocked={tutorialNotice}
      />
      <GoalDeadlineDialog
        open={deadlineDialogOpen}
        state={state}
        onClose={() => setDeadlineDialogOpen(false)}
        onPrepared={openPrepared}
        onOpenGoals={() => navigate('goals')}
      />
      <BulkMoveCenterDialog
        open={bulkMoveCenterOpen}
        state={state}
        onClose={() => setBulkMoveCenterOpen(false)}
        onPrepared={openPrepared}
      />
      {actionNotice && !tutorialRestricted && <div className="action-result-toast"><div><strong>{actionNotice}</strong><span>当前操作已保存；需要时可以立即撤销。</span></div><div><button className="secondary-button" disabled={!canUndo} onClick={() => { undo(); setActionNotice('已恢复上一步') }}>撤销</button><button className="text-button" onClick={() => setActionNotice(undefined)}>关闭</button></div></div>}
      <Modal open={firstLoginOpen} title="欢迎使用 · 选择个人计划起点" onClose={() => {}}>
        <p className="onboarding-copy">云端还没有你的计划。游客数据不会被静默上传；请选择个人账号的独立起点。</p>
        <div className="template-options">
          {guestImportAvailable && <button onClick={() => void initializeAccount('import')}><strong>导入已修改的游客计划</strong><span>复制任务、任务组、目标、日期约束和当前执行状态；游客空间仍独立保留。</span></button>}
          <button onClick={() => void startTutorial()}><strong>体验完整流程（推荐）</strong><span>在独立教程空间里亲手完成修复、目标、录入、执行、复盘和未来重排；不会写入账号计划。</span></button>
          <button onClick={() => void initializeAccount('blank')}><strong>直接从空白开始</strong><span>创建新的账号计划；游客数据仍独立保留在本机。</span></button>
        </div>
      </Modal>
      {tutorialBlockedNotice && <div className="tutorial-blocked-notice" role="status">{tutorialBlockedNotice}</div>}
      <Analytics />
    </div>
  )
}


function SequenceRenumberDialog({
  suggestion,
  onKeep,
  onApply
}: {
  suggestion?: SequenceRenumberSuggestion
  onKeep: () => void
  onApply: (groupIds?: string[]) => void
}) {
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [detailsOpen, setDetailsOpen] = useState(false)

  useEffect(() => {
    setSelectedGroupIds(suggestion?.groups.map(group => group.groupId) ?? [])
    setDetailsOpen(false)
  }, [suggestion])

  const sourceLabel = suggestion?.source === 'automatic'
    ? '后续自动调整后'
    : suggestion?.source === 'mixed'
      ? '本次调整后'
      : '手动调整后'

  return <>
    {suggestion && <div className="sequence-renumber-toast"><div><strong>有 {suggestion.groups.length} 个任务组的编号顺序可以整理</strong><span>任务和日期已经保存；这只是可选的标题编号整理，不会阻止你继续操作。</span></div><div className="button-wrap"><button className="secondary-button" onClick={onKeep}>保留原编号</button><button className="primary-button" onClick={() => setDetailsOpen(true)}>查看编号建议</button></div></div>}
    <Modal open={Boolean(suggestion && detailsOpen)} title="任务编号顺序发生变化" onClose={() => setDetailsOpen(false)} wide mobileFullscreen>
    {suggestion && <>
      <p className="onboarding-copy">
        {sourceLabel}，系统发现部分同组任务的日期顺序与编号顺序不一致。重新编号只修改编号和标题，不会移动任务，也不会改变进度、计时、备注或锁定状态。
      </p>
      <div className="sequence-renumber-list">
        {suggestion.groups.map(group => {
          const selected = selectedGroupIds.includes(group.groupId)
          return <section className={`sequence-renumber-group ${selected ? 'selected' : ''}`} key={group.groupId}>
            <label className="sequence-renumber-head">
              <input
                type="checkbox"
                checked={selected}
                onChange={event => setSelectedGroupIds(current => event.target.checked
                  ? [...new Set([...current, group.groupId])]
                  : current.filter(id => id !== group.groupId))}
              />
              <span><strong>{group.groupTitle}</strong><small>{group.assignmentCount} 项任务 · {group.changes.length} 项编号会变化</small></span>
            </label>
            <div className="sequence-renumber-changes">
              {group.changes.slice(0, 8).map(change => <div key={change.assignmentId}>
                <span>{change.scheduledDate ? fmtDate(change.scheduledDate) : '未安排'}</span>
                <strong>{change.fromTitle}</strong>
                <em>→</em>
                <strong>{change.toTitle}</strong>
              </div>)}
              {group.changes.length > 8 && <small>另有 {group.changes.length - 8} 项将按当前日期顺序连续编号。</small>}
            </div>
          </section>
        })}
      </div>
      <p className="muted-text">同一天内保持当前编号先后；未安排任务排在已安排任务之后。你也可以只勾选需要重新编号的任务组。</p>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onKeep}>保留原编号</button>
        <button className="primary-button" disabled={selectedGroupIds.length === 0} onClick={() => onApply(selectedGroupIds)}>
          按日期重新编号{selectedGroupIds.length ? `（${selectedGroupIds.length}组）` : ''}
        </button>
      </div>
    </>}
    </Modal>
  </>
}

function ActiveTimerReturnButton({ onOpen }: { onOpen: () => void }) {
  const { state } = useApp()
  const [tick, setTick] = useState(0)
  const assignment = state.assignments.find(item => item.id === state.timer.assignmentId)
  useEffect(() => {
    if (!state.timer.running) return
    const id = window.setInterval(() => setTick(value => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [state.timer.running])
  void tick
  if (!assignment) return null
  const seconds = getTimerElapsedSeconds(state.timer)
  const elapsed = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return <button className={`active-timer-return ${state.timer.running ? 'running' : 'paused'}`} onClick={onOpen}><Clock3 size={16}/><span><strong>{state.timer.running ? '正在计时' : '计时暂停'}</strong><small>{elapsed}</small></span></button>
}

function TodayPage({ onNavigate, onPrepared, onAddTask, onReview, todayOverride, tutorialMode = false, tutorialStep, tutorialTargetId, onTutorialTaskRecorded, onTutorialBlocked }: { onNavigate: (page: Page) => void; onPrepared: (state: AppState, event: PlanChangeEvent) => void; onAddTask: (date: string) => void; onReview: (date: string) => void; todayOverride?: string; tutorialMode?: boolean; tutorialStep?: TutorialStep; tutorialTargetId?: string; onTutorialTaskRecorded?: () => void; onTutorialBlocked?: (message?: string) => void }) {
  const { state, namespace, commit, captureDailyPlanBaseline, startTimer } = useApp()
  const rawToday = todayOverride ?? todayISO()
  const defaultDate = clampDate(rawToday, state.settings.startDate, state.settings.endDate)
  const [date, setDate] = useState(defaultDate)
  const [completeTarget, setCompleteTarget] = useState<Assignment>()
  const [completeDate, setCompleteDate] = useState<string>()
  const [actual, setActual] = useState('')
  const [progress, setProgress] = useState(100)
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shiftScope, setShiftScope] = useState<ShiftScope>('future')
  const [shiftDays, setShiftDays] = useState(1)
  const [reviewReminderDate, setReviewReminderDate] = useState<string>()
  const groups = useMemo(() => new Map(state.taskGroups.map(g => [g.id, g])), [state.taskGroups])
  const tasks = state.assignments.filter(a => a.scheduledDate === date).sort((a,b) => (groups.get(b.groupId)?.priority ?? 0) - (groups.get(a.groupId)?.priority ?? 0) || a.status.localeCompare(b.status))
  const activeTasks = tasks.filter(task => task.status !== 'done')
  const completedTasks = tasks.filter(task => task.status === 'done')
  const counted = tasks.filter(a => groups.get(a.groupId)?.countInStats || state.settings.countWordsTime)
  const dailyBaseline = state.dailyPlanBaselines.find(item => item.date === date)
  const originalPlanned = dailyBaseline
    ? dailyBaseline.assignments.reduce((sum, item) => sum + ((groups.get(item.groupId)?.countInStats || state.settings.countWordsTime) ? item.estimatedMinutes : 0), 0)
    : counted.reduce((sum, a) => sum + a.estimatedMinutes, 0)
  const remainingPlanned = counted.reduce((sum, a) => sum + effectiveMinutes(a), 0)
  const actualTotal = actualLearningSnapshot(state, date).actualMinutes
  const executionLoad = planningDayLoad(state, date)
  const done = tasks.filter(a => a.status === 'done').length
  const capacity = getCapacity(state, date)
  const config = getDayConfig(state, date)
  const isToday = date === rawToday
  const isPast = date < rawToday
  const dateContextLabel = isToday ? '今天' : isPast ? fmtDate(date) : fmtDate(date)
  const goalRisks = allGoalProgress(state).filter(item => item.latestRisk || item.desiredRisk)
  const firstRiskGoal = goalRisks.length ? state.goals.find(goal => goal.id === goalRisks[0].goalId) : undefined
  const risk = executionLoad > capacity
    ? `${dateContextLabel}已发生实际与剩余工作合计超过容量 ${minutesText(executionLoad - capacity)}`
    : firstRiskGoal ? `目标“${firstRiskGoal.title}”存在${goalRisks[0].latestRisk ? '最晚日期' : '期望日期'}风险` : undefined
  const pendingPastTasks = state.assignments.filter(item => item.status !== 'done' && item.scheduledDate && item.scheduledDate < rawToday && !groups.get(item.groupId)?.recurring)
  const resumableBatch = [...state.intakeBatches].reverse().find(batch => (batch.status === 'editing' || batch.status === 'pending' || batch.status === 'calculating') && batch.taskGroups.some(item => !item.appliedAt))
  const resumableBatchCount = resumableBatch?.taskGroups.filter(item => !item.appliedAt).length ?? 0
  useEffect(() => {
    if (rawToday < state.settings.startDate || rawToday > state.settings.endDate || state.dailyPlanBaselines.some(item => item.date === rawToday)) return
    captureDailyPlanBaseline(rawToday)
  }, [rawToday, state.settings.startDate, state.settings.endDate, state.dailyPlanBaselines, captureDailyPlanBaseline])
  useEffect(() => {
    if (!state.settings.optionalReview || tutorialMode || date !== rawToday || !tasks.length || !tasks.every(item => item.status === 'done') || state.reviewRecords.some(item => item.date === date)) return
    const key = `study-planner:auto-review:${namespace}:${date}`
    if (window.sessionStorage.getItem(key)) return
    window.sessionStorage.setItem(key, '1')
    onReview(date)
  }, [tasks.length, done, date, state.reviewRecords, state.settings.optionalReview, onReview, namespace])

  const shiftPreview = useMemo(() => {
    if (!shiftOpen) return { next: undefined, changes: [], ignoredLocked: 0, stayedAtEnd: 0, issues: [] }
    const next = cloneActiveState(state)
    const changes: Array<{ id: string; title: string; from: string; to: string }> = []
    let ignoredLocked = 0
    let stayedAtEnd = 0
    const days = Math.max(1, Math.min(14, Math.round(shiftDays || 1)))
    const movedAt = new Date().toISOString()
    for (const assignment of next.assignments) {
      const group = groups.get(assignment.groupId)
      if (!assignment.scheduledDate || assignment.status === 'done' || group?.recurring) continue
      const inScope = shiftScope === 'today' ? assignment.scheduledDate === date : assignment.scheduledDate >= date
      if (!inScope) continue
      if (assignment.locked || next.timer.assignmentId === assignment.id) { ignoredLocked += 1; continue }
      const from = assignment.scheduledDate
      const rawTarget = shiftDate(from, days)
      const to = rawTarget > next.settings.endDate ? next.settings.endDate : rawTarget
      if (to === from) { stayedAtEnd += 1; continue }
      assignment.previousDate = from
      assignment.scheduledDate = to
      assignment.lastManualMoveAt = movedAt
      assignment.scheduleSource = 'carryover'
      assignment.intentStrength = assignment.locked ? 'locked' : 'manual'
      changes.push({ id: assignment.id, title: assignment.title, from, to })
    }
    next.updatedAt = movedAt
    return {
      next,
      changes,
      ignoredLocked,
      stayedAtEnd,
      issues: analyzePlan(next, date).slice(0, 10)
    }
  }, [state, groups, date, shiftScope, shiftDays, shiftOpen])

  const applyShift = () => {
    if (!shiftPreview.next || !shiftPreview.changes.length) return
    const next = shiftPreview.next
    const now = new Date().toISOString()
    const affectedAssignmentIds = shiftPreview.changes.map(item => item.id)
    const affectedDates = Array.from(new Set(shiftPreview.changes.flatMap(item => [item.from, item.to]))).sort()
    const affectedGroupIds = Array.from(new Set(next.assignments.filter(item => affectedAssignmentIds.includes(item.id)).map(item => item.groupId)))
    const affectedGoalIds = next.goals.filter(goal => goal.linkedTaskGroupIds.some(id => affectedGroupIds.includes(id)) || goal.linkedAssignmentIds.some(id => affectedAssignmentIds.includes(id)) || goal.completionConditions.some(condition => affectedGroupIds.includes(condition.groupId))).map(goal => goal.id)
    const event: PlanChangeEvent = {
      id: uid('event'), type: 'bulk-move', action: 'repair',
      title: shiftScope === 'today' ? `顺延 ${fmtDate(date)} 的未完成任务` : `从 ${fmtDate(date)} 起批量顺延`,
      description: `用户希望将符合条件的任务顺延 ${Math.max(1, Math.min(14, Math.round(shiftDays || 1)))} 天。锁定任务、已完成任务和每日重复任务保持不变；系统会先验证并展示替代方案。`,
      affectedGoalIds, affectedGroupIds, affectedAssignmentIds, affectedDates, createdAt: now,
      metadata: { shiftScope, shiftDays: Math.max(1, Math.min(14, Math.round(shiftDays || 1))), preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
    }
    next.changeEvents = [...next.changeEvents, event].slice(-100)
    next.updatedAt = now
    setShiftOpen(false)
    onPrepared(next, event)
  }


  useEffect(() => {
    if (tutorialMode) return
    const current = rawToday
    if (current <= state.settings.startDate) return
    const reviewedDates = new Set(state.reviewRecords.map(record => record.date))
    const previousDate = state.assignments
      .filter(a => a.scheduledDate && a.scheduledDate < current && !groups.get(a.groupId)?.recurring && !reviewedDates.has(a.scheduledDate))
      .map(a => a.scheduledDate!)
      .sort()
      .at(-1)
    if (!previousDate) return
    const promptKey = `study-planner:carryover-prompt:${namespace}:${current}`
    if (window.sessionStorage.getItem(promptKey)) return
    window.sessionStorage.setItem(promptKey, '1')
    setReviewReminderDate(previousDate)
  }, [namespace, state.settings.startDate, state.assignments, state.reviewRecords, groups, tutorialMode, rawToday])

  const openComplete = (a: Assignment) => {
    if (tutorialMode && (tutorialStep !== 'execute' || a.id !== tutorialTargetId)) { onTutorialBlocked?.('教程中先完成高亮任务'); return }
    if (state.timer.assignmentId === a.id) { onNavigate('timer'); return }
    setCompleteTarget(a); setCompleteDate(date); setActual(tutorialMode && a.id === tutorialTargetId ? '52' : ''); setProgress(100)
  }

  const closeCompletion = () => {
    setCompleteTarget(undefined)
    setCompleteDate(undefined)
  }

  const saveCompletion = (finish: boolean) => {
    if (!completeTarget) return
    const minutes = Math.max(0, Number(actual) || 0)
    const viewedDate = completeDate ?? date
    const currentDate = rawToday
    const actualDate = viewedDate < currentDate ? viewedDate : currentDate
    const actualTimestamp = timestampForDate(actualDate)
    commit(draft => {
      const item = draft.assignments.find(a => a.id === completeTarget.id)
      if (!item) return
      const activeTimerMinutes = draft.timer.assignmentId === item.id ? Math.max(1, Math.round(getTimerElapsedSeconds(draft.timer) / 60)) : 0
      const minutesToRecord = minutes || activeTimerMinutes
      if (minutesToRecord) {
        item.actualMinutes += minutesToRecord
        item.timeEntries.push({ id: uid('time'), minutes: minutesToRecord, createdAt: actualTimestamp, source: activeTimerMinutes && !minutes ? 'timer' : 'manual' })
      }
      item.progress = finish ? 100 : Math.min(99, Math.max(1, progress))
      item.remainingMinutes = finish ? 0 : effectiveMinutes(item)
      item.status = finish ? 'done' : 'partial'
      item.completedAt = finish ? actualTimestamp : undefined
      if (draft.timer.assignmentId === item.id) draft.timer = { accumulatedSeconds: 0, running: false }
    }, tutorialMode ? { tutorialAction: 'execute-task', tutorialTargetId: completeTarget.id } : undefined)
    closeCompletion()
    if (tutorialMode && finish && completeTarget.id === tutorialTargetId) onTutorialTaskRecorded?.()
  }

  return <>
    <section className="today-hero">
      <div className="today-hero-main">
        <div className="date-switcher"><button className={`icon-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} aria-label="查看前一天" onClick={() => tutorialMode ? onTutorialBlocked?.('教程中日期固定为剧情当天') : setDate(clampDate(format(new Date(parseISO(date).getTime()-86400000),'yyyy-MM-dd'), state.settings.startDate,state.settings.endDate))}><ChevronLeft size={19}/></button><div><h2>{fmtDate(date, 'M月d日')} · {fmtWeekday(date)}</h2><span className={`day-badge day-${config.type}`}>{dayTypeLabel[config.type]}</span></div><button className={`icon-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} aria-label="查看后一天" onClick={() => tutorialMode ? onTutorialBlocked?.('教程中日期固定为剧情当天') : setDate(clampDate(format(new Date(parseISO(date).getTime()+86400000),'yyyy-MM-dd'), state.settings.startDate,state.settings.endDate))}><ChevronRight size={19}/></button></div>
        <p>{tasks.length
          ? `${isToday ? '今天' : isPast ? '当日' : '该日'}有 ${tasks.length} 项任务，已完成 ${done} 项，剩余预计 ${minutesText(remainingPlanned)}。`
          : isToday && resumableBatchCount
            ? `今天暂时没有已排期任务；另有 ${resumableBatchCount} 项录入内容等待排期。`
            : `${isToday ? '今天' : '该日'}暂时没有安排任务。`}</p>
      </div>
      <div className="button-wrap today-hero-actions"><button className={`primary-button subtle-action ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} onClick={() => tutorialMode ? onTutorialBlocked?.('教程中暂不新增额外任务') : onAddTask(date)}><Plus size={16}/>添加任务</button><button className={`secondary-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} onClick={() => tutorialMode ? onTutorialBlocked?.('教程中先完成当前步骤，再自由查看月历') : onNavigate('calendar')}><CalendarDays size={16}/>打开月历</button><button className={`secondary-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} onClick={()=>tutorialMode ? onTutorialBlocked?.('教程中暂不执行额外批量顺延') : setShiftOpen(true)}>批量顺延</button>{!(!isToday && !isPast) && <button className={`secondary-button today-review-button ${tutorialMode && tutorialStep === 'review-entry' ? 'tutorial-target' : ''} ${tutorialMode && tutorialStep !== 'review-entry' ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode && tutorialStep !== 'review-entry' ? true : undefined} data-tutorial-target={tutorialMode && tutorialStep === 'review-entry' ? 'today-review' : undefined} data-tutorial-action={tutorialMode && tutorialStep === 'review-entry' ? 'open-review' : undefined} onClick={() => tutorialMode && tutorialStep !== 'review-entry' ? onTutorialBlocked?.('完成高亮任务后再进行今日复盘') : onReview(date)}>{isToday ? '结束今天并复盘' : '复盘此日'}</button>}</div>
    </section>
    {!tutorialMode && resumableBatch && (tasks.length > 0 || state.assignments.length > 0) && <div className="intake-resume-banner"><div><Inbox size={19}/><span><strong>{resumableBatchCount} 项已录入、待排期</strong><small>确认排期后才会进入今日和月历。</small></span></div><button className="primary-button" onClick={() => onNavigate('intake')}>去排期</button></div>}
    {!tutorialMode && reviewReminderDate && <div className="review-reminder-banner"><div><strong>{fmtDate(reviewReminderDate)} 还有未完成的复盘</strong><span>这是轻量提醒，不会自动弹窗或反复打断。</span></div><div><button className="secondary-button" onClick={() => setReviewReminderDate(undefined)}>稍后</button><button className="primary-button" onClick={() => { setDate(reviewReminderDate); onReview(reviewReminderDate); setReviewReminderDate(undefined) }}>打开复盘</button></div></div>}
    {!tutorialMode && pendingPastTasks.length > 0 && <div className="review-reminder-banner pending-task-banner"><div><strong>{pendingPastTasks.length} 项过去未完成任务仍待处理</strong><span>包括复盘后暂不顺延和逾期任务，可到“任务 → 待处理”集中查看。</span></div><div><button className="primary-button" onClick={() => onNavigate('tasks')}>查看待处理任务</button></div></div>}
    <section className="compact-metrics today-load-metrics">
      <div><span>原计划</span><strong>{minutesText(originalPlanned)}</strong></div>
      <div><span>已发生实际</span><strong>{minutesText(actualTotal)}</strong></div>
      <div><span>剩余预计</span><strong>{minutesText(remainingPlanned)}</strong></div>
      <div className={executionLoad > capacity ? 'metric-over' : ''}><span>执行负载 / 容量</span><strong>{minutesText(executionLoad)} / {minutesText(capacity)}</strong></div>
    </section>
    <div className="load-metric-note" role="note"><Sparkles size={15}/><span><strong>怎么区分？</strong>原计划是最初估计；执行负载是实际/推断用时 + 未完成剩余预计，用来和当天容量比较。</span></div>
    {state.settings.showWarnings && risk && <div className="alert warning"><Sparkles size={18}/><div><strong>进度提醒</strong><span>{risk}</span></div></div>}
    {isToday && activeTasks[0] && <section className="today-next-focus"><div><span><Sparkles size={15}/>下一项建议</span><strong>{activeTasks[0].title}</strong><small>{groups.get(activeTasks[0].groupId)?.subject ?? '其他'} · 剩余约 {minutesText(effectiveMinutes(activeTasks[0]))}</small></div><button className={`primary-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} onClick={() => { if (tutorialMode) { onTutorialBlocked?.('教程中先按高亮步骤记录完成'); return }; startTimer(activeTasks[0].id); onNavigate('timer') }}><Clock3 size={16}/>开始专注</button></section>}
    <section className="section-block">
      <div className="section-title"><div><h2>{isToday ? '今日任务' : isPast ? `${fmtDate(date)} 的执行记录` : `${fmtDate(date)} 的计划任务`}</h2><p>{isPast ? '已完成记录保持不变；未完成任务可在待处理视图继续安排。' : '完成后勾选，可录入精确到 1 分钟的实际用时。'}</p></div></div>
      <div className="task-list">{tasks.length ? <>
        {activeTasks.map(a => <TaskCard key={a.id} assignment={a} group={groups.get(a.groupId)!} onComplete={openComplete} onOpenTimer={() => onNavigate('timer')} tutorialTarget={tutorialMode && tutorialStep === 'execute' && a.id === tutorialTargetId} tutorialLocked={tutorialMode} tutorialDisabled={tutorialMode && !(tutorialStep === 'execute' && a.id === tutorialTargetId)} onTutorialBlocked={onTutorialBlocked}/>)}
        {completedTasks.length > 0 && <details className="completed-task-section"><summary>已完成 {completedTasks.length} 项<span>展开查看</span></summary><div>{completedTasks.map(a => <TaskCard key={a.id} assignment={a} group={groups.get(a.groupId)!} onComplete={openComplete} onOpenTimer={() => onNavigate('timer')} tutorialLocked={tutorialMode} tutorialDisabled={tutorialMode} onTutorialBlocked={onTutorialBlocked}/>)}</div></details>}
      </> : <div className="empty-state today-empty-actions"><CheckCircle2 size={30}/><h3>{isToday ? '今天没有已排期任务' : '该日没有任务'}</h3><p>{isToday && resumableBatchCount ? `还有 ${resumableBatchCount} 项任务待排期。` : state.assignments.length ? '可以到月历调整计划，或设置这一天的可用时间。' : '先把手里的任务录入系统，再统一生成第一份计划。'}</p>{!state.assignments.length && <button className="primary-button" onClick={() => onNavigate('intake')}><Inbox size={16}/>{resumableBatchCount ? '去排期' : '开始录入任务'}</button>}</div>}</div>
    </section>
    <Modal open={Boolean(completeTarget)} title={completeTarget ? `记录：${completeTarget.title}` : '记录任务'} onClose={closeCompletion}>
      <div className="form-stack">
        <p className="muted-text">{completeDate && completeDate < rawToday ? `历史补录：实际用时将计入 ${fmtDate(completeDate)}` : '实际用时将计入今天'}</p>
        <label className="field"><span>{tutorialMode ? '本次实际用时（分钟，教程可填 1–65）' : '本次实际用时（分钟，可留空）'}</span><NumericInput min={tutorialMode ? 1 : 0} max={tutorialMode ? 65 : 1440} step={1} value={actual === '' ? undefined : Number(actual)} onValueChange={value => setActual(String(value))} onEmpty={() => setActual('')} autoFocus={!tutorialMode}/></label>
        {!tutorialMode && <label className="field"><span>若未完成，填写当前进度</span><NumericInput min={1} max={99} value={progress} onValueChange={setProgress}/></label>}
      </div>
      <div className="modal-actions"><button className={`secondary-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={tutorialMode || undefined} onClick={() => tutorialMode ? onTutorialBlocked?.('教程这一步先记录一次完整完成') : saveCompletion(false)}>保存为部分完成</button><button className={`primary-button ${tutorialMode ? 'tutorial-target' : ''}`} data-tutorial-target={tutorialMode ? 'tutorial-complete-confirm' : undefined} data-tutorial-action={tutorialMode ? 'completion-primary' : undefined} disabled={tutorialMode && (!actual || Number(actual) < 1 || Number(actual) > 65)} onClick={() => saveCompletion(true)}>标记完成</button></div>
    </Modal>
    <Modal open={shiftOpen} title="批量顺延设置" onClose={()=>setShiftOpen(false)} wide mobileFullscreen>
      <p className="muted-text">先选择顺延范围和天数。这里展示即时估算，下一步的统一预览是唯一确认点；每日重复任务不会移动。</p>
      <div className="replan-controls">
        <div className="segmented-control">
          <button className={shiftScope==='today'?'active':''} onClick={()=>setShiftScope('today')}>仅今日未完成</button>
          <button className={shiftScope==='future'?'active':''} onClick={()=>setShiftScope('future')}>从今天起全部</button>
        </div>
        <label className="field compact-field"><span>顺延天数</span><NumericInput min={1} max={14} value={shiftDays} onValueChange={setShiftDays}/></label>
        <div className="lock-choice static"><Lock size={14}/>锁定任务始终不移动</div>
      </div>
      <div className="summary-grid replan-summary-grid">
        <div className="metric-card"><span>将移动</span><strong>{shiftPreview.changes.length}</strong><small>项任务</small></div>
        <div className="metric-card"><span>锁定未移动</span><strong>{shiftPreview.ignoredLocked}</strong><small>项</small></div>
        <div className="metric-card"><span>停留截止日</span><strong>{shiftPreview.stayedAtEnd}</strong><small>项</small></div>
        <div className="metric-card"><span>影响范围</span><strong>{shiftScope==='today'?'当天':'后续全部'}</strong><small>顺延 {shiftDays} 天</small></div>
      </div>
      <section className="replan-section">
        <div className="replan-section-title"><CalendarDays size={18}/><div><h3>变更预览</h3><p>只展示前 16 项；应用后仍可撤销。</p></div></div>
        <div className="carryover-list">{shiftPreview.changes.slice(0,16).map(change=><div className="carryover-row" key={change.id}><div><strong>{change.title}</strong><span>{change.from} → {change.to}</span></div></div>)}</div>
      </section>
      {shiftPreview.issues.length>0&&<section className="replan-section warning-section"><div className="replan-section-title"><Sparkles size={18}/><div><h3>应用后的影响</h3><p>系统只提示后果，不替你取消本次顺延。</p></div></div><div className="warning-list">{shiftPreview.issues.map((issue,index)=><div key={index} className={`warning-item issue-${issue.level}`}>{issue.message}</div>)}</div></section>}
      <div className="modal-actions"><button className="secondary-button" onClick={()=>setShiftOpen(false)}>取消</button><button className="primary-button" disabled={!shiftPreview.changes.length} onClick={applyShift}>生成完整预览</button></div>
    </Modal>
  </>
}

function CalendarPage({ onPrepared, onOpenAdjustment, onAddTask }: { onPrepared: (state: AppState, event: PlanChangeEvent) => void; onOpenAdjustment: (date: string) => void; onAddTask: (date: string) => void }) {
  const { state, commit, updateAssignment, updateDayConfig, moveAssignments, reopenAssignment, prepareAssignmentDelete, prepareDurationChange, prepareAssignmentGroupChange } = useApp()
  const initialCalendarDate = todayISO() >= state.settings.startDate && todayISO() <= state.settings.endDate ? todayISO() : state.settings.startDate
  const [month, setMonth] = useState(startOfMonth(parseISO(initialCalendarDate)))
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [weekStart, setWeekStart] = useState(() => shiftDate(initialCalendarDate, -getDay(parseISO(initialCalendarDate))))
  const [dayOpen, setDayOpen] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [overflowSelectedIds, setOverflowSelectedIds] = useState<string[]>([])
  const [overflowPanel, setOverflowPanel] = useState<{ date: string; top: number; left: number }>()
  const [taskOpenId, setTaskOpenId] = useState<string>()
  const [taskTitleDraft, setTaskTitleDraft] = useState('')
  const [taskDurationDraft, setTaskDurationDraft] = useState<number>()
  const [groupChangeTargetId, setGroupChangeTargetId] = useState<string>()
  const [moveNotice, setMoveNotice] = useState<{ id: string; title: string; date: string }>()
  const [bulkMoveDialog, setBulkMoveDialog] = useState<{ ids: string[]; target: string }>()
  const [pendingDayType, setPendingDayType] = useState<DayType>()
  const [pendingDayNote, setPendingDayNote] = useState('')
  const [pendingCustomMinutes, setPendingCustomMinutes] = useState<number>()
  const [pendingAvailabilityMode, setPendingAvailabilityMode] = useState<'default' | 'reduced' | 'rest'>('default')
  const [pendingAvailableMinutes, setPendingAvailableMinutes] = useState<number>(60)
  const [pendingBufferReason, setPendingBufferReason] = useState('')
  const [pendingBufferPreference, setPendingBufferPreference] = useState<BufferPreference>('preserve')
  const [dragAssignmentId, setDragAssignmentId] = useState<string>()
  const [dragTargetDate, setDragTargetDate] = useState<string>()
  const [calendarExportNotice, setCalendarExportNotice] = useState('')
  const [moveModeTaskId, setMoveModeTaskId] = useState<string>()
  const longPressActivated = useRef(false)
  const [calendarTaskLimit, setCalendarTaskLimit] = useState(() => window.innerWidth >= 1400 ? 4 : window.innerWidth >= 900 ? 3 : 2)
  const longPressTimer = useRef<number>()
  const groups = useMemo(() => new Map(state.taskGroups.map(group => [group.id, group])), [state.taskGroups])

  useEffect(() => {
    const item = taskOpenId ? state.assignments.find(assignment => assignment.id === taskOpenId) : undefined
    setTaskTitleDraft(item?.title ?? '')
    setTaskDurationDraft(item?.estimatedMinutes)
  }, [taskOpenId])

  useEffect(() => {
    const updateLimit = () => setCalendarTaskLimit(window.innerWidth >= 1400 ? 4 : window.innerWidth >= 900 ? 3 : 2)
    window.addEventListener('resize', updateLimit)
    return () => window.removeEventListener('resize', updateLimit)
  }, [])

  useEffect(() => {
    if (!overflowPanel) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.calendar-overflow-panel') || target?.closest('.calendar-more-button')) return
      setOverflowPanel(undefined)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [overflowPanel])
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const monthDays = dateRange(format(monthStart, 'yyyy-MM-dd'), format(monthEnd, 'yyyy-MM-dd'))
  const weekDays = dateRange(weekStart, shiftDate(weekStart, 6))
  const days = viewMode === 'month' ? monthDays : weekDays
  const blanks = viewMode === 'month' ? Array.from({ length: getDay(monthStart) }) : []
  const planInterval = { start: parseISO(state.settings.startDate), end: parseISO(state.settings.endDate) }

  const sortTasks = (items: Assignment[]) => [...items].sort((a, b) => {
    const runningA = state.timer.assignmentId === a.id && state.timer.running ? 1 : 0
    const runningB = state.timer.assignmentId === b.id && state.timer.running ? 1 : 0
    if (runningA !== runningB) return runningB - runningA
    const manualA = a.intentStrength === 'manual' ? 1 : 0
    const manualB = b.intentStrength === 'manual' ? 1 : 0
    if (manualA !== manualB) return manualB - manualA
    if (a.locked !== b.locked) return Number(b.locked) - Number(a.locked)
    const priorityA = groups.get(a.groupId)?.priority ?? 0
    const priorityB = groups.get(b.groupId)?.priority ?? 0
    if (priorityA !== priorityB) return priorityB - priorityA
    if (a.status === 'done' && b.status !== 'done') return 1
    if (a.status !== 'done' && b.status === 'done') return -1
    return effectiveMinutes(b) - effectiveMinutes(a)
  })

  const prepareCalendarDayChange = (date: string, prepared: AppState) => {
    const now = new Date().toISOString()
    const before = getDayConfig(state, date)
    const after = getDayConfig(prepared, date)
    const affectedAssignmentIds = prepared.assignments.filter(item => item.scheduledDate === date && item.status !== 'done').map(item => item.id)
    const affectedGroupIds = Array.from(new Set(prepared.assignments.filter(item => affectedAssignmentIds.includes(item.id)).map(item => item.groupId)))
    const affectedGoalIds = prepared.goals.filter(goal => goal.linkedTaskGroupIds.some(id => affectedGroupIds.includes(id)) || goal.linkedAssignmentIds.some(id => affectedAssignmentIds.includes(id)) || goal.completionConditions.some(condition => affectedGroupIds.includes(condition.groupId))).map(goal => goal.id)
    const availabilityBefore = getCapacity(state, date)
    const availabilityAfter = getCapacity(prepared, date)
    const protectionBefore = isDateProtected(state, date)
    const protectionAfter = isDateProtected(prepared, date)
    const tightening = availabilityAfter < availabilityBefore || (!protectionBefore && protectionAfter)
    const event: PlanChangeEvent = {
      id: uid('event'), type: 'availability-change', action: tightening ? 'repair' : 'optimize',
      title: tightening ? `处理 ${fmtDate(date)} 的可用时间减少` : `评估 ${fmtDate(date)} 新增的可用时间`,
      description: tightening
        ? `日期容量从 ${minutesText(availabilityBefore)} 调整为 ${minutesText(availabilityAfter)}；日期类型 ${dayTypeLabel[before.type]} → ${dayTypeLabel[after.type]}。系统会列出受影响任务和目标，并优先给出最少扰动修复方案。`
        : `日期容量从 ${minutesText(availabilityBefore)} 调整为 ${minutesText(availabilityAfter)}；日期类型 ${dayTypeLabel[before.type]} → ${dayTypeLabel[after.type]}。当前排期不会自动提前，系统会同时提供“保持原计划”和“利用新增空间减负”等可选方案。`,
      affectedGoalIds, affectedGroupIds, affectedAssignmentIds, affectedDates: [date], createdAt: now,
      metadata: {
        preferredPreferences: tightening
          ? [after.bufferPreference === 'goal' ? 'goal' : after.bufferPreference === 'spread' ? 'balanced' : 'preserve', 'balanced', 'goal', 'rest']
          : ['preserve', 'rest', 'balanced', 'goal'],
        availabilityBefore, availabilityAfter, protectionBefore, protectionAfter, availabilityRelaxed: !tightening,
      },
    }
    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    prepared.updatedAt = now
    onPrepared(prepared, event)
  }

  const tasksFor = (date: string) => sortTasks(state.assignments.filter(assignment => assignment.scheduledDate === date))
  const countedMinutes = (assignment: Assignment) => effectiveMinutes(assignment)
  const loadFor = (date: string) => planningDayLoad(state, date)

  const moveWithValidation = (assignmentId: string, targetDate: string) => {
    const assignment = state.assignments.find(item => item.id === assignmentId)
    const group = assignment && groups.get(assignment.groupId)
    if (!assignment || !group || assignment.scheduledDate === targetDate) return false
    if (assignment.status === 'done') { window.alert('已完成任务属于历史执行记录，不能直接移动。请先在任务详情中重新打开。'); return false }
    if (assignment.locked) { window.alert('该任务已锁定。请先明确解锁，再重新选择日期。'); return false }
    if (state.timer.assignmentId === assignment.id) { window.alert('该任务正在计时，当前不能移动。请先暂停或结束计时。'); return false }
    if (!targetDate || targetDate < state.settings.startDate || targetDate > state.settings.endDate) {
      window.alert('目标日期超出当前计划范围。')
      return false
    }

    const placementChecks = checkAssignmentPlacement(state, assignmentId, targetDate)
    const overrideable = (key: string) => key === 'capacity' || key.startsWith('group:') || key.startsWith('activity:') || key === 'long' || key === 'high-intensity' || key === 'date-protection' || key === 'protected-buffer' || key === 'today-closed' || key === 'today-extra'
    const nonOverrideable = placementChecks.filter(item => item.hard && !overrideable(item.key))
    if (nonOverrideable.length) {
      window.alert(nonOverrideable.map(item => item.label).join('；'))
      return false
    }

    const sourceProtected = Boolean(assignment.scheduledDate && isDateProtected(state, assignment.scheduledDate))
    const targetProtected = isDateProtected(state, targetDate)
    const hardOverrideable = placementChecks.filter(item => item.hard && overrideable(item.key))
    if (sourceProtected || targetProtected || hardOverrideable.length) {
      const prepared = cloneActiveState(state)
      const draftTask = prepared.assignments.find(item => item.id === assignment.id)
      if (!draftTask) return false
      const movedAt = new Date().toISOString()
      const oldDate = draftTask.scheduledDate
      draftTask.previousDate = oldDate
      draftTask.scheduledDate = targetDate
      draftTask.lastManualMoveAt = movedAt
      draftTask.scheduleSource = 'manual'
      draftTask.intentStrength = 'manual'
      draftTask.updatedAt = movedAt
      const affectedGoalIds = prepared.goals.filter(goal => goal.linkedAssignmentIds.includes(draftTask.id) || goal.linkedTaskGroupIds.includes(draftTask.groupId) || goal.completionConditions.some(condition => condition.groupId === draftTask.groupId)).map(goal => goal.id)
      const event: PlanChangeEvent = {
        id: uid('event'), type: 'bulk-move', action: 'repair', title: `移动任务：${draftTask.title}`,
        description: `用户希望把任务从 ${oldDate ?? '未安排'} 移到 ${targetDate}。当前涉及容量、每日上限、今天接收规则或日期保护，系统会把每个例外完整列出并要求逐项确认；不会把本次放宽保存为永久规则。`,
        affectedGoalIds, affectedGroupIds: [draftTask.groupId], affectedAssignmentIds: [draftTask.id],
        affectedDates: Array.from(new Set([oldDate, targetDate].filter((date): date is string => Boolean(date)))).sort(), createdAt: movedAt,
        metadata: { requestedDate: targetDate, manualMove: true, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
      }
      prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
      prepared.updatedAt = movedAt
      setTaskOpenId(undefined)
      onPrepared(prepared, event)
      return true
    }

    const targetLoad = loadFor(targetDate) - (assignment.scheduledDate === targetDate ? countedMinutes(assignment) : 0)
    const projected = targetLoad + countedMinutes(assignment)
    const capacity = getCapacity(state, targetDate)
    const risks: string[] = []
    const desiredDate = nearestRelevantGoalDate(state, assignment)
    if (desiredDate && targetDate > desiredDate) risks.push(`会越过相关目标期望日期 ${desiredDate}`)
    if (projected > capacity) risks.push(`将从 ${minutesText(targetLoad)} 增至 ${minutesText(projected)}，超过容量 ${minutesText(projected - capacity)}`)
    if (risks.length && !window.confirm(`移动“${assignment.title}”到 ${targetDate}？\n\n${risks.join('\n')}\n\n这是可恢复的小范围手动安排，不会修改目标或永久规则。`)) return false
    updateAssignment(assignmentId, { scheduledDate: targetDate })
    setMoveNotice({ id: assignmentId, title: assignment.title, date: targetDate })
    return true
  }

  const drop = (date: string, event: React.DragEvent) => {
    event.preventDefault()
    const id = event.dataTransfer.getData('text/assignment-id') || dragAssignmentId
    if (id) moveWithValidation(id, date)
    setDragAssignmentId(undefined)
    setDragTargetDate(undefined)
  }

  const beginDrag = (assignment: Assignment, event: React.DragEvent) => {
    window.clearTimeout(longPressTimer.current)
    event.stopPropagation()
    setDragAssignmentId(assignment.id)
    event.dataTransfer.setData('text/assignment-id', assignment.id)
    event.dataTransfer.effectAllowed = 'move'
  }

  const startLongPress = (assignmentId: string) => {
    const candidate = state.assignments.find(item => item.id === assignmentId)
    if (!candidate || candidate.locked) return
    window.clearTimeout(longPressTimer.current)
    longPressActivated.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressActivated.current = true
      setMoveModeTaskId(assignmentId)
      setTaskOpenId(undefined)
      setDayOpen(undefined)
      if (navigator.vibrate) navigator.vibrate(35)
    }, 460)
  }
  const cancelLongPress = () => window.clearTimeout(longPressTimer.current)
  const openTaskUnlessLongPressed = (assignmentId: string) => {
    if (longPressActivated.current) { longPressActivated.current = false; return }
    setTaskOpenId(assignmentId)
  }
  const chooseCalendarDate = (date: string) => {
    if (moveModeTaskId) {
      if (moveWithValidation(moveModeTaskId, date)) setMoveModeTaskId(undefined)
      return
    }
    setDayOpen(date)
    const current = getDayConfig(state, date)
    const constraint = constraintsForDate(state, date).slice().reverse().find(item => ['unavailable', 'reduced-capacity', 'special-capacity', 'protected-buffer'].includes(item.kind))
    setPendingDayType(current.type)
    setPendingDayNote(current.note ?? '')
    setPendingCustomMinutes(current.customMinutes)
    setPendingAvailabilityMode(constraint?.kind === 'unavailable' || current.type === 'travel' || current.availableMinutes === 0 ? 'rest' : constraint || current.isBufferDay ? 'reduced' : 'default')
    setPendingAvailableMinutes(constraint?.capacityMinutes ?? current.availableMinutes ?? 60)
    setPendingBufferReason(constraint?.reason ?? current.bufferReason ?? '')
    setPendingBufferPreference(constraint?.preference ?? current.bufferPreference ?? 'preserve')
  }
  const moveCalendarWindow = (direction: -1 | 1) => {
    if (viewMode === 'month') setMonth(addMonths(month, direction))
    else setWeekStart(previous => shiftDate(previous, direction * 7))
  }
  const currentCalendarMonth = format(month, 'yyyy-MM')
  const openCalendarPrint = () => {
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      setCalendarExportNotice('浏览器阻止了月历窗口，请允许本站打开新窗口后重试。')
      return
    }
    reportWindow.opener = null
    reportWindow.document.open()
    reportWindow.document.write(buildCalendarPrintHtml(state, currentCalendarMonth))
    reportWindow.document.close()
    reportWindow.focus()
    window.setTimeout(() => reportWindow.print(), 250)
    setCalendarExportNotice('月历已打开，请在打印窗口选择“另存为 PDF”。')
  }
  const downloadCalendarImage = () => {
    setCalendarExportNotice('正在生成当前月份 PNG……')
    void downloadSvgAsPng(`${safeExportName(state.settings.planName)}-${currentCalendarMonth}-calendar.png`, buildCalendarSvg(state, currentCalendarMonth))
      .then(() => setCalendarExportNotice('月历 PNG 已开始下载。'))
      .catch(error => setCalendarExportNotice(error instanceof Error ? error.message : '月历图片生成失败，请稍后重试。'))
  }
  const openOverflow = (date: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (window.innerWidth <= 760) { chooseCalendarDate(date); return }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const width = 380
    setOverflowSelectedIds([])
    setOverflowPanel({
      date,
      top: Math.max(12, Math.min(window.innerHeight - 470, rect.bottom + 8)),
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    })
  }

  const dayTasks = dayOpen ? tasksFor(dayOpen) : []
  const dayCfg = dayOpen ? getDayConfig(state, dayOpen) : undefined
  const taskOpen = taskOpenId ? state.assignments.find(item => item.id === taskOpenId) : undefined
  const taskOpenGroup = taskOpen ? groups.get(taskOpen.groupId) : undefined
  const taskOpenDurationSuggestion = taskOpen ? allDurationSuggestions(state).find(item => item.groupId === taskOpen.groupId) : undefined
  const saveTaskBasics = () => {
    if (!taskOpen) return
    const nextTitle = taskTitleDraft.trim() || taskOpen.title
    const nextDuration = Math.max(1, Math.round(taskDurationDraft ?? taskOpen.estimatedMinutes))
    const titleChanged = nextTitle !== taskOpen.title
    const durationChanged = nextDuration !== taskOpen.estimatedMinutes
    if (!titleChanged && !durationChanged) return
    if (!durationChanged) {
      commit(draft => { const item = draft.assignments.find(candidate => candidate.id === taskOpen.id); if (!item) return; item.title = nextTitle; item.titleCustomized = true; item.updatedAt = new Date().toISOString() })
      return
    }
    const prepared = cloneActiveState(state)
    const item = prepared.assignments.find(candidate => candidate.id === taskOpen.id)
    if (!item) return
    item.title = nextTitle
    item.titleCustomized = true
    item.estimatedMinutes = nextDuration
    item.durationCustomized = true
    item.manuallyEstimated = true
    item.updatedAt = new Date().toISOString()
    const event: PlanChangeEvent = {
      id: uid('event'), type: 'rule-change', action: 'repair', title: `修改任务预计时长：${nextTitle}`,
      description: `第一方案只把预计时长从 ${taskOpen.estimatedMinutes} 分钟改为 ${nextDuration} 分钟，日期保持不变。只有本次新增或恶化的问题才需要处理。`,
      affectedGoalIds: prepared.goals.filter(goal => goal.linkedAssignmentIds.includes(item.id) || goal.linkedTaskGroupIds.includes(item.groupId) || goal.completionConditions.some(condition => condition.groupId === item.groupId)).map(goal => goal.id),
      affectedGroupIds: [item.groupId], affectedAssignmentIds: [item.id], affectedDates: item.scheduledDate ? [item.scheduledDate] : [], createdAt: new Date().toISOString(),
      metadata: { explicitLocalOperation: true, operationScope: 'requested-change-only', requestedChangeLabel: `仅修改“${nextTitle}”的预计时长`, requestedChangeKind: 'assignment-duration' },
    }
    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    setTaskOpenId(undefined)
    onPrepared(prepared, event)
  }
  const groupChangeTarget = groupChangeTargetId ? state.taskGroups.find(group => group.id === groupChangeTargetId) : undefined
  const overflowTasks = overflowPanel ? tasksFor(overflowPanel.date).slice(calendarTaskLimit) : []

  const bulkMoveTo = (ids: string[], target: string) => {
    if (!target || !ids.length) return false
    if (target < state.settings.startDate || target > state.settings.endDate) { window.alert('目标日期超出当前计划范围。'); return false }
    const moving = state.assignments.filter(item => ids.includes(item.id) && item.status !== 'done' && !item.locked && item.id !== state.timer.assignmentId)
    if (!moving.length) { window.alert('所选任务中没有可移动项；已完成、锁定和正在计时任务不会移动。'); return false }
    const prepared = cloneActiveState(state)
    const now = new Date().toISOString()
    const affectedDates = new Set<string>([target])
    for (const source of moving) {
      const item = prepared.assignments.find(candidate => candidate.id === source.id)
      if (!item) continue
      if (item.scheduledDate) affectedDates.add(item.scheduledDate)
      item.previousDate = item.scheduledDate
      item.scheduledDate = target
      item.lastManualMoveAt = now
      item.scheduleSource = 'manual'
      item.intentStrength = 'manual'
      item.updatedAt = now
    }
    const affectedAssignmentIds = moving.map(item => item.id)
    const affectedGroupIds = Array.from(new Set(moving.map(item => item.groupId)))
    const affectedGoalIds = prepared.goals.filter(goal => goal.linkedTaskGroupIds.some(id => affectedGroupIds.includes(id)) || goal.linkedAssignmentIds.some(id => affectedAssignmentIds.includes(id)) || goal.completionConditions.some(condition => affectedGroupIds.includes(condition.groupId))).map(goal => goal.id)
    const event: PlanChangeEvent = {
      id: uid('event'), type: 'bulk-move', action: 'repair', title: `批量移动 ${moving.length} 项任务到 ${fmtDate(target)}`,
      description: '这是用户指定的批量移动草稿。系统会在应用前完整核验来源日、目标日、容量、每日上限、目标期限、保护日期和手动意图；不会直接强塞。',
      affectedGoalIds, affectedGroupIds, affectedAssignmentIds, affectedDates: Array.from(affectedDates).sort(), createdAt: now,
      metadata: { requestedDate: target, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
    }
    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    prepared.updatedAt = now
    setSelectedIds([])
    setOverflowSelectedIds([])
    onPrepared(prepared, event)
    return true
  }


  const bulkMove = (ids = selectedIds) => {
    const candidates = state.assignments.filter(item => ids.includes(item.id) && item.status !== 'done' && !item.locked && item.id !== state.timer.assignmentId)
    if (!candidates.length) { window.alert('所选任务中没有可移动项；已完成、锁定和正在计时任务不会移动。'); return }
    const sourceDates = candidates.flatMap(item => item.scheduledDate ? [item.scheduledDate] : [])
    const latestSource = sourceDates.sort().at(-1) ?? todayISO()
    const suggested = shiftDate(latestSource, 1)
    const target = suggested > state.settings.endDate ? state.settings.endDate : suggested < state.settings.startDate ? state.settings.startDate : suggested
    setBulkMoveDialog({ ids: candidates.map(item => item.id), target })
  }

  const shiftOverflowSelected = () => {
    if (!overflowSelectedIds.length || !overflowPanel) return
    const target = shiftDate(overflowPanel.date, 1)
    if (target > state.settings.endDate) { window.alert('这些任务已经在计划最后一天，无法继续顺延。'); return }
    bulkMoveTo(overflowSelectedIds, target)
  }

  const lockOverflowSelected = () => {
    if (!overflowSelectedIds.length) return
    commit(draft => {
      for (const assignment of draft.assignments) {
        if (!overflowSelectedIds.includes(assignment.id)) continue
        assignment.locked = true
        assignment.intentStrength = 'locked'
      }
    })
    setOverflowSelectedIds([])
  }

  const exactDayConstraint = dayOpen ? state.calendarConstraints.find(item => item.startDate === dayOpen && item.endDate === dayOpen && ['unavailable', 'reduced-capacity', 'special-capacity', 'protected-buffer'].includes(item.kind)) : undefined
  let dayPreviewState: AppState | undefined
  if (dayOpen && dayCfg) {
    dayPreviewState = cloneActiveState(state)
    const type = pendingDayType ?? dayCfg.type
    // 日期类型负责基础容量；临时不可用、降低容量和受保护缓冲统一写入 CalendarConstraint。
    dayPreviewState.dayConfigs[dayOpen] = {
      ...dayCfg,
      date: dayOpen,
      type,
      note: pendingDayNote.trim() || undefined,
      customMinutes: type === 'custom' ? pendingCustomMinutes ?? dayCfg.customMinutes ?? state.settings.regularMinutes : undefined,
      isBufferDay: undefined,
      availableMinutes: undefined,
      bufferReason: undefined,
      bufferPreference: undefined,
      bufferProtected: undefined,
      userSet: true,
    }
    if (exactDayConstraint) dayPreviewState.calendarConstraints = dayPreviewState.calendarConstraints.filter(item => item.id !== exactDayConstraint.id)
    const needsUnavailable = type === 'travel' || pendingAvailabilityMode === 'rest'
    const needsReduced = !needsUnavailable && pendingAvailabilityMode === 'reduced'
    if (needsUnavailable || needsReduced) {
      const now = new Date().toISOString()
      dayPreviewState.calendarConstraints.push({
        id: exactDayConstraint?.id ?? uid('constraint'), startDate: dayOpen, endDate: dayOpen,
        kind: needsUnavailable ? 'unavailable' : 'protected-buffer',
        capacityMinutes: needsUnavailable ? 0 : Math.max(0, pendingAvailableMinutes),
        protected: true,
        reason: pendingBufferReason.trim() || (needsUnavailable ? '当天不可用' : '手动降低当天容量'),
        preference: pendingBufferPreference,
        createdAt: exactDayConstraint?.createdAt ?? now, updatedAt: now,
      })
    }
  }


  return <>
     <section className="calendar-toolbar"><div><h2>{viewMode === 'month' ? format(month, 'yyyy年M月') : `${fmtDate(weekStart)}－${fmtDate(shiftDate(weekStart, 6))}`}</h2><p>月视图看全局，周视图处理任务。手机上长按任务后，再点击目标日期即可移动。</p></div><div className="calendar-toolbar-actions"><div className="segmented-control calendar-view-toggle"><button className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>月</button><button className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>周</button></div><button className="icon-button" onClick={() => moveCalendarWindow(-1)}><ChevronLeft size={19}/></button><button className="secondary-button" onClick={() => { const date = initialCalendarDate; setMonth(startOfMonth(parseISO(date))); setWeekStart(shiftDate(date, -getDay(parseISO(date)))) }}>今天附近</button><button className="icon-button" onClick={() => moveCalendarWindow(1)}><ChevronRight size={19}/></button></div></section>
     {viewMode === 'month' && <div className="calendar-export-bar"><div><strong>导出当前月份</strong><span>保存一份可分享的月历图片，或打印为 PDF。</span></div><div className="button-wrap"><button className="secondary-button" onClick={downloadCalendarImage}><Download size={16}/>PNG 图片</button><button className="secondary-button" onClick={openCalendarPrint}><Printer size={16}/>PDF</button></div></div>}
     {calendarExportNotice && <div className="export-notice calendar-export-notice" role="status"><CheckCircle2 size={17}/><span>{calendarExportNotice}</span></div>}
    {moveNotice && <div className="manual-move-notice"><div><strong>已记录你的手动安排</strong><span>「{moveNotice.title}」已移到 {moveNotice.date}，后续自动调整会优先保留，也不会近期拉回原日期。</span></div><div className="button-wrap"><button className="secondary-button" onClick={() => { updateAssignment(moveNotice.id, { locked: true }); setMoveNotice(undefined) }}><Lock size={15}/>同时锁定</button><button className="text-button" onClick={() => setMoveNotice(undefined)}>知道了</button></div></div>}
    {moveModeTaskId && <div className="calendar-move-mode"><div><strong>正在移动：{state.assignments.find(item => item.id === moveModeTaskId)?.title}</strong><span>点击月历或周视图中的目标日期。再次长按其他任务可更换对象。</span></div><button className="secondary-button" onClick={() => setMoveModeTaskId(undefined)}>取消移动</button></div>}
    <section className={`calendar-card ${viewMode === 'week' ? 'calendar-week-view' : 'calendar-month-view'}`}>
      {viewMode === 'month' ? <>
        <div className="weekday-row">{['日', '一', '二', '三', '四', '五', '六'].map(label => <div key={label}>周{label}</div>)}</div>
        <div className="calendar-grid">
          {blanks.map((_, index) => <div className="calendar-cell outside" key={`b${index}`}/>)}
          {days.map(date => {
            const inPlan = isWithinInterval(parseISO(date), planInterval)
            const tasks = tasksFor(date)
            const visibleTasks = tasks.slice(0, calendarTaskLimit)
            const load = loadFor(date)
            const capacity = inPlan ? getCapacity(state, date) : 0
            const ratio = capacity ? load / capacity : 0
            const config = inPlan ? getDayConfig(state, date) : undefined
            const dragged = dragAssignmentId ? state.assignments.find(item => item.id === dragAssignmentId) : undefined
            const projected = dragged ? load + (dragged.scheduledDate === date ? 0 : countedMinutes(dragged)) : load
            return <div
              key={date}
              className={`calendar-cell ${!inPlan ? 'outside' : ''} ${config ? `day-${config.type}` : ''} ${config?.isBufferDay ? 'day-buffer' : ''} ${ratio > 1 ? 'load-over' : ratio > .8 ? 'load-near' : ''} ${dragTargetDate === date ? 'calendar-drag-target' : ''} ${moveModeTaskId ? 'calendar-date-selectable' : ''}`}
              onDragOver={event => { if (!inPlan) return; event.preventDefault(); setDragTargetDate(date) }}
              onDrop={event => inPlan && drop(date, event)}
              onClick={() => inPlan && chooseCalendarDate(date)}
            >
              <div className="calendar-date"><span>{Number(date.slice(-2))}</span>{config && <small>{config.isBufferDay ? `缓冲 · ${minutesText(config.availableMinutes ?? capacity)}` : dayTypeLabel[config.type]}</small>}</div>
              {inPlan && <div className="load-line"><i style={{ width: `${Math.min(100, ratio * 100)}%` }}/></div>}
              <div className="calendar-tasks">
                {visibleTasks.map(assignment => <div
                  key={assignment.id}
                  draggable={!assignment.locked}
                  onDragStart={event => beginDrag(assignment, event)}
                  onDragEnd={() => { setDragAssignmentId(undefined); setDragTargetDate(undefined) }}
                  onPointerDown={() => startLongPress(assignment.id)}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onPointerMove={cancelLongPress}
                  onClick={event => { event.stopPropagation(); openTaskUnlessLongPressed(assignment.id) }}
                  className={assignment.status === 'done' ? 'mini-done' : ''}
                ><span className={`subject-dot subject-${groups.get(assignment.groupId)?.subject}`}/><span>{assignment.title}</span><em>{minutesText(assignment.estimatedMinutes)}</em></div>)}
                {tasks.length > calendarTaskLimit && <button className="calendar-more-button" onClick={event => openOverflow(date, event)}>+{tasks.length - calendarTaskLimit} 项</button>}
              </div>
              {dragTargetDate === date && dragged && <div className={`calendar-drop-preview ${projected > capacity ? 'over' : ''}`}><strong>放入后 {minutesText(projected)}</strong><span>{projected > capacity ? `超载 ${minutesText(projected - capacity)}` : `剩余 ${minutesText(capacity - projected)}`}</span></div>}
              {inPlan && <footer>{minutesText(load)} / {minutesText(capacity)}</footer>}
            </div>
          })}
        </div>
      </> : <div className="calendar-week-list">
        {days.map(date => {
          const inPlan = date >= state.settings.startDate && date <= state.settings.endDate
          const tasks = tasksFor(date)
          const load = inPlan ? loadFor(date) : 0
          const capacity = inPlan ? getCapacity(state, date) : 0
          const config = inPlan ? getDayConfig(state, date) : undefined
          return <article key={date} className={`calendar-week-day ${!inPlan ? 'outside' : ''} ${config ? `day-${config.type}` : ''} ${load > capacity ? 'load-over' : load > capacity * .8 ? 'load-near' : ''} ${moveModeTaskId ? 'calendar-date-selectable' : ''}`}>
            <button className="calendar-week-head" disabled={!inPlan} onClick={() => inPlan && chooseCalendarDate(date)}>
              <div><strong>{fmtDate(date)} · {fmtWeekday(date)}</strong><span>{config?.isBufferDay ? `缓冲日 · ${minutesText(capacity)}` : config ? dayTypeLabel[config.type] : '计划外'}</span></div>
              <div><strong>{minutesText(load)}</strong><span>/ {minutesText(capacity)}</span></div>
            </button>
            <div className="calendar-week-tasks">
              {tasks.length === 0 && <button className="calendar-week-empty" onClick={() => inPlan && chooseCalendarDate(date)}>当天没有任务</button>}
              {tasks.map(assignment => <button key={assignment.id} className={assignment.status === 'done' ? 'mini-done' : ''} onPointerDown={() => startLongPress(assignment.id)} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerMove={cancelLongPress} onClick={() => openTaskUnlessLongPressed(assignment.id)}><span className={`subject-dot subject-${groups.get(assignment.groupId)?.subject}`}/><div><strong>{assignment.title}</strong><span>{groups.get(assignment.groupId)?.subject} · {minutesText(assignment.estimatedMinutes)}</span></div>{assignment.locked && <Lock size={13}/>}</button>)}
            </div>
          </article>
        })}
      </div>}
    </section>

    {overflowPanel && <div className="calendar-overflow-backdrop" onMouseDown={() => setOverflowPanel(undefined)}>
      <section className="calendar-overflow-panel" style={{ top: overflowPanel.top, left: overflowPanel.left }} onMouseDown={event => event.stopPropagation()}>
        <header><div><strong>{fmtDate(overflowPanel.date)} · 其余 {overflowTasks.length} 项</strong><span>这些是日期格中未显示的任务，可直接拖到月历其他日期。</span></div><button className="icon-button" onClick={() => setOverflowPanel(undefined)}><X size={18}/></button></header>
        <div className="overflow-bulk-bar"><span>已选择 {overflowSelectedIds.length} 项</span><div className="button-wrap"><button className="secondary-button" disabled={!overflowSelectedIds.length} onClick={() => bulkMove(overflowSelectedIds)}>批量移动</button><button className="secondary-button" disabled={!overflowSelectedIds.length} onClick={shiftOverflowSelected}>顺延一天</button><button className="secondary-button" disabled={!overflowSelectedIds.length} onClick={lockOverflowSelected}>锁定</button></div></div>
        <div className="overflow-task-list">
          {overflowTasks.length === 0 && <p className="muted-text">折叠任务已经全部移走或不再需要折叠。</p>}
          {overflowTasks.map(assignment => <div
            className="overflow-task-row"
            key={assignment.id}
            draggable={!assignment.locked}
            onDragStart={event => beginDrag(assignment, event)}
            onDragEnd={() => { setDragAssignmentId(undefined); setDragTargetDate(undefined) }}
            onPointerDown={() => startLongPress(assignment.id)}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onPointerMove={cancelLongPress}
          >
            <input type="checkbox" checked={overflowSelectedIds.includes(assignment.id)} onChange={event => setOverflowSelectedIds(previous => event.target.checked ? [...previous, assignment.id] : previous.filter(id => id !== assignment.id))}/>
            <button className="overflow-task-content" onClick={() => openTaskUnlessLongPressed(assignment.id)}><span className={`subject-dot subject-${groups.get(assignment.groupId)?.subject}`}/><div><strong>{assignment.title}</strong><span>{groups.get(assignment.groupId)?.subject} · {minutesText(assignment.estimatedMinutes)}</span></div></button>
            {assignment.locked ? <small>已锁定</small> : <button className="text-button" onClick={() => setTaskOpenId(assignment.id)}>移动</button>}
          </div>)}
        </div>
      </section>
    </div>}

    <Modal open={Boolean(dayOpen)} title={dayOpen ? `${fmtDate(dayOpen)} · ${fmtWeekday(dayOpen)}` : '日期'} mobileSheet onClose={() => { setDayOpen(undefined); setSelectedIds([]); setPendingDayType(undefined); setPendingDayNote(''); setPendingCustomMinutes(undefined); setPendingAvailabilityMode('default'); setPendingAvailableMinutes(60); setPendingBufferReason(''); setPendingBufferPreference('preserve') }} wide>
      {dayOpen && dayCfg && dayPreviewState && <>
        <div className="day-settings-row">
          <label className="field"><span>日期类型</span><select value={pendingDayType ?? dayCfg.type} onChange={event => setPendingDayType(event.target.value as DayType)}>{(['regular', 'study', 'travel', 'custom'] as DayType[]).map(type => <option key={type} value={type}>{dayTypeLabel[type]}</option>)}</select></label>
          {(pendingDayType ?? dayCfg.type) === 'custom' && <label className="field"><span>可用分钟</span><NumericInput min={0} max={1440} value={pendingCustomMinutes ?? dayCfg.customMinutes ?? 210} onValueChange={setPendingCustomMinutes}/></label>}
          <label className="field grow"><span>备注</span><input value={pendingDayNote} onChange={event => setPendingDayNote(event.target.value)} placeholder="例如：外出、下午补课"/></label>
        </div>
        <section className="buffer-day-editor">
          <div><strong>当天可用时间</strong><span>有活动或需要休息时，可以降低容量；系统只移出必要任务，并尽量保持后续每天原来的组合。</span></div>
          <div className="segmented-control buffer-mode-control">
            <button className={pendingAvailabilityMode === 'default' ? 'active' : ''} onClick={() => setPendingAvailabilityMode('default')}>使用默认容量</button>
            <button className={pendingAvailabilityMode === 'reduced' ? 'active' : ''} onClick={() => setPendingAvailabilityMode('reduced')}>降低当天容量</button>
            <button className={pendingAvailabilityMode === 'rest' ? 'active' : ''} onClick={() => setPendingAvailabilityMode('rest')}>完全休息</button>
          </div>
          {pendingAvailabilityMode !== 'default' && <div className="buffer-fields">
            {pendingAvailabilityMode === 'reduced' && <label className="field"><span>最多可学习（分钟）</span><NumericInput min={0} max={1440} step={10} value={pendingAvailableMinutes} onValueChange={setPendingAvailableMinutes}/></label>}
            <label className="field grow"><span>原因</span><input value={pendingBufferReason} onChange={event => setPendingBufferReason(event.target.value)} placeholder="例如：明天参加活动，下午不在家"/></label>
            <label className="field"><span>后续调整偏好</span><select value={pendingBufferPreference} onChange={event => setPendingBufferPreference(event.target.value as BufferPreference)}><option value="preserve">尽量保持后续每日安排</option><option value="goal">优先保护目标日期</option><option value="spread">尽量均匀分散</option></select></label>
          </div>}
          {pendingAvailabilityMode !== 'default' && <p className="buffer-protection-note">该日会成为受保护的手动缓冲日。任何自动方案都不能擅自往里面增加任务。</p>}
        </section>
        <div className="day-load-summary day-load-live"><span>执行负载 {minutesText(planningDayLoad(state, dayOpen))}</span><span>容量 {minutesText(getCapacity(state, dayOpen))} → {minutesText(getCapacity(dayPreviewState, dayOpen))}</span><span>{dayTasks.filter(task => task.status === 'done').length}/{dayTasks.length} 已完成</span><em className={planningDayLoad(dayPreviewState, dayOpen) > getCapacity(dayPreviewState, dayOpen) ? 'over' : ''}>{planningDayLoad(dayPreviewState, dayOpen) > getCapacity(dayPreviewState, dayOpen) ? `调整后超载 ${minutesText(planningDayLoad(dayPreviewState, dayOpen) - getCapacity(dayPreviewState, dayOpen))}` : `调整后剩余 ${minutesText(getCapacity(dayPreviewState, dayOpen) - planningDayLoad(dayPreviewState, dayOpen))}`}</em></div>
        <div className="date-detail-primary"><button className="primary-button" onClick={() => onAddTask(dayOpen)}><Plus size={16}/>添加到这一天</button><span>会完整校验容量、同类上限、长任务、高强度、日期保护、今日规则和目标最晚日期。</span></div>
        <div className="bulk-row"><span>已选择 {selectedIds.length} 项</span><div className="button-wrap">
          {JSON.stringify(dayPreviewState.dayConfigs[dayOpen]) !== JSON.stringify(state.dayConfigs[dayOpen] ?? { date: dayOpen, type: 'regular' }) || JSON.stringify(dayPreviewState.calendarConstraints.filter(item => item.startDate === dayOpen && item.endDate === dayOpen)) !== JSON.stringify(state.calendarConstraints.filter(item => item.startDate === dayOpen && item.endDate === dayOpen)) ? <button className="primary-button" onClick={() => {
            const ordinary = dayPreviewState!.assignments.filter(assignment => assignment.scheduledDate === dayOpen && assignment.status !== 'done' && !groups.get(assignment.groupId)?.recurring)
            const newCapacity = getCapacity(dayPreviewState!, dayOpen)
            const newLoad = planningDayLoad(dayPreviewState!, dayOpen)
            if (ordinary.length && ((pendingDayType ?? dayCfg.type) === 'travel' || newLoad > newCapacity || pendingAvailabilityMode !== 'default')) prepareCalendarDayChange(dayOpen, dayPreviewState)
            else updateDayConfig(dayOpen, dayPreviewState!.dayConfigs[dayOpen])
          }}>预览缓冲日调整</button> : <button className="secondary-button" onClick={() => onOpenAdjustment(dayOpen)}>查看调整建议</button>}
          <button className="secondary-button" disabled={!selectedIds.length} onClick={() => bulkMove()}>批量移动</button>
        </div></div>
        <div className="day-task-list">{dayTasks.map(assignment => <label key={assignment.id} className="select-task-row" onPointerDown={() => startLongPress(assignment.id)} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerMove={cancelLongPress}><input type="checkbox" checked={selectedIds.includes(assignment.id)} onChange={event => setSelectedIds(previous => event.target.checked ? [...previous, assignment.id] : previous.filter(id => id !== assignment.id))}/><button className="select-task-content" onClick={event => { event.preventDefault(); openTaskUnlessLongPressed(assignment.id) }}><strong>{assignment.title}</strong><span>{groups.get(assignment.groupId)?.subject} · {minutesText(assignment.estimatedMinutes)}</span></button>{assignment.locked && <small>已锁定</small>}</label>)}</div>
      </>}
    </Modal>

    <Modal open={Boolean(bulkMoveDialog)} title="批量移动任务" onClose={() => setBulkMoveDialog(undefined)} wide mobileFullscreen>
      {bulkMoveDialog && <div className="bulk-move-dialog">
        <div className="bulk-move-summary"><strong>移动 {bulkMoveDialog.ids.length} 项可移动任务</strong><span>已完成、锁定和正在计时任务不会进入本次操作。系统只执行你指定的批量移动，并在下一步统一预览容量、上限、目标和日期保护影响。</span></div>
        <label className="field"><span>目标日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={bulkMoveDialog.target} onChange={event => setBulkMoveDialog(current => current ? { ...current, target: event.target.value } : current)}/></label>
        <details><summary>查看所选任务（{bulkMoveDialog.ids.length}）</summary><ul>{bulkMoveDialog.ids.map(id => <li key={id}>{state.assignments.find(item => item.id === id)?.title ?? id}</li>)}</ul></details>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setBulkMoveDialog(undefined)}>取消</button><button className="primary-button" disabled={!bulkMoveDialog.target} onClick={() => { if (bulkMoveTo(bulkMoveDialog.ids, bulkMoveDialog.target)) { setBulkMoveDialog(undefined); setOverflowPanel(undefined) } }}>预览批量移动</button></div>
      </div>}
    </Modal>

    <Drawer open={Boolean(taskOpen)} title={taskOpen?.title ?? '任务详情'} subtitle={taskOpenGroup ? `${taskOpenGroup.subject} · ${priorityLabel(taskOpenGroup.priority)}优先级` : undefined} onClose={() => setTaskOpenId(undefined)}>
      {taskOpen && taskOpenGroup && <div className="task-quick-editor">
        <div className="task-detail-metrics"><div><span>预计时间</span><strong>{minutesText(taskOpen.estimatedMinutes)}</strong></div><div><span>状态</span><strong>{taskOpen.status === 'done' ? '已完成' : taskOpen.status === 'partial' ? '部分完成' : '待完成'}</strong></div><div><span>排期来源</span><strong>{taskOpen.intentStrength === 'manual' ? '用户手动' : taskOpen.scheduleSource}</strong></div></div>
        <label className="field"><span>任务标题</span><input value={taskTitleDraft} onChange={event => setTaskTitleDraft(event.target.value)}/></label>
        <label className="field"><span>预计时长（分钟）</span><NumericInput min={1} max={1440} value={taskDurationDraft ?? taskOpen.estimatedMinutes} onValueChange={setTaskDurationDraft}/><small>修改后先预览影响；默认不移动日期。</small></label>
        <label className="field"><span>移动到</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={taskOpen.scheduledDate ?? ''} onChange={event => moveWithValidation(taskOpen.id, event.target.value)}/></label>
        <label className="field"><span>所属任务组</span><select value={taskOpen.groupId} onChange={event => {
          if (event.target.value === taskOpen.groupId) return
          setGroupChangeTargetId(event.target.value)
        }}>
          <option value={taskOpen.groupId}>{taskOpenGroup.subject} · {taskOpenGroup.title}（当前）</option>
          {state.taskGroups.filter(group => group.id !== taskOpen.groupId && !group.hiddenStandalone && !group.recurring && group.status !== 'completed').map(group => <option key={group.id} value={group.id}>{group.subject} · {group.title}</option>)}
        </select><small>更换任务组会先展示继承规则、编号、预计时长和当前日期影响，不会直接修改。</small></label>
        <label className="switch-row"><button type="button" className={`switch ${taskOpen.locked ? 'on' : ''}`} onClick={() => updateAssignment(taskOpen.id, { locked: !taskOpen.locked })}><i/></button><span>锁定任务，自动方案不得移动</span></label><div className="task-editor-actions"><button className="primary-button" disabled={(taskTitleDraft.trim() || taskOpen.title) === taskOpen.title && (taskDurationDraft ?? taskOpen.estimatedMinutes) === taskOpen.estimatedMinutes} onClick={saveTaskBasics}>保存基本信息</button><span>标题一次保存；时长变化会先生成最小作用域预览。</span></div>
        <div className="task-impact-note"><strong>关联目标</strong><span>{state.goals.filter(goal => goal.linkedAssignmentIds.includes(taskOpen.id) || goal.linkedTaskGroupIds.includes(taskOpen.groupId) || goal.completionConditions.some(condition => condition.groupId === taskOpen.groupId)).map(goal => `${goal.title}（最晚 ${goal.latestDate}）`).join('；') || '无关联目标'}。移动出现超载或目标风险时，系统会先说明后果。</span></div>
        {taskOpenDurationSuggestion && <div className="task-impact-note duration-detail-suggestion"><strong>历史用时建议</strong><span>最近 {taskOpenDurationSuggestion.sampleCount} 个有效样本平均 {taskOpenDurationSuggestion.recentAverage} 分钟；当前组预计 {taskOpenDurationSuggestion.currentEstimate} 分钟，建议 {taskOpenDurationSuggestion.suggestedEstimate} 分钟。接受后仍会先展示日期调整方案。</span><button className="secondary-button" onClick={() => { const prepared = prepareDurationChange(taskOpenDurationSuggestion); setTaskOpenId(undefined); onPrepared(prepared.state, prepared.event) }}>查看时长调整方案</button></div>}
        <div className="drawer-danger-zone">{taskOpen.status === 'done' && <button className="secondary-button" onClick={() => reopenAssignment(taskOpen.id)}>重新打开任务</button>}<button className="danger-button" onClick={() => { const prepared = prepareAssignmentDelete(taskOpen.id); setTaskOpenId(undefined); onPrepared(prepared.state, prepared.event) }}><Trash2 size={16}/>移除任务</button></div>
      </div>}
    </Drawer>

    <AssignmentGroupChangeDialog
      open={Boolean(taskOpen && groupChangeTarget)}
      state={state}
      assignment={taskOpen}
      targetGroup={groupChangeTarget}
      onClose={() => setGroupChangeTargetId(undefined)}
      onSubmit={options => {
        if (!taskOpen || !groupChangeTarget) return
        try {
          const prepared = prepareAssignmentGroupChange(taskOpen.id, groupChangeTarget.id, options)
          setGroupChangeTargetId(undefined)
          setTaskOpenId(undefined)
          onPrepared(prepared.state, prepared.event)
        } catch (error) {
          window.alert(error instanceof Error ? error.message : '无法生成任务组变更预览。')
        }
      }}
    />
  </>
}

function TasksPage({ onOpenIntake, onPrepared }: { onOpenIntake: () => void; onPrepared: (state: AppState, event: PlanChangeEvent) => void }) {
  const { state, editTaskGroup, updateAssignment, prepareAssignmentDelete, prepareTaskGroupEdit, prepareTaskGroupDelete, prepareDurationChange } = useApp()
  const [mode, setMode] = useState<'tasks' | 'groups'>('tasks')
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'all'|Priority>('all')
  const [subject, setSubject] = useState<'all'|Subject>('all')
  const [showHidden, setShowHidden] = useState(false)
  const [taskFilter, setTaskFilter] = useState<'attention'|'unscheduled'|'overdue'|'today'|'future'|'done'|'all'>('attention')
  const [editing, setEditing] = useState<TaskGroup>()
  const [movingGroup, setMovingGroup] = useState<TaskGroup>()
  const [movingTask, setMovingTask] = useState<Assignment>()
  const [moveDate, setMoveDate] = useState(todayISO())
  const [taskMoveDate, setTaskMoveDate] = useState(todayISO())
  const assignmentsByGroup = useMemo(() => new Map(state.taskGroups.map(group => [group.id, state.assignments.filter(item => item.groupId === group.id)])), [state.taskGroups, state.assignments])
  const groupMap = useMemo(() => new Map(state.taskGroups.map(group => [group.id, group])), [state.taskGroups])
  const subjects = Array.from(new Set([...state.settings.customSubjects, ...state.taskGroups.map(group => group.subject)])).sort()
  const today = todayISO()
  const query = search.trim().toLowerCase()
  const groups = state.taskGroups.filter(group => !group.hiddenStandalone && (showHidden || !group.hidden) && (priority === 'all' || group.priority === priority) && (subject === 'all' || group.subject === subject) && (`${group.subject}${group.title}${group.notes ?? ''}`.toLowerCase().includes(query)))
  const taskCounts = useMemo(() => {
    const active = state.assignments.filter(item => item.status !== 'done')
    return {
      attention: active.filter(item => !item.scheduledDate || item.scheduledDate < today).length,
      unscheduled: active.filter(item => !item.scheduledDate).length,
      overdue: active.filter(item => Boolean(item.scheduledDate && item.scheduledDate < today)).length,
      today: active.filter(item => item.scheduledDate === today).length,
      future: active.filter(item => Boolean(item.scheduledDate && item.scheduledDate > today)).length,
      done: state.assignments.filter(item => item.status === 'done').length,
      all: state.assignments.length,
    }
  }, [state.assignments, today])
  const tasks = useMemo(() => state.assignments
    .filter(item => {
      const group = groupMap.get(item.groupId)
      if (!group || group.status === 'archived') return false
      if (priority !== 'all' && group.priority !== priority) return false
      if (subject !== 'all' && group.subject !== subject) return false
      if (query && !`${item.title} ${item.notes ?? ''} ${group.title} ${group.subject}`.toLowerCase().includes(query)) return false
      if (taskFilter === 'attention') return item.status !== 'done' && (!item.scheduledDate || item.scheduledDate < today)
      if (taskFilter === 'unscheduled') return item.status !== 'done' && !item.scheduledDate
      if (taskFilter === 'overdue') return item.status !== 'done' && Boolean(item.scheduledDate && item.scheduledDate < today)
      if (taskFilter === 'today') return item.status !== 'done' && item.scheduledDate === today
      if (taskFilter === 'future') return item.status !== 'done' && Boolean(item.scheduledDate && item.scheduledDate > today)
      if (taskFilter === 'done') return item.status === 'done'
      return true
    })
    .sort((a, b) => {
      const attentionA = a.status !== 'done' && (!a.scheduledDate || a.scheduledDate < today) ? 0 : 1
      const attentionB = b.status !== 'done' && (!b.scheduledDate || b.scheduledDate < today) ? 0 : 1
      if (attentionA !== attentionB) return attentionA - attentionB
      return (a.scheduledDate ?? '9999-12-31').localeCompare(b.scheduledDate ?? '9999-12-31') || (groupMap.get(b.groupId)?.priority ?? 0) - (groupMap.get(a.groupId)?.priority ?? 0)
    }), [state.assignments, groupMap, priority, subject, query, taskFilter, today])

  const prepareGroupMove = (group: TaskGroup, date: string) => {
    if (!date || date < state.settings.startDate || date > state.settings.endDate) { window.alert('目标日期超出计划范围。'); return }
    const candidates = state.assignments.filter(item => item.groupId === group.id && item.status !== 'done' && !item.locked && item.id !== state.timer.assignmentId)
    if (!candidates.length) { window.alert('没有可移动的未完成任务；锁定和正在计时任务不会移动。'); return }
    const prepared = cloneActiveState(state)
    const movedAt = new Date().toISOString()
    const affectedDates = new Set<string>([date])
    for (const source of candidates) {
      const item = prepared.assignments.find(candidate => candidate.id === source.id)
      if (!item) continue
      if (item.scheduledDate) affectedDates.add(item.scheduledDate)
      item.previousDate = item.scheduledDate
      item.scheduledDate = date
      item.lastManualMoveAt = movedAt
      item.scheduleSource = 'manual'
      item.intentStrength = 'manual'
    }
    const affectedAssignmentIds = candidates.map(item => item.id)
    const affectedGoalIds = prepared.goals.filter(goal => goal.linkedTaskGroupIds.includes(group.id) || goal.linkedAssignmentIds.some(id => affectedAssignmentIds.includes(id)) || goal.completionConditions.some(condition => condition.groupId === group.id)).map(goal => goal.id)
    const event: PlanChangeEvent = {
      id: uid('event'), type: 'bulk-move', action: 'repair', title: `批量移动“${group.title}”未完成任务`,
      description: `用户指定把 ${candidates.length} 项可移动任务安排到 ${date}。第一方案只执行这次移动，系统会完整核验容量、每日上限、目标期限和日期保护。`,
      affectedGoalIds, affectedGroupIds: [group.id], affectedAssignmentIds, affectedDates: Array.from(affectedDates).sort(), createdAt: movedAt,
      metadata: { requestedDate: date, explicitLocalOperation: true, operationScope: 'requested-change-only', requestedChangeLabel: `仅移动“${group.title}”的 ${candidates.length} 项未完成任务`, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
    }
    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    prepared.updatedAt = movedAt
    setMovingGroup(undefined)
    onPrepared(prepared, event)
  }

  const prepareTaskMove = (assignment: Assignment, date: string) => {
    const earliest = today > state.settings.startDate ? today : state.settings.startDate
    if (!date || date < earliest || date > state.settings.endDate) { window.alert('请选择今天或之后、且在计划范围内的日期。'); return }
    if (assignment.status === 'done' || assignment.locked || assignment.id === state.timer.assignmentId) { window.alert('已完成、锁定或正在计时的任务不能直接重新安排。'); return }
    const prepared = cloneActiveState(state)
    const item = prepared.assignments.find(candidate => candidate.id === assignment.id)
    if (!item) return
    const movedAt = new Date().toISOString()
    const previousDate = item.scheduledDate
    item.previousDate = previousDate
    item.scheduledDate = date
    item.lastManualMoveAt = movedAt
    item.scheduleSource = 'manual'
    item.intentStrength = 'manual'
    const affectedDates = Array.from(new Set([...(previousDate ? [previousDate] : []), date])).sort()
    const affectedGoalIds = prepared.goals.filter(goal => goal.linkedTaskGroupIds.includes(item.groupId) || goal.linkedAssignmentIds.includes(item.id) || goal.completionConditions.some(condition => condition.groupId === item.groupId)).map(goal => goal.id)
    const event: PlanChangeEvent = {
      id: uid('event'), type: 'bulk-move', action: 'repair', title: `重新安排“${item.title}”`,
      description: `把这一项任务安排到 ${fmtDate(date)}；先核验容量、期限和日期保护。`,
      affectedGoalIds, affectedGroupIds: [item.groupId], affectedAssignmentIds: [item.id], affectedDates, createdAt: movedAt,
      metadata: { requestedDate: date, explicitLocalOperation: true, operationScope: 'requested-change-only', requestedChangeLabel: `仅重新安排“${item.title}”`, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
    }
    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    prepared.updatedAt = movedAt
    setMovingTask(undefined)
    onPrepared(prepared, event)
  }

  const filterOptions: Array<{ id: typeof taskFilter; label: string; count: number }> = [
    { id: 'attention', label: '待处理', count: taskCounts.attention },
    { id: 'unscheduled', label: '未安排', count: taskCounts.unscheduled },
    { id: 'overdue', label: '逾期', count: taskCounts.overdue },
    { id: 'today', label: '今日', count: taskCounts.today },
    { id: 'future', label: '未来', count: taskCounts.future },
    { id: 'done', label: '已完成', count: taskCounts.done },
    { id: 'all', label: '全部', count: taskCounts.all },
  ]

  return <>
    <section className="tasks-toolbar task-hub-toolbar">
      <div className="segmented-control task-mode-toggle"><button className={mode === 'tasks' ? 'active' : ''} onClick={() => setMode('tasks')}>具体任务</button><button className={mode === 'groups' ? 'active' : ''} onClick={() => setMode('groups')}>任务组</button></div>
      <div className="search-box"><Search size={18}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder={mode === 'tasks' ? '搜索任务、任务组或科目' : '搜索任务组'}/></div>
      <select value={priority} onChange={event => setPriority(event.target.value === 'all' ? 'all' : Number(event.target.value) as Priority)}><option value="all">全部优先级</option>{[5,3,2,1,0].map(item => <option key={item} value={item}>{priorityLabel(item as Priority)}</option>)}</select>
      <select value={subject} onChange={event => setSubject(event.target.value as 'all'|Subject)}><option value="all">全部科目／类别</option>{subjects.map(item => <option key={item}>{item}</option>)}</select>
      {mode === 'groups' && <label className="toggle-label"><input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)}/><span>显示隐藏任务组</span></label>}
      <div className="tasks-toolbar-note"><Inbox size={17}/><span>添加新任务请前往“录入”</span><button className="text-button" onClick={onOpenIntake}>打开录入</button></div>
    </section>

    {mode === 'tasks' ? <>
      <div className="task-inbox-summary"><div><strong>任务收件箱</strong><span>待处理：未排期或已逾期的任务。</span></div><div><b>{taskCounts.attention}</b><small>项待处理</small></div></div>
      <div className="task-filter-tabs">{filterOptions.map(item => <button key={item.id} className={taskFilter === item.id ? 'active' : ''} onClick={() => setTaskFilter(item.id)}><span>{item.label}</span><em>{item.count}</em></button>)}</div>
      <section className="assignment-list">{tasks.map(item => {
        const group = groupMap.get(item.groupId)!
        const overdue = item.status !== 'done' && Boolean(item.scheduledDate && item.scheduledDate < today)
        const unscheduled = item.status !== 'done' && !item.scheduledDate
        return <article className={`assignment-list-card ${overdue || unscheduled ? 'needs-attention' : ''}`} key={item.id}>
          <div className="assignment-list-main"><div className="task-title-row"><span className={`subject-pill subject-${group.subject}`}>{group.subject}</span><span className={`priority-badge priority-${group.priority}`}>{priorityLabel(group.priority)}</span><strong>{item.title}</strong></div><div className="task-meta"><span>{group.title}</span><span>{item.status === 'done' ? '已完成' : item.status === 'partial' ? `部分完成 ${item.progress}%` : '待完成'}</span><span>{item.scheduledDate ? (overdue ? `逾期于 ${fmtDate(item.scheduledDate)}` : fmtDate(item.scheduledDate)) : '未安排日期'}</span><span>预计 {minutesText(item.estimatedMinutes)}</span>{item.actualMinutes > 0 && <span>实际 {minutesText(item.actualMinutes)}</span>}</div>{item.notes && <p>{item.notes}</p>}</div>
          <div className="assignment-list-actions">{(overdue || unscheduled) && <button className="primary-button" disabled={item.locked || item.id === state.timer.assignmentId} title={item.locked ? '先解除锁定，再重新安排' : item.id === state.timer.assignmentId ? '请先结束当前计时' : undefined} onClick={() => { setTaskMoveDate(today > state.settings.startDate ? today : state.settings.startDate); setMovingTask(item) }}>安排日期</button>}<button className="secondary-button" onClick={() => updateAssignment(item.id, { locked: !item.locked })}>{item.locked ? '解除锁定' : '锁定'}</button><button className="danger-button" onClick={() => { const prepared = prepareAssignmentDelete(item.id); onPrepared(prepared.state, prepared.event) }}><Trash2 size={15}/>移除</button></div>
        </article>
      })}{!tasks.length && <div className="empty-state"><CheckCircle2 size={30}/><h3>{taskFilter === 'attention' ? '没有待处理任务' : '没有符合条件的任务'}</h3><p>{taskFilter === 'attention' ? '所有任务都有明确去向。' : '尝试切换筛选或搜索条件。'}</p></div>}</section>
    </> : <>
      <section className="group-list">{groups.map(group => { const items = assignmentsByGroup.get(group.id) ?? []; const done = items.filter(item => item.status === 'done').length; const actual = items.reduce((sum,item) => sum + item.actualMinutes,0); const planned = items.reduce((sum,item) => sum + item.estimatedMinutes,0); const durationSuggestion = allDurationSuggestions(state).find(item => item.groupId === group.id); const linkedGoals = state.goals.filter(goal => goal.linkedTaskGroupIds.includes(group.id) || goal.completionConditions.some(condition => condition.groupId === group.id)); return <article className="group-card" key={group.id}><div className="group-card-head"><div><span className={`subject-pill subject-${group.subject}`}>{group.subject}</span><span className={`priority-badge priority-${group.priority}`}>{priorityLabel(group.priority)}</span><span className="status-pill">{group.status === 'completed' ? '已完成' : group.status === 'archived' ? '已归档' : '进行中'}</span><h3>{group.title}</h3></div><div className="group-actions"><button className="text-button" onClick={() => { setMoveDate(today); setMovingGroup(group) }}>移动未完成</button><button className="text-button" onClick={() => setEditing(group)}>编辑</button><button className="icon-button danger-icon" aria-label={`删除任务组${group.title}`} onClick={() => { const prepared = prepareTaskGroupDelete(group.id); onPrepared(prepared.state, prepared.event) }}><Trash2 size={17}/></button></div></div><div className="group-stats"><span>{done}/{items.length} 已完成</span><span>预计 {minutesText(planned)}</span><span>实际 {minutesText(actual)}</span><span>关联目标 {linkedGoals.length}</span>{group.dailyMax && <span>每天最多 {group.dailyMax} 个</span>}</div><div className="progress-track"><i style={{width:`${items.length ? done/items.length*100 : 0}%`}}/></div>{(group.notes || group.sourceLabel) && <p className="group-note">{group.notes || group.sourceLabel}</p>}{durationSuggestion && <div className="duration-suggestion"><div><strong>发现用时校准机会</strong><span>当前 {durationSuggestion.currentEstimate} 分钟；最近 {durationSuggestion.sampleCount} 个有效样本平均 {Math.round(durationSuggestion.recentAverage)} 分钟，建议 {durationSuggestion.suggestedEstimate} 分钟。只会生成预览，不直接覆盖。</span></div><button className="secondary-button" onClick={() => { const prepared = prepareDurationChange(durationSuggestion); onPrepared(prepared.state, prepared.event) }}>查看时长调整方案</button></div>}</article> })}
        {!groups.length && <div className="empty-state"><CheckCircle2 size={30}/><h3>{state.taskGroups.filter(group => !group.hiddenStandalone).length ? '没有符合条件的任务组' : '计划还是空的'}</h3><p>{state.taskGroups.length ? '调整筛选条件。' : '新任务统一从“录入”添加，确认安排后会在这里管理。'}</p><button className="primary-button" onClick={onOpenIntake}>打开录入</button></div>}
      </section>
    </>}

    <Modal open={Boolean(movingTask)} title={movingTask ? `安排“${movingTask.title}”` : '安排任务'} onClose={() => setMovingTask(undefined)}>
      {movingTask && <><p className="muted-text">选择日期后先预览，确认后才会改动计划。</p><label className="field"><span>安排到</span><input type="date" min={today > state.settings.startDate ? today : state.settings.startDate} max={state.settings.endDate} value={taskMoveDate} onChange={event => setTaskMoveDate(event.target.value)}/></label><div className="modal-actions"><button className="secondary-button" onClick={() => setMovingTask(undefined)}>取消</button><button className="primary-button" onClick={() => prepareTaskMove(movingTask, taskMoveDate)}>生成预览</button></div></>}
    </Modal>

    <Modal open={Boolean(movingGroup)} title={movingGroup ? `移动“${movingGroup.title}”的未完成任务` : '移动未完成任务'} onClose={() => setMovingGroup(undefined)}>
      {movingGroup && <><p className="muted-text">只移动该组中未完成、未锁定且未计时的任务。系统会在最终预览中展示容量、目标和日期保护影响。</p><label className="field"><span>目标日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={moveDate} onChange={event => setMoveDate(event.target.value)}/></label><div className="modal-actions"><button className="secondary-button" onClick={() => setMovingGroup(undefined)}>取消</button><button className="primary-button" onClick={() => prepareGroupMove(movingGroup, moveDate)}>生成预览</button></div></>}
    </Modal>
    <TaskGroupDialog open={Boolean(editing)} state={state} initial={editing} onClose={() => setEditing(undefined)} onCreate={() => undefined} onEdit={(group, numberingChoice) => {
      const original = state.taskGroups.find(item => item.id === group.id)
      // 科目/分类名称属于纯展示元数据（如“数学”“化学”），重命名不触发调度分析。
      const affectsPlan = Boolean(original && (original.quantity !== group.quantity || original.unitMinutes !== group.unitMinutes
        || original.priority !== group.priority || original.dailyMax !== group.dailyMax || original.activityType !== group.activityType
        || original.highIntensity !== group.highIntensity || original.countInStats !== group.countInStats))
      if (affectsPlan) {
        const prepared = prepareTaskGroupEdit(group, numberingChoice)
        onPrepared(prepared.state, prepared.event)
      } else editTaskGroup(group)
    }}/>
  </>
}

function SettingsPage({ sessionUserId, sessionEmail, cloudMessage, onCloudUpload, onPrepared, onStartTutorial }: { sessionUserId?: string; sessionEmail?: string; cloudMessage?: string; onCloudUpload: () => Promise<string>; onPrepared: (state: AppState, event: PlanChangeEvent) => void; onStartTutorial: () => void }) {
  const { state, namespace, updateSettings, undo, canUndo, replaceState, resetAll, restoreReplanHistory, previewPlanVersion, restorePlanVersion } = useApp()
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [authMessage,setAuthMessage]=useState('')
  const [historyEntry,setHistoryEntry]=useState<AppState['replanHistory'][number]>()
  const [planNameDraft,setPlanNameDraft]=useState(state.settings.planName)
  const [subjectDraft,setSubjectDraft]=useState('')
  const [versionOpen,setVersionOpen]=useState<AppState['planVersions'][number]>()
  const [replacementPreview,setReplacementPreview]=useState<{label:string;state:AppState}>()
  const fileRef=useRef<HTMLInputElement>(null)
  useEffect(() => setPlanNameDraft(state.settings.planName), [state.settings.planName])
  const versionDiff = versionOpen ? previewPlanVersion(versionOpen.id) : undefined
  const exportJson=()=>downloadBlob(JSON.stringify(state,null,2),`study-plan-v0.8-${todayISO()}.json`,'application/json')
  const exportCsv=()=>{const groups=new Map(state.taskGroups.map(group=>[group.id,group]));const rows=[['科目/类别','任务','计划日期','状态','预计分钟','实际分钟','进度','优先级','排期来源','用户意图']];for(const item of state.assignments){const group=groups.get(item.groupId);if(group)rows.push([group.subject,item.title,item.scheduledDate??'',item.status,String(item.estimatedMinutes),String(item.actualMinutes),String(item.progress),String(group.priority),item.scheduleSource,item.intentStrength])}downloadBlob('\ufeff'+rows.map(row=>row.map(csvEscape).join(',')).join('\n'),`study-plan-${todayISO()}.csv`,'text/csv;charset=utf-8')}
  const importJson=(file:File)=>{const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(String(reader.result)) as AppState;if(!parsed.version||!parsed.taskGroups)throw new Error();setReplacementPreview({label:`导入备份：${file.name}`,state:normalizeState(parsed)})}catch{window.alert('无法识别这个备份文件。')}};reader.readAsText(file)}
  const login=async(kind:'in'|'up')=>{try{setAuthMessage('处理中……');await(kind==='in'?signIn(email,password):signUp(email,password));setAuthMessage(kind==='in'?'登录成功，正在恢复云端计划':'注册请求已提交，请检查邮箱。')}catch(error){setAuthMessage(error instanceof Error?error.message:'操作失败')}}
  const cloudUpload=async()=>{try{const timestamp=await onCloudUpload();setAuthMessage(`已同步：${new Date(timestamp).toLocaleString()}`)}catch(error){setAuthMessage(error instanceof Error?error.message:'同步失败')}}
  const cloudDownload=async()=>{try{const cloud=await downloadSnapshot(sessionUserId);if(!cloud){setAuthMessage('云端尚无数据');return}setReplacementPreview({label:'从云端恢复当前计划',state:normalizeState({...cloud,replanHistory:state.replanHistory,conflictBackups:state.conflictBackups,planVersions:state.planVersions})})}catch(error){setAuthMessage(error instanceof Error?error.message:'下载失败')}}
  const restoreConflict=(raw:string)=>{try{const parsed=JSON.parse(raw) as AppState;setReplacementPreview({label:'恢复同步冲突备份',state:normalizeState(parsed)})}catch{window.alert('冲突备份已损坏，无法恢复。')}}
  const addSubject=()=>{const value=subjectDraft.trim();if(!value)return;updateSettings({customSubjects:Array.from(new Set([...state.settings.customSubjects,value]))});setSubjectDraft('')}
  const prepareSettingsChange = (patch: Partial<AppState['settings']>, title: string, type: PlanChangeEvent['type'] = 'rule-change') => {
    const prepared = cloneActiveState(state)
    prepared.settings = { ...prepared.settings, ...patch }
    if (prepared.settings.startDate > prepared.settings.endDate) { window.alert('计划开始日期不能晚于结束日期。'); return }
    const now = new Date().toISOString()
    const availability = type === 'availability-change'
    let hasIncrease = false
    let hasDecrease = false
    if (availability) {
      for (const key of ['regularMinutes', 'studyMinutes', 'travelMinutes'] as const) {
        if (patch[key] == null) continue
        if (prepared.settings[key] > state.settings[key]) hasIncrease = true
        if (prepared.settings[key] < state.settings[key]) hasDecrease = true
      }
      if (patch.startDate) {
        if (prepared.settings.startDate < state.settings.startDate) hasIncrease = true
        if (prepared.settings.startDate > state.settings.startDate) hasDecrease = true
      }
      if (patch.endDate) {
        if (prepared.settings.endDate > state.settings.endDate) hasIncrease = true
        if (prepared.settings.endDate < state.settings.endDate) hasDecrease = true
      }
    }
    const pureRelaxation = availability && hasIncrease && !hasDecrease
    const affected = prepared.assignments.filter(item => item.status !== 'done' && (!item.scheduledDate || item.scheduledDate >= todayISO()))
    const affectedAssignmentIds = affected.map(item => item.id)
    const affectedGroupIds = Array.from(new Set(affected.map(item => item.groupId)))
    const affectedGoalIds = prepared.goals.filter(goal => goal.status === 'active' && (
      goal.linkedTaskGroupIds.some(id => affectedGroupIds.includes(id))
      || goal.linkedAssignmentIds.some(id => affectedAssignmentIds.includes(id))
      || goal.completionConditions.some(condition => affectedGroupIds.includes(condition.groupId))
    )).map(goal => goal.id)
    const rangeStart = [todayISO(), state.settings.startDate, prepared.settings.startDate].sort().at(-1) ?? todayISO()
    const rangeEnd = state.settings.endDate > prepared.settings.endDate ? state.settings.endDate : prepared.settings.endDate
    const affectedDates = rangeStart <= rangeEnd ? dateRange(rangeStart, rangeEnd) : []
    const event: PlanChangeEvent = {
      id: uid('event'), type, action: pureRelaxation ? 'optimize' : 'repair', title,
      description: pureRelaxation
        ? '可用时间或计划范围增加。设置先进入草稿；系统不会自动把任务提前，可保持当前排期，也可预览如何利用新增空间减负。'
        : '设置变化先进入草稿；系统会比较调整前后容量、任务日期和目标风险，不会在保存设置时静默移动任务。',
      affectedGoalIds, affectedGroupIds, affectedAssignmentIds, affectedDates, createdAt: now,
      metadata: { settingsPatch: patch, pureRelaxation, hasIncrease, hasDecrease, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
    }
    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    prepared.updatedAt = now
    onPrepared(prepared, event)
  }
  return <div className="settings-stack">
    <SettingsSection title="交互教程" description="教程使用独立数据空间，不会改动当前计划；随时退出都会回到这里。"><div className="button-wrap"><button className="secondary-button" onClick={onStartTutorial}>重新体验完整流程</button></div></SettingsSection>
    <SettingsSection title="计划基础" description="目标日期已统一迁移到“目标”页面，这里只保留计划边界和默认风格，避免多个可编辑真相。"><div className="form-grid"><label className="field span-2"><span>计划名称</span><input value={planNameDraft} onChange={event=>setPlanNameDraft(event.target.value)} onBlur={()=>planNameDraft!==state.settings.planName&&updateSettings({planName:planNameDraft})}/></label><label className="field"><span>开始日期</span><input type="date" value={state.settings.startDate} onChange={event=>prepareSettingsChange({startDate:event.target.value}, '调整计划开始日期', 'availability-change')}/></label><label className="field"><span>结束日期</span><input type="date" value={state.settings.endDate} onChange={event=>prepareSettingsChange({endDate:event.target.value}, '调整计划结束日期', 'availability-change')}/></label><label className="field"><span>默认排期风格</span><select value={state.settings.planningMode} onChange={event=>updateSettings({planningMode:event.target.value as AppState['settings']['planningMode']})}><option value="sprint">冲刺</option><option value="balanced">平衡</option><option value="relaxed">轻松</option></select></label></div></SettingsSection>
    <SettingsSection title="显示" description="跟随系统适合多设备使用；深色模式会同步调整页面、弹窗、表单和统计图表的对比度。"><div className="form-grid"><label className="field"><span>颜色模式</span><select value={state.settings.theme} onChange={event=>updateSettings({theme:event.target.value as AppState['settings']['theme']})}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></div></SettingsSection>
    <details className="settings-advanced"><summary>高级排期参数</summary><div className="settings-advanced-body">
    <SettingsSection title="排期偏好" description="这些是可解释的偏好和范围参数；硬约束、用户手动安排、锁定、执行状态与日期保护不会被静默突破。"><div className="form-grid three"><label className="field"><span>冻结近期天数</span><NumericInput commitMode="blur" min={0} max={7} value={state.settings.freezeDays} onValueChange={value=>updateSettings({freezeDays:value})}/></label><label className="field"><span>常规日最多任务</span><NumericInput commitMode="blur" min={1} max={100} value={state.settings.regularMaxTasks} onValueChange={value=>updateSettings({regularMaxTasks:value})}/></label><label className="field"><span>学习日最多任务</span><NumericInput commitMode="blur" min={1} max={100} value={state.settings.studyMaxTasks} onValueChange={value=>updateSettings({studyMaxTasks:value})}/></label><label className="field"><span>均衡方案目标利用率（%）</span><NumericInput commitMode="blur" min={50} max={100} value={Math.round(state.settings.targetUtilization*100)} onValueChange={value=>updateSettings({targetUtilization:value/100})}/></label><label className="field"><span>接近满载提示线（%）</span><NumericInput commitMode="blur" min={60} max={100} value={Math.round(state.settings.nearFullThreshold*100)} onValueChange={value=>updateSettings({nearFullThreshold:value/100})}/></label><label className="field"><span>缓冲日目标利用率（%）</span><NumericInput commitMode="blur" min={0} max={80} value={Math.round(state.settings.bufferUtilization*100)} onValueChange={value=>updateSettings({bufferUtilization:value/100})}/></label><label className="field"><span>小范围调整优先半径（天）</span><NumericInput commitMode="blur" min={1} max={14} value={state.settings.localRepairRadius} onValueChange={value=>updateSettings({localRepairRadius:value})}/></label><label className="field"><span>单日尽量最多新增任务</span><NumericInput commitMode="blur" min={0} max={10} value={state.settings.maxNewTasksPerDay} onValueChange={value=>updateSettings({maxNewTasksPerDay:value})}/></label><label className="field"><span>单日负载变化预算（%容量）</span><NumericInput commitMode="blur" min={0} max={100} value={Math.round(state.settings.maxLoadChangeRatio*100)} onValueChange={value=>updateSettings({maxLoadChangeRatio:value/100})}/></label><label className="field"><span>单类别建议占比上限（%）</span><NumericInput commitMode="blur" min={30} max={100} value={Math.round(state.settings.subjectShareLimit*100)} onValueChange={value=>updateSettings({subjectShareLimit:value/100})}/></label></div></SettingsSection>
    <SettingsSection title="每日容量" description="设置各类日期的默认可用时间。某天是否为学习日，请在月历中修改日期类型。"><div className="form-grid three"><label className="field"><span>常规日（分钟）</span><NumericInput commitMode="blur" min={0} max={1440} value={state.settings.regularMinutes} onValueChange={value=>prepareSettingsChange({regularMinutes:value}, '调整常规日默认容量', 'availability-change')}/></label><label className="field"><span>学习日（分钟）</span><NumericInput commitMode="blur" min={0} max={1440} value={state.settings.studyMinutes} onValueChange={value=>prepareSettingsChange({studyMinutes:value}, '调整学习日默认容量', 'availability-change')}/></label><label className="field"><span>旅游日（分钟）</span><NumericInput commitMode="blur" min={0} max={1440} value={state.settings.travelMinutes} onValueChange={value=>prepareSettingsChange({travelMinutes:value}, '调整旅游日默认容量', 'availability-change')}/></label></div><div className="toggle-grid"><Toggle checked={state.settings.countWordsTime} onChange={value=>updateSettings({countWordsTime:value})} label="把每日单词计入正式计划与统计时间"/><Toggle checked={state.settings.showWarnings} onChange={value=>updateSettings({showWarnings:value})} label="显示进度风险提醒"/><Toggle checked={state.settings.optionalReview} onChange={value=>updateSettings({optionalReview:value})} label="当天任务全部完成时自动打开复盘（入口始终保留）"/><Toggle checked={state.settings.keepOfflineOnLogout} onChange={value=>updateSettings({keepOfflineOnLogout:value})} label="退出登录后保留个人离线缓存"/></div></SettingsSection>
    <CalendarConstraintManager onPrepared={onPrepared}/>
    <SettingsSection title="自定义科目／类别" description="保留学习预设，同时允许增加自己的类别；存储层不会把产品永久限制为学校科目。"><div className="custom-subject-editor"><div className="button-wrap"><input value={subjectDraft} onChange={event=>setSubjectDraft(event.target.value)} placeholder="例如：数学竞赛、研究项目"/><button className="primary-button" onClick={addSubject}>添加</button></div><div className="tag-list">{state.settings.customSubjects.map(item=><span key={item}>{item}<button aria-label={`删除${item}`} onClick={()=>updateSettings({customSubjects:state.settings.customSubjects.filter(subject=>subject!==item)})}>×</button></span>)}</div></div></SettingsSection>
    <SettingsSection title="自适应时长建议" description="只使用最近有效样本生成建议，不自动覆盖预计或移动日历；孤立异常值按 IQR 规则降低影响。"><div className="form-grid three"><label className="field"><span>历史窗口（最近完成数）</span><NumericInput commitMode="blur" min={3} max={50} value={state.settings.duration.windowSize} onValueChange={value=>updateSettings({duration:{...state.settings.duration,windowSize:value}})}/></label><label className="field"><span>最少样本数</span><NumericInput commitMode="blur" min={2} max={20} value={state.settings.duration.minimumSamples} onValueChange={value=>updateSettings({duration:{...state.settings.duration,minimumSamples:value}})}/></label><label className="field"><span>偏差提示阈值（%）</span><NumericInput commitMode="blur" min={5} max={100} value={Math.round(state.settings.duration.deviationThreshold*100)} onValueChange={value=>updateSettings({duration:{...state.settings.duration,deviationThreshold:value/100}})}/></label></div><Toggle checked={state.settings.duration.enabled} onChange={value=>updateSettings({duration:{...state.settings.duration,enabled:value}})} label="启用复盘中的时长建议"/></SettingsSection>
    </div></details>
    <details className="settings-advanced"><summary>恢复与维护</summary><div className="settings-advanced-body">
    <SettingsSection title="计划版本与恢复" description="重大变更保存为本机版本，最多 10 个。完整历史当前仅存于此设备，不进入普通 Supabase 自动保存载荷。"><div className="history-list">{state.planVersions.length?[...state.planVersions].reverse().map(version=><div className="history-row" key={version.id}><div><strong>{version.reason}</strong><span>{new Date(version.timestamp).toLocaleString()} · 移动 {version.summary.movedTaskCount} 项 · 影响 {version.summary.affectedDateCount} 日</span><small>本机版本 · schema v{version.schemaVersion}</small></div><div className="button-wrap"><button className="secondary-button" onClick={()=>setVersionOpen(version)}>查看恢复差异</button></div></div>):<p className="muted-text">还没有重大计划版本。</p>}</div></SettingsSection>
    {state.replanHistory.length > 0 && <SettingsSection title="旧版恢复记录" description="仅在检测到旧版本历史时显示。"><div className="history-list">{[...state.replanHistory].reverse().map(entry=><div className="history-row" key={entry.id}><div><strong>{entry.label}</strong><span>{new Date(entry.createdAt).toLocaleString()} · 移动 {entry.moveCount} 项</span></div><div className="button-wrap">{entry.afterSnapshot&&<button className="secondary-button" onClick={()=>setHistoryEntry(entry)}>查看差异</button>}<button className="secondary-button" onClick={()=>restoreReplanHistory(entry.id)}>恢复</button></div></div>)}</div></SettingsSection>}
    </div></details>
    <SettingsSection title="数据与恢复" description={`当前数据空间：${namespace==='guest'?'游客演示':sessionEmail??'个人账号'}。JSON 备份可能包含个人计划，请妥善保管。`}><div className="button-wrap"><button className="secondary-button" onClick={exportJson}><Download size={16}/>导出 JSON</button><button className="secondary-button" onClick={exportCsv}><FileDown size={16}/>导出 CSV</button><button className="secondary-button" onClick={()=>window.print()}><FileDown size={16}/>打印 / 导出 PDF</button><button className="secondary-button" onClick={()=>fileRef.current?.click()}><Upload size={16}/>导入 JSON</button><input ref={fileRef} type="file" accept="application/json" hidden onChange={event=>event.target.files?.[0]&&importJson(event.target.files[0])}/><button className="secondary-button" disabled={!canUndo} onClick={undo}><RotateCcw size={16}/>恢复上一步</button>{namespace==='guest'&&<><button className="secondary-button" onClick={()=>window.confirm('恢复完整功能演示计划？当前游客修改会被覆盖。')&&resetAll('demo')}>恢复演示计划</button><button className="secondary-button" onClick={()=>window.confirm('从空白计划开始？当前游客数据会被清空。')&&resetAll('blank')}>从空白开始</button></>}<button className="danger-button" onClick={()=>window.confirm('确认重置当前数据空间？请先导出备份。')&&resetAll(namespace==='guest'?'demo':'blank')}><Trash2 size={16}/>重置计划</button></div>{state.conflictBackups.length>0&&<div className="conflict-backups"><strong>同步冲突备份</strong><p>不同设备冲突会保留副本，不静默覆盖。</p>{state.conflictBackups.slice(-5).reverse().map((raw,index)=><div key={index}><span>备份 {state.conflictBackups.length-index}</span><div className="button-wrap"><button className="text-button" onClick={()=>restoreConflict(raw)}>恢复</button><button className="text-button" onClick={()=>downloadBlob(raw,`study-plan-conflict-${index+1}.json`,'application/json')}>下载</button></div></div>)}</div>}</SettingsSection>
    {supabaseConfigured && <SettingsSection title="账号与同步" description="登录不会覆盖游客计划；首次使用账号时可选择是否导入。">{sessionEmail?<div className="cloud-panel"><div><Cloud size={20}/><span>已登录：{sessionEmail}</span></div><div className="button-wrap"><button className="secondary-button" onClick={cloudUpload}>立即上传</button><button className="secondary-button" onClick={cloudDownload}>从云端恢复</button><button className="secondary-button" onClick={()=>signOut()}>退出登录</button></div></div>:<div className="auth-form"><input type="email" placeholder="邮箱" value={email} onChange={event=>setEmail(event.target.value)}/><input type="password" placeholder="密码" value={password} onChange={event=>setPassword(event.target.value)}/><button className="primary-button" onClick={()=>login('in')}>登录</button><button className="secondary-button" onClick={()=>login('up')}>注册</button></div>}{(authMessage||cloudMessage)&&<p className="settings-message">{authMessage||cloudMessage}</p>}</SettingsSection>}

    <Modal open={Boolean(replacementPreview)} title="覆盖当前计划前预览" onClose={()=>setReplacementPreview(undefined)} wide mobileFullscreen>{replacementPreview&&<><p><strong>{replacementPreview.label}</strong></p><div className="proposal-summary-grid"><div><strong>{state.assignments.length} → {replacementPreview.state.assignments.length}</strong><span>任务</span></div><div><strong>{state.goals.length} → {replacementPreview.state.goals.length}</strong><span>目标</span></div><div><strong>{state.calendarConstraints.length} → {replacementPreview.state.calendarConstraints.length}</strong><span>日期约束</span></div><div><strong>{state.assignments.filter(item=>item.status==='done').length} → {replacementPreview.state.assignments.filter(item=>item.status==='done').length}</strong><span>已完成记录</span></div></div><div className="alert warning"><Sparkles size={18}/><div><strong>当前状态会先进入撤销历史</strong><span>恢复或导入后可立即使用“恢复上一步”；本机计划版本不会被普通云端恢复覆盖。</span></div></div><div className="modal-actions"><button className="secondary-button" onClick={()=>setReplacementPreview(undefined)}>取消</button><button className="primary-button" onClick={()=>{replaceState(replacementPreview.state,true);setReplacementPreview(undefined);setAuthMessage('已完成恢复，可使用“恢复上一步”撤销')}}>确认覆盖</button></div></>}</Modal>
    <HistoryDiffDialog entry={historyEntry} onClose={()=>setHistoryEntry(undefined)}/>
    <Modal open={Boolean(versionOpen)} title="恢复计划版本前预览" onClose={()=>setVersionOpen(undefined)} wide mobileFullscreen>{versionOpen&&versionDiff&&<><p><strong>{versionOpen.reason}</strong><br/><span className="muted-text">恢复前会先保存当前计划；实际用时、进度、完成状态、完成日期、计时器和复盘记录不会被旧快照覆盖。</span></p><div className="proposal-summary-grid"><div><strong>{versionDiff.moved.length}</strong><span>任务日期变化</span></div><div><strong>{versionDiff.added.length}</strong><span>将增加</span></div><div><strong>{versionDiff.removed.length}</strong><span>将移除</span></div><div><strong>{versionDiff.goalChanges.length}</strong><span>目标变化</span></div></div><details open><summary>任务日期变化（{versionDiff.moved.length}）</summary><ul>{versionDiff.moved.map(item=><li key={item.id}>{item.title}：{item.from??'未安排'} → {item.to??'未安排'}</li>)}</ul></details><details><summary>增加／移除任务</summary><ul>{versionDiff.added.map(item=><li key={`a-${item.id}`}>增加：{item.title}</li>)}{versionDiff.removed.map(item=><li key={`r-${item.id}`}>移除：{item.title}</li>)}</ul></details><details><summary>目标变化（{versionDiff.goalChanges.length}）</summary><ul>{versionDiff.goalChanges.map(item=><li key={item.id}>{item.title}：{item.before??'无'} → {item.after??'无'}</li>)}</ul></details><div className="modal-actions"><button className="secondary-button" onClick={()=>setVersionOpen(undefined)}>取消</button><button className="primary-button" onClick={()=>{restorePlanVersion(versionOpen.id);setVersionOpen(undefined)}}>恢复此版本</button></div></>}</Modal>
  </div>
}

function SettingsSection({title,description,children}:{title:string;description:string;children:React.ReactNode}){return <section className="settings-section"><div><h2>{title}</h2><p>{description}</p></div><div>{children}</div></section>}
function Toggle({checked,onChange,label}:{checked:boolean;onChange:(v:boolean)=>void;label:string}){return <label className="switch-row"><button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked?'on':''}`} onClick={()=>onChange(!checked)}><i/></button><span>{label}</span></label>}
function EmptyState({title,text}:{title:string;text:string}){return <div className="empty-state"><CheckCircle2 size={30}/><h3>{title}</h3><p>{text}</p></div>}
function downloadBlob(content:string,name:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function csvEscape(v:string){return `"${v.replaceAll('"','""')}"`}
