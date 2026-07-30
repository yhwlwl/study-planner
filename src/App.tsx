import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BarChart3, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Cloud, CloudOff, Target,
  Download, FileDown, Filter, LayoutDashboard, ListTodo, Lock, Menu, Plus, RefreshCw,
  RotateCcw, Search, Settings as SettingsIcon, Sparkles, Trash2, Upload, X
} from 'lucide-react'
import { addMonths, endOfMonth, format, getDay, isWithinInterval, parseISO, startOfMonth } from 'date-fns'
import { useApp } from './AppContext'
import type { AppState, Assignment, BufferPreference, DayType, PlanChangeEvent, Priority, ReplanBundle, ReplanRequest, SchedulingProposal, SequenceRenumberSuggestion, Subject, TaskGroup } from './types'
import { clampDate, dateRange, dayTypeLabel, fmtDate, fmtWeekday, getCapacity, getDayConfig, minutesText, shiftDate, todayISO } from './lib/date'
import { analyzePlan, checkAssignmentPlacement, effectiveMinutes, getDurationSuggestion, planningDayLoad, predictCompletion, suggestMoveDates } from './lib/planner'
import { allGoalProgress } from './lib/goals'
import { uid } from './lib/id'
import { cloneActiveState } from './lib/state'
import { buildBlankState, buildGuestDemoState, normalizeState } from './lib/seed'
import { loadLocalState } from './lib/db'
import { Modal } from './components/Modal'
import { Drawer } from './components/Drawer'
import { TaskCard } from './components/TaskCard'
import { ReplanDialog } from './components/ReplanDialog'
import { TaskGroupDialog } from './components/TaskGroupDialog'
import { SingleTaskDialog } from './components/SingleTaskDialog'
import { ProposalDialog } from './components/ProposalDialog'
import { GoalsPage } from './components/GoalsPage'
import { CalendarConstraintManager } from './components/CalendarConstraintManager'
import { ReviewDialog } from './components/ReviewDialog'
import { HistoryDiffDialog } from './components/HistoryDiffDialog'
import { FocusTimerPage, getTimerElapsedSeconds } from './components/FocusTimerPage'
import { StatsPage } from './components/StatsPage'
import { NumericInput } from './components/NumericInput'
import { downloadSnapshot, getSession, preparePortableState, signIn, signOut, signUp, supabase, supabaseConfigured, uploadSnapshot } from './lib/supabase'
import './styles.css'

type Page = 'today' | 'calendar' | 'tasks' | 'goals' | 'stats' | 'settings' | 'timer'
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
  { id: 'tasks', label: '全部任务', icon: ListTodo },
  { id: 'goals', label: '目标', icon: Target },
  { id: 'stats', label: '统计', icon: BarChart3 },
  { id: 'settings', label: '设置', icon: SettingsIcon }
]

export default function App() {
  const {
    state, namespace, ready, updateSettings, previewReplan, applyReplan, prepareSingleAssignment, prepareTaskGroup,
    generateProposals, applySchedulingProposal, applyPreparedWithoutScheduling, replaceState, loadDataSpace, setDataSpace, clearDataSpace, sequenceRenumberSuggestion,
    dismissSequenceRenumberSuggestion, applySequenceRenumber
  } = useApp()
  const [page, setPage] = useState<Page>('today')
  const [singleTaskOpen, setSingleTaskOpen] = useState(false)
  const [singleTaskDate, setSingleTaskDate] = useState<string>()
  const [singleTaskIntent, setSingleTaskIntent] = useState<'system'|'prefer-date'|'lock-date'>('system')
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [reviewDate, setReviewDate] = useState<string>()
  const [proposalSession, setProposalSession] = useState<{ baseline: AppState; prepared: AppState; event: PlanChangeEvent; proposals: SchedulingProposal[] }>()
  const [proposalGeneration, setProposalGeneration] = useState<{ baseline: AppState; prepared: AppState; event: PlanChangeEvent; worker?: Worker; error?: string }>()
  const [mobileNav, setMobileNav] = useState(false)
  const [replan, setReplan] = useState<ReplanBundle>()
  const [replanOpen, setReplanOpen] = useState(false)
  const [replanRequest, setReplanRequest] = useState<ReplanRequest>({ mode: 'repair', fromDate: todayISO(), freezeDays: 2, todayExtraMinutes: 0, allowBufferUseDates: [], limitOverrides: [] })
  const [replanBaseState, setReplanBaseState] = useState<AppState>()
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string }>()
  const [cloudReady, setCloudReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('local')
  const [firstLoginOpen, setFirstLoginOpen] = useState(false)
  const [cloudMessage, setCloudMessage] = useState('')
  const [dataSwitching, setDataSwitching] = useState(false)
  const previousUserId = useRef<string>()
  const guestSnapshotRef = useRef<AppState>()
  const [guestImportAvailable, setGuestImportAvailable] = useState(false)
  const stateRef = useRef(state)
  const cloudSaveQueue = useRef<CloudSaveQueue>({})
  stateRef.current = state

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
    if (!supabase) return
    const applySession = async (session: Session | null) => {
      const user = session ? { id: session.user.id, email: session.user.email } : undefined

      // Supabase may emit TOKEN_REFRESHED / SIGNED_IN again when a background tab
      // becomes visible. That is not an account change. Starting the privacy
      // overlay for the same user would leave it waiting for a bootstrap effect
      // whose dependency (user id) has not changed.
      if (user && previousUserId.current === user.id) {
        setSessionUser(current => (
          current?.id === user.id && current.email === user.email ? current : user
        ))
        return
      }

      // Repeated anonymous-session events are also no-ops.
      if (!user && !previousUserId.current) {
        setSessionUser(undefined)
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
    getSession().then(session => void applySession(session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { void applySession(session) })
    return () => data.subscription.unsubscribe()
  }, [clearDataSpace, loadDataSpace])

  useEffect(() => {
    if (!ready || !sessionUser?.id) return
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
  }, [ready, sessionUser?.id, loadDataSpace, setDataSpace])

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

  const openReplan = (patch?: Partial<ReplanRequest>, baseState?: AppState) => {
    const source = baseState ?? state
    const request: ReplanRequest = {
      mode: 'repair',
      fromDate: todayISO(),
      freezeDays: source.settings.freezeDays,
      todayExtraMinutes: 0,
      allowBufferUseDates: [],
      limitOverrides: [],
      localRadius: source.settings.localRepairRadius,
      ...patch
    }
    setReplanRequest(request)
    setReplanBaseState(baseState)
    setReplan(previewReplan(request, baseState))
    setReplanOpen(true)
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

  const openPrepared = (prepared: AppState, event: PlanChangeEvent) => {
    const baseline = stateRef.current
    if (typeof Worker === 'undefined') {
      const proposals = generateProposals(prepared, event, baseline)
      setProposalSession({ baseline, prepared, event, proposals })
      return
    }
    const worker = new Worker(new URL('./workers/proposal.worker.ts', import.meta.url), { type: 'module' })
    setProposalGeneration({ baseline, prepared, event, worker })
    worker.onmessage = (message: MessageEvent<{ ok: boolean; proposals?: SchedulingProposal[]; message?: string }>) => {
      worker.terminate()
      if (message.data.ok) {
        setProposalGeneration(undefined)
        setProposalSession({ baseline, prepared, event, proposals: message.data.proposals ?? [] })
      } else setProposalGeneration({ baseline, prepared, event, error: message.data.message ?? '方案计算失败' })
    }
    worker.onerror = eventValue => {
      worker.terminate()
      setProposalGeneration({ baseline, prepared, event, error: eventValue.message || '方案计算失败' })
    }
    worker.postMessage({ preparedState: prepared, baseline, event })
  }
  const cancelProposalGeneration = () => {
    proposalGeneration?.worker?.terminate()
    setProposalGeneration(undefined)
  }

  const openSingleTask = (date?: string, intent: 'system'|'prefer-date'|'lock-date' = date ? 'prefer-date' : 'system') => {
    setSingleTaskDate(date)
    setSingleTaskIntent(intent)
    setSingleTaskOpen(true)
  }


  if (!ready || dataSwitching) return <div className="loading-screen"><div className="spinner"/><p>{dataSwitching ? '正在安全切换数据空间……' : '正在载入学习计划……'}</p></div>

  if (page === 'timer') return <FocusTimerPage onExit={() => setPage('today')}/>

  return (
    <div className={`app-shell ${state.settings.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className={`sidebar ${mobileNav ? 'sidebar-mobile-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><CheckCircle2 size={22}/></div><div><strong>学习计划</strong><small>{state.settings.planName}</small></div></div>
        <nav>
          {navItems.map(item => {
            const Icon = item.icon
            return <button key={item.id} className={page === item.id ? 'nav-active' : ''} onClick={() => { setPage(item.id); setMobileNav(false) }}><Icon size={19}/><span>{item.label}</span></button>
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className={`sync-status ${sessionUser ? 'online' : ''} ${syncStatus === 'error' ? 'sync-error' : ''}`}>{sessionUser ? <Cloud size={16}/> : <CloudOff size={16}/>}<span>{!sessionUser ? '游客演示 · 仅本地保存' : syncStatus === 'restoring' ? '正在从云端恢复' : syncStatus === 'queued' ? '已保存到本机 · 等待云同步' : syncStatus === 'saving' ? '正在同步到云端' : syncStatus === 'error' ? '云同步失败' : cloudReady ? '已自动保存到云端' : '等待初始化个人计划'}</span></div>
          <button className="collapse-button" onClick={() => updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed })}><ChevronLeft size={18}/><span>收起侧边栏</span></button>
        </div>
      </aside>
      {mobileNav && <button className="mobile-overlay" onClick={() => setMobileNav(false)} aria-label="关闭菜单"/>}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21}/></button>
          <div className="page-heading"><h1>{navItems.find(n => n.id === page)?.label}</h1><span>{format(new Date(), 'yyyy年M月d日')}</span></div>
          <div className="topbar-actions"><ActiveTimerReturnButton onOpen={() => setPage('timer')}/><button className="secondary-button" onClick={() => openReplan()}><RefreshCw size={16}/>计划调整</button></div>
        </header>
        <div className="page-content">
          {page === 'today' && <TodayPage onNavigate={setPage} onReplan={date => openReplan({ mode: 'repair', fromDate: date })} onAddTask={() => openSingleTask(clampDate(todayISO(), state.settings.startDate, state.settings.endDate), 'prefer-date')} onReview={setReviewDate}/>} 
          {page === 'calendar' && <CalendarPage onReplan={(date, baseState) => openReplan({ mode: 'repair', fromDate: date }, baseState)} onAddTask={date => openSingleTask(date, 'prefer-date')}/>} 
          {page === 'tasks' && <TasksPage onAddSingle={() => openSingleTask()} onCreateGroup={() => setGroupDialogOpen(true)} onPrepared={openPrepared}/>} 
          {page === 'goals' && <GoalsPage onPrepared={openPrepared}/>} 
          {page === 'stats' && <StatsPage onOpenReplan={date => openReplan({ mode: 'repair', fromDate: date })}/>} 
          {page === 'settings' && <SettingsPage sessionUserId={sessionUser?.id} sessionEmail={sessionUser?.email} cloudMessage={cloudMessage} onCloudUpload={uploadCloudNow} onPrepared={openPrepared}/>} 
        </div>
      </main>
      <SingleTaskDialog open={singleTaskOpen} state={state} defaultDate={singleTaskDate} defaultIntent={singleTaskIntent} onClose={() => setSingleTaskOpen(false)} onSubmit={draft => {
        const prepared = prepareSingleAssignment(draft)
        setSingleTaskOpen(false)
        openPrepared(prepared.state, prepared.event)
      }}/>
      <TaskGroupDialog open={groupDialogOpen} state={state} onClose={() => setGroupDialogOpen(false)} onCreate={(draft, schedule) => {
        const prepared = prepareTaskGroup(draft)
        setGroupDialogOpen(false)
        if (schedule) openPrepared(prepared.state, prepared.event)
        else applyPreparedWithoutScheduling(prepared.state, prepared.event, '创建为未安排任务')
      }}/>
      {proposalGeneration && <Modal open title="正在生成计划调整方案" onClose={cancelProposalGeneration}>
        <div className="proposal-generation-state"><div className={proposalGeneration.error ? 'proposal-generation-error' : 'spinner'}/><h3>{proposalGeneration.error ? '方案计算未完成' : proposalGeneration.event.title}</h3><p>{proposalGeneration.error ?? '正在独立线程中核对容量、上限、目标期限、手动安排和日期保护。取消不会修改当前计划。'}</p></div>
        <div className="modal-actions"><button className="secondary-button" onClick={cancelProposalGeneration}>{proposalGeneration.error ? '关闭' : '取消计算'}</button>{proposalGeneration.error && <button className="primary-button" onClick={() => { const { prepared, event, baseline } = proposalGeneration; setProposalGeneration(undefined); const proposals = generateProposals(prepared, event, baseline); setProposalSession({ baseline, prepared, event, proposals }) }}>在当前线程重试</button>}</div>
      </Modal>}
      {proposalSession && <ProposalDialog open baseline={proposalSession.baseline} preparedState={proposalSession.prepared} event={proposalSession.event} proposals={proposalSession.proposals} onClose={() => setProposalSession(undefined)} onKeep={() => { applyPreparedWithoutScheduling(proposalSession.prepared, proposalSession.event, '保持现有日期或保留为未安排'); setProposalSession(undefined) }} onApply={proposal => { applySchedulingProposal(proposal, proposalSession.event); setProposalSession(undefined) }}/>} 
      <ReviewDialog open={Boolean(reviewDate)} date={reviewDate ?? todayISO()} onClose={() => setReviewDate(undefined)} onPreparedDuration={openPrepared}/>
      <SequenceRenumberDialog
        suggestion={sequenceRenumberSuggestion}
        onKeep={dismissSequenceRenumberSuggestion}
        onApply={applySequenceRenumber}
      />
      <ReplanDialog
        bundle={replan}
        currentState={replanBaseState ?? state}
        open={replanOpen}
        request={replanRequest}
        onRequestChange={setReplanRequest}
        onRegenerate={nextRequest => setReplan(previewReplan(nextRequest ?? replanRequest, replanBaseState))}
        onClose={() => { setReplanOpen(false); setReplanBaseState(undefined) }}
        onApply={(result, editedState, audit) => { applyReplan(result, editedState, audit); setReplanOpen(false); setReplanBaseState(undefined) }}
      />
      <Modal open={firstLoginOpen} title="欢迎使用 · 选择个人计划起点" onClose={() => {}}>
        <p className="onboarding-copy">云端还没有你的计划。游客数据不会被静默上传；请选择个人账号的独立起点。</p>
        <div className="template-options">
          {guestImportAvailable && <button onClick={() => void initializeAccount('import')}><strong>导入已修改的游客计划</strong><span>复制任务、任务组、目标、日期约束和当前执行状态；游客空间仍独立保留。</span></button>}
          <button onClick={() => void initializeAccount('demo')}><strong>使用完整演示计划（推荐）</strong><span>创建一份与游客数据完全独立的真实规模演示计划。</span></button>
          <button onClick={() => void initializeAccount('blank')}><strong>从空白开始</strong><span>创建一个长期使用的新计划。</span></button>
          {guestImportAvailable && <button onClick={() => void initializeAccount('separate')}><strong>保持游客数据独立，不导入</strong><span>账号从空白开始，游客修改继续只保存在本机游客空间。</span></button>}
        </div>
      </Modal>
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

  useEffect(() => {
    setSelectedGroupIds(suggestion?.groups.map(group => group.groupId) ?? [])
  }, [suggestion])

  const sourceLabel = suggestion?.source === 'automatic'
    ? '自动重排后'
    : suggestion?.source === 'mixed'
      ? '本次调整后'
      : '手动调整后'

  return <Modal open={Boolean(suggestion)} title="任务编号顺序发生变化" onClose={onKeep} wide mobileFullscreen>
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

function TodayPage({ onNavigate, onReplan, onAddTask, onReview }: { onNavigate: (page: Page) => void; onReplan: (date: string) => void; onAddTask: () => void; onReview: (date: string) => void }) {
  const { state, namespace, commit, moveAssignments } = useApp()
  const rawToday = todayISO()
  const defaultDate = clampDate(rawToday, state.settings.startDate, state.settings.endDate)
  const [date, setDate] = useState(defaultDate)
  const [completeTarget, setCompleteTarget] = useState<Assignment>()
  const [actual, setActual] = useState('')
  const [progress, setProgress] = useState(100)
  const [endTodayOpen, setEndTodayOpen] = useState(false)
  const [carryDates, setCarryDates] = useState<Record<string,string>>({})
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shiftScope, setShiftScope] = useState<ShiftScope>('future')
  const [shiftDays, setShiftDays] = useState(1)
  const [shiftLocked, setShiftLocked] = useState(false)
  const groups = useMemo(() => new Map(state.taskGroups.map(g => [g.id, g])), [state.taskGroups])
  const tasks = state.assignments.filter(a => a.scheduledDate === date).sort((a,b) => (groups.get(b.groupId)?.priority ?? 0) - (groups.get(a.groupId)?.priority ?? 0) || a.status.localeCompare(b.status))
  const counted = tasks.filter(a => groups.get(a.groupId)?.countInStats || state.settings.countWordsTime)
  const planned = counted.reduce((sum,a) => sum + effectiveMinutes(a), 0)
  const actualTotal = counted.reduce((sum,a) => sum + a.actualMinutes, 0)
  const done = tasks.filter(a => a.status === 'done').length
  const capacity = getCapacity(state, date)
  const config = getDayConfig(state, date)
  const goalRisks = allGoalProgress(state).filter(item => item.latestRisk || item.desiredRisk)
  const firstRiskGoal = goalRisks.length ? state.goals.find(goal => goal.id === goalRisks[0].goalId) : undefined
  const risk = planned > capacity ? `今日计划超过容量 ${minutesText(planned - capacity)}` : firstRiskGoal ? `目标“${firstRiskGoal.title}”存在${goalRisks[0].latestRisk ? '最晚日期' : '期望日期'}风险` : undefined
  useEffect(() => {
    if (tasks.length > 0 && tasks.every(item => item.status === 'done') && !state.reviewRecords.some(item => item.date === date)) onReview(date)
  }, [tasks.length, done, date, state.reviewRecords, onReview])

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
      if (assignment.locked && !shiftLocked) { ignoredLocked += 1; continue }
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
  }, [state, groups, date, shiftScope, shiftDays, shiftLocked, shiftOpen])

  const applyShift = () => {
    const days = Math.max(1, Math.min(14, Math.round(shiftDays || 1)))
    commit(draft => {
      const movedAt = new Date().toISOString()
      for (const assignment of draft.assignments) {
        const group = draft.taskGroups.find(g => g.id === assignment.groupId)
        if (!assignment.scheduledDate || assignment.status === 'done' || group?.recurring) continue
        const inScope = shiftScope === 'today' ? assignment.scheduledDate === date : assignment.scheduledDate >= date
        if (!inScope || (assignment.locked && !shiftLocked)) continue
        const from = assignment.scheduledDate
        const rawTarget = shiftDate(from, days)
        const to = rawTarget > draft.settings.endDate ? draft.settings.endDate : rawTarget
        if (to === from) continue
        assignment.previousDate = from
        assignment.scheduledDate = to
        assignment.lastManualMoveAt = movedAt
        assignment.scheduleSource = 'carryover'
        assignment.intentStrength = assignment.locked ? 'locked' : 'manual'
      }
    })
    setShiftOpen(false)
  }

  const moveImpactLabel = (assignment: Assignment, targetDate: string) => {
    const targetLoad = state.assignments
      .filter(item => item.id !== assignment.id && item.scheduledDate === targetDate && item.status !== 'done')
      .reduce((sum, item) => {
        const group = groups.get(item.groupId)
        return sum + ((group?.countInStats || state.settings.countWordsTime) ? effectiveMinutes(item) : 0)
      }, 0)
    const group = groups.get(assignment.groupId)
    const own = group && (group.countInStats || state.settings.countWordsTime) ? effectiveMinutes(assignment) : 0
    const projected = targetLoad + own
    const targetCapacity = getCapacity(state, targetDate)
    return `${targetDate} · ${minutesText(projected)} / ${minutesText(targetCapacity)}${projected > targetCapacity ? '（超载）' : ''}`
  }

  const prepareCarryover = (sourceDate: string) => {
    const sourceTasks = state.assignments.filter(a => a.scheduledDate === sourceDate && a.status !== 'done' && !groups.get(a.groupId)?.recurring)
    const initial: Record<string,string> = {}
    for (const assignment of sourceTasks) initial[assignment.id] = suggestMoveDates(state, assignment.id, 8).find(candidate => candidate > sourceDate) ?? assignment.scheduledDate ?? sourceDate
    setDate(sourceDate)
    setCarryDates(initial)
    setEndTodayOpen(true)
  }

  useEffect(() => {
    const current = todayISO()
    if (current <= state.settings.startDate) return
    const previousDate = state.assignments
      .filter(a => a.status !== 'done' && a.scheduledDate && a.scheduledDate < current && !groups.get(a.groupId)?.recurring)
      .map(a => a.scheduledDate!)
      .sort()
      .at(-1)
    if (!previousDate) return
    const promptKey = `study-planner:carryover-prompt:${namespace}:${current}`
    if (window.sessionStorage.getItem(promptKey)) return
    window.sessionStorage.setItem(promptKey, '1')
    const id = window.setTimeout(() => prepareCarryover(previousDate), 350)
    return () => window.clearTimeout(id)
  }, [namespace, state.settings.startDate, state.assignments, groups])

  const openComplete = (a: Assignment) => { setCompleteTarget(a); setActual(''); setProgress(100) }
  const saveCompletion = (finish: boolean) => {
    if (!completeTarget) return
    const minutes = Math.max(0, Number(actual) || 0)
    commit(draft => {
      const item = draft.assignments.find(a => a.id === completeTarget.id)
      if (!item) return
      if (minutes) {
        item.actualMinutes += minutes
        item.timeEntries.push({ id: uid('time'), minutes, createdAt: new Date().toISOString(), source: 'manual' })
      }
      item.progress = finish ? 100 : Math.min(99, Math.max(1, progress))
      item.remainingMinutes = finish ? 0 : effectiveMinutes(item)
      item.status = finish ? 'done' : 'partial'
      item.completedAt = finish ? new Date().toISOString() : undefined
      if (draft.timer.assignmentId === item.id) draft.timer = { accumulatedSeconds: 0, running: false }
    })
    setCompleteTarget(undefined)
  }

  return <>
    <section className="today-hero">
      <div>
        <div className="date-switcher"><button className="icon-button" onClick={() => setDate(clampDate(format(new Date(parseISO(date).getTime()-86400000),'yyyy-MM-dd'), state.settings.startDate,state.settings.endDate))}><ChevronLeft size={19}/></button><div><h2>{fmtDate(date, 'M月d日')} · {fmtWeekday(date)}</h2><span className={`day-badge day-${config.type}`}>{dayTypeLabel[config.type]}</span></div><button className="icon-button" onClick={() => setDate(clampDate(format(new Date(parseISO(date).getTime()+86400000),'yyyy-MM-dd'), state.settings.startDate,state.settings.endDate))}><ChevronRight size={19}/></button></div>
        <p>{tasks.length ? `今天有 ${tasks.length} 项任务，预计 ${minutesText(planned)}。` : '今天暂时没有安排任务。'}</p>
      </div>
      <div className="button-wrap"><button className="primary-button subtle-action" onClick={onAddTask}><Plus size={16}/>添加任务</button><button className="secondary-button" onClick={() => onNavigate('calendar')}><CalendarDays size={16}/>打开月历</button><button className="secondary-button" onClick={()=>setShiftOpen(true)}>整体顺延</button><button className="secondary-button" onClick={() => onReview(date)}>结束学习并复盘</button>{tasks.some(t=>t.status!=='done'&&!groups.get(t.groupId)?.recurring)&&<button className="secondary-button" onClick={()=>prepareCarryover(date)}>结束今天</button>}</div>
    </section>
    <section className="compact-metrics">
      <div><span>预计时间</span><strong>{minutesText(planned)}</strong></div>
      <div><span>实际记录</span><strong>{minutesText(actualTotal)}</strong></div>
      <div><span>完成情况</span><strong>{done}/{tasks.length}</strong></div>
      <div><span>当日容量</span><strong>{minutesText(capacity)}</strong></div>
    </section>
    {state.settings.showWarnings && risk && <div className="alert warning"><Sparkles size={18}/><div><strong>进度提醒</strong><span>{risk}</span></div></div>}
    <section className="section-block">
      <div className="section-title"><div><h2>今日任务</h2><p>完成后勾选，可录入精确到 1 分钟的实际用时。</p></div></div>
      <div className="task-list">{tasks.length ? tasks.map(a => <TaskCard key={a.id} assignment={a} group={groups.get(a.groupId)!} onComplete={openComplete} onOpenTimer={() => onNavigate('timer')}/>) : <EmptyState title="今天没有任务" text="可以到月历调整计划，或把今天设为休息日。"/>}</div>
    </section>
    <Modal open={Boolean(completeTarget)} title={completeTarget ? `记录：${completeTarget.title}` : '记录任务'} onClose={() => setCompleteTarget(undefined)}>
      <div className="form-stack">
        <label className="field"><span>本次实际用时（分钟，可留空）</span><NumericInput min={0} max={1440} step={1} value={actual === '' ? undefined : Number(actual)} onValueChange={value => setActual(String(value))} onEmpty={() => setActual('')} autoFocus/></label>
        <label className="field"><span>若未完成，填写当前进度</span><NumericInput min={1} max={99} value={progress} onValueChange={setProgress}/></label>
      </div>
      <div className="modal-actions"><button className="secondary-button" onClick={() => saveCompletion(false)}>保存为部分完成</button><button className="primary-button" onClick={() => saveCompletion(true)}>标记完成</button></div>
    </Modal>
    <Modal open={endTodayOpen} title="结束今天 · 处理未完成任务" onClose={()=>setEndTodayOpen(false)} wide mobileFullscreen>
      <p className="muted-text">系统给出推荐日期，你可以逐项修改、保留为逾期，或进入计划调整，比较对当前安排影响不同的方案。</p>
      <div className="carryover-list">{tasks.filter(t=>t.status!== 'done'&&!groups.get(t.groupId)?.recurring).map(a=><div key={a.id} className="carryover-row"><div><strong>{a.title}</strong><span>{groups.get(a.groupId)?.subject} · 当前安排 {a.scheduledDate}</span></div><select value={carryDates[a.id]??''} onChange={e=>setCarryDates(prev=>({...prev,[a.id]:e.target.value}))}><option value="">保留在原日并标记逾期</option>{suggestMoveDates(state,a.id,8).filter(d=>d>date).slice(0,5).map(d=><option key={d} value={d}>{moveImpactLabel(a,d)}</option>)}</select></div>)}</div>
      <div className="modal-actions"><button className="secondary-button" onClick={()=>{setEndTodayOpen(false);onReplan(date)}}>比较完整方案</button><button className="primary-button" onClick={()=>{for(const [id,target] of Object.entries(carryDates))if(target)moveAssignments([id],target,'carryover');setEndTodayOpen(false)}}>应用这些选择</button></div>
    </Modal>
    <Modal open={shiftOpen} title="整体顺延 · 先看影响再应用" onClose={()=>setShiftOpen(false)} wide mobileFullscreen>
      <p className="muted-text">适合“今天完全没时间”的情况。每日重复任务不会移动；你的选择会被记录为手动意图，之后自动重排会优先保留。</p>
      <div className="replan-controls">
        <div className="segmented-control">
          <button className={shiftScope==='today'?'active':''} onClick={()=>setShiftScope('today')}>仅今日未完成</button>
          <button className={shiftScope==='future'?'active':''} onClick={()=>setShiftScope('future')}>从今天起全部</button>
        </div>
        <label className="field compact-field"><span>顺延天数</span><NumericInput min={1} max={14} value={shiftDays} onValueChange={setShiftDays}/></label>
        <label className="lock-choice"><input type="checkbox" checked={shiftLocked} onChange={e=>setShiftLocked(e.target.checked)}/><Lock size={14}/>同时移动已锁定任务</label>
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
      <div className="modal-actions"><button className="secondary-button" onClick={()=>setShiftOpen(false)}>取消</button><button className="primary-button" disabled={!shiftPreview.changes.length} onClick={applyShift}>应用整体顺延</button></div>
    </Modal>
  </>
}

function CalendarPage({ onReplan, onAddTask }: { onReplan: (date: string, baseState?: AppState) => void; onAddTask: (date: string) => void }) {
  const { state, commit, updateAssignment, updateDayConfig, moveAssignments, removeAssignment, moveAssignmentToGroup, reopenAssignment } = useApp()
  const initialCalendarDate = todayISO() >= state.settings.startDate && todayISO() <= state.settings.endDate ? todayISO() : state.settings.startDate
  const [month, setMonth] = useState(startOfMonth(parseISO(initialCalendarDate)))
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [weekStart, setWeekStart] = useState(() => shiftDate(initialCalendarDate, -getDay(parseISO(initialCalendarDate))))
  const [dayOpen, setDayOpen] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [overflowSelectedIds, setOverflowSelectedIds] = useState<string[]>([])
  const [overflowPanel, setOverflowPanel] = useState<{ date: string; top: number; left: number }>()
  const [taskOpenId, setTaskOpenId] = useState<string>()
  const [moveNotice, setMoveNotice] = useState<{ id: string; title: string; date: string }>()
  const [pendingDayType, setPendingDayType] = useState<DayType>()
  const [pendingCustomMinutes, setPendingCustomMinutes] = useState<number>()
  const [pendingAvailabilityMode, setPendingAvailabilityMode] = useState<'default' | 'reduced' | 'rest'>('default')
  const [pendingAvailableMinutes, setPendingAvailableMinutes] = useState<number>(60)
  const [pendingBufferReason, setPendingBufferReason] = useState('')
  const [pendingBufferPreference, setPendingBufferPreference] = useState<BufferPreference>('preserve')
  const [dragAssignmentId, setDragAssignmentId] = useState<string>()
  const [dragTargetDate, setDragTargetDate] = useState<string>()
  const [moveModeTaskId, setMoveModeTaskId] = useState<string>()
  const longPressActivated = useRef(false)
  const touchStartX = useRef<number>()
  const [calendarTaskLimit, setCalendarTaskLimit] = useState(() => window.innerWidth >= 1400 ? 4 : window.innerWidth >= 900 ? 3 : 2)
  const longPressTimer = useRef<number>()
  const groups = useMemo(() => new Map(state.taskGroups.map(group => [group.id, group])), [state.taskGroups])

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

  const tasksFor = (date: string) => sortTasks(state.assignments.filter(assignment => assignment.scheduledDate === date))
  const countedMinutes = (assignment: Assignment) => effectiveMinutes(assignment)
  const loadFor = (date: string) => planningDayLoad(state, date)

  const moveWithValidation = (assignmentId: string, targetDate: string) => {
    const assignment = state.assignments.find(item => item.id === assignmentId)
    const group = assignment && groups.get(assignment.groupId)
    if (!assignment || !group || assignment.locked || assignment.scheduledDate === targetDate) return false
    if (targetDate < state.settings.startDate || targetDate > state.settings.endDate) {
      window.alert('目标日期超出当前计划范围。')
      return false
    }
    const targetConfig = getDayConfig(state, targetDate)
    if (targetConfig.isBufferDay && (targetConfig.bufferProtected ?? targetConfig.userSet) && assignment.scheduledDate !== targetDate) {
      window.alert(`“${targetDate}”是受保护的缓冲日。请先在日期详情中修改可用时间，或在重排预览里明确允许使用。`)
      return false
    }
    const targetLoad = loadFor(targetDate) - (assignment.scheduledDate === targetDate ? countedMinutes(assignment) : 0)
    const projected = targetLoad + countedMinutes(assignment)
    const capacity = getCapacity(state, targetDate)
    const placementChecks = checkAssignmentPlacement(state, assignmentId, targetDate)
    const nonOverrideable = placementChecks.filter(item => ['plan-range', 'past', 'protected-buffer', 'travel-day'].includes(item.key))
    if (nonOverrideable.length) {
      window.alert(nonOverrideable.map(item => item.label).join('；'))
      return false
    }
    const risks = placementChecks.map(item => item.limit > 0 ? `${item.label}：${Math.round(item.current)}/${Math.round(item.limit)}` : item.label)
    if (targetDate > group.targetDate && !risks.some(item => item.includes('目标日期'))) risks.push(`会越过目标日期 ${group.targetDate}`)
    if (projected > capacity && !risks.some(item => item.includes('容量'))) risks.push(`将从 ${minutesText(targetLoad)} 增至 ${minutesText(projected)}，超过容量 ${minutesText(projected - capacity)}`)
    if (risks.length && !window.confirm(`移动“${assignment.title}”到 ${targetDate}？

${risks.join('\n')}

继续即表示仅对这次手动移动接受这些后果。`)) return false
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
    setPendingDayType(current.type)
    setPendingCustomMinutes(current.customMinutes)
    setPendingAvailabilityMode(current.isBufferDay ? (current.availableMinutes === 0 ? 'rest' : 'reduced') : 'default')
    setPendingAvailableMinutes(current.availableMinutes ?? 60)
    setPendingBufferReason(current.bufferReason ?? '')
    setPendingBufferPreference(current.bufferPreference ?? 'preserve')
  }
  const moveCalendarWindow = (direction: -1 | 1) => {
    if (viewMode === 'month') setMonth(addMonths(month, direction))
    else setWeekStart(previous => shiftDate(previous, direction * 7))
  }
  const handleCalendarTouchStart = (event: React.TouchEvent) => { touchStartX.current = event.touches[0]?.clientX }
  const handleCalendarTouchEnd = (event: React.TouchEvent) => {
    if (moveModeTaskId || touchStartX.current === undefined) return
    const delta = event.changedTouches[0]?.clientX - touchStartX.current
    touchStartX.current = undefined
    if (Math.abs(delta) < 55) return
    moveCalendarWindow(delta < 0 ? 1 : -1)
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
  const overflowTasks = overflowPanel ? tasksFor(overflowPanel.date).slice(calendarTaskLimit) : []

  const bulkMoveTo = (ids: string[], target: string) => {
    if (!target || !ids.length) return false
    if (target < state.settings.startDate || target > state.settings.endDate) { window.alert('目标日期超出当前计划范围。'); return false }
    const targetConfig = getDayConfig(state, target)
    if (targetConfig.isBufferDay && (targetConfig.bufferProtected ?? targetConfig.userSet)) { window.alert('目标日期是受保护的缓冲日，不能直接批量移入。'); return false }
    const moving = state.assignments.filter(item => ids.includes(item.id) && !item.locked)
    const previewState = cloneActiveState(state)
    const riskSet = new Set<string>()
    for (const assignment of moving) {
      const checks = checkAssignmentPlacement(previewState, assignment.id, target)
      const nonOverrideable = checks.filter(item => ['plan-range', 'past', 'protected-buffer', 'travel-day'].includes(item.key))
      if (nonOverrideable.length) { window.alert(`${assignment.title}：${nonOverrideable.map(item => item.label).join('；')}`); return false }
      checks.forEach(item => riskSet.add(item.limit > 0 ? `${item.label}：${Math.round(item.current)}/${Math.round(item.limit)}` : item.label))
      const previewAssignment = previewState.assignments.find(item => item.id === assignment.id)
      if (previewAssignment) previewAssignment.scheduledDate = target
    }
    const projected = loadFor(target) + moving.reduce((sum, assignment) => sum + (assignment.scheduledDate === target ? 0 : countedMinutes(assignment)), 0)
    const capacity = getCapacity(state, target)
    const lateTitles = moving.filter(assignment => { const group = groups.get(assignment.groupId); return Boolean(group && target > group.targetDate) }).map(assignment => assignment.title)
    if (projected > capacity) riskSet.add(`预计 ${minutesText(projected)}，超过容量 ${minutesText(projected - capacity)}`)
    if (lateTitles.length) riskSet.add(`${lateTitles.length} 项会越过目标日期`)
    const risks = [...riskSet]
    if (risks.length && !window.confirm(`批量移动到 ${target}？

${risks.join('\n')}

继续即表示仅对这次手动移动接受这些后果。`)) return false
    moveAssignments(ids, target)
    setSelectedIds([])
    setOverflowSelectedIds([])
    return true
  }

  const bulkMove = (ids = selectedIds) => {
    const target = window.prompt('输入目标日期（YYYY-MM-DD）')
    if (target) bulkMoveTo(ids, target)
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

  let dayPreviewState: AppState | undefined
  if (dayOpen && dayCfg) {
    dayPreviewState = cloneActiveState(state)
    const type = pendingDayType ?? dayCfg.type
    const isBufferDay = pendingAvailabilityMode !== 'default'
    const availableMinutes = pendingAvailabilityMode === 'rest' ? 0 : pendingAvailabilityMode === 'reduced' ? Math.max(0, pendingAvailableMinutes) : undefined
    dayPreviewState.dayConfigs[dayOpen] = {
      ...dayCfg,
      date: dayOpen,
      type,
      customMinutes: type === 'custom' ? pendingCustomMinutes ?? dayCfg.customMinutes ?? state.settings.regularMinutes : undefined,
      isBufferDay,
      availableMinutes,
      bufferReason: isBufferDay ? pendingBufferReason.trim() || undefined : undefined,
      bufferPreference: isBufferDay ? pendingBufferPreference : undefined,
      bufferProtected: isBufferDay,
      userSet: true
    }
  }

  return <>
    <section className="calendar-toolbar"><div><h2>{viewMode === 'month' ? format(month, 'yyyy年M月') : `${fmtDate(weekStart)}－${fmtDate(shiftDate(weekStart, 6))}`}</h2><p>月视图看全局，周视图处理任务。手机上长按任务后，再点击目标日期即可移动。</p></div><div className="calendar-toolbar-actions"><div className="segmented-control calendar-view-toggle"><button className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>月</button><button className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>周</button></div><button className="icon-button" onClick={() => moveCalendarWindow(-1)}><ChevronLeft size={19}/></button><button className="secondary-button" onClick={() => { const date = initialCalendarDate; setMonth(startOfMonth(parseISO(date))); setWeekStart(shiftDate(date, -getDay(parseISO(date)))) }}>今天附近</button><button className="icon-button" onClick={() => moveCalendarWindow(1)}><ChevronRight size={19}/></button></div></section>
    {moveNotice && <div className="manual-move-notice"><div><strong>已记录你的手动安排</strong><span>「{moveNotice.title}」已移到 {moveNotice.date}，自动重排会优先保留，也不会近期拉回原日期。</span></div><div className="button-wrap"><button className="secondary-button" onClick={() => { updateAssignment(moveNotice.id, { locked: true }); setMoveNotice(undefined) }}><Lock size={15}/>同时锁定</button><button className="text-button" onClick={() => setMoveNotice(undefined)}>知道了</button></div></div>}
    {moveModeTaskId && <div className="calendar-move-mode"><div><strong>正在移动：{state.assignments.find(item => item.id === moveModeTaskId)?.title}</strong><span>点击月历或周视图中的目标日期。再次长按其他任务可更换对象。</span></div><button className="secondary-button" onClick={() => setMoveModeTaskId(undefined)}>取消移动</button></div>}
    <section className={`calendar-card ${viewMode === 'week' ? 'calendar-week-view' : 'calendar-month-view'}`} onTouchStart={handleCalendarTouchStart} onTouchEnd={handleCalendarTouchEnd}>
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

    <Modal open={Boolean(dayOpen)} title={dayOpen ? `${fmtDate(dayOpen)} · ${fmtWeekday(dayOpen)}` : '日期'} mobileSheet onClose={() => { setDayOpen(undefined); setSelectedIds([]); setPendingDayType(undefined); setPendingCustomMinutes(undefined); setPendingAvailabilityMode('default'); setPendingAvailableMinutes(60); setPendingBufferReason(''); setPendingBufferPreference('preserve') }} wide>
      {dayOpen && dayCfg && dayPreviewState && <>
        <div className="day-settings-row">
          <label className="field"><span>日期类型</span><select value={pendingDayType ?? dayCfg.type} onChange={event => setPendingDayType(event.target.value as DayType)}>{(['regular', 'study', 'travel', 'custom'] as DayType[]).map(type => <option key={type} value={type}>{dayTypeLabel[type]}</option>)}</select></label>
          {(pendingDayType ?? dayCfg.type) === 'custom' && <label className="field"><span>可用分钟</span><NumericInput min={0} max={1440} value={pendingCustomMinutes ?? dayCfg.customMinutes ?? 210} onValueChange={setPendingCustomMinutes}/></label>}
          <label className="field grow"><span>备注</span><input value={dayCfg.note ?? ''} onChange={event => updateDayConfig(dayOpen, { note: event.target.value })} placeholder="例如：外出、下午补课"/></label>
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
          {(pendingDayType ?? dayCfg.type) !== dayCfg.type || ((pendingDayType ?? dayCfg.type) === 'custom' && pendingCustomMinutes !== dayCfg.customMinutes) || pendingAvailabilityMode !== (dayCfg.isBufferDay ? (dayCfg.availableMinutes === 0 ? 'rest' : 'reduced') : 'default') || (pendingAvailabilityMode === 'reduced' && pendingAvailableMinutes !== dayCfg.availableMinutes) || pendingBufferReason !== (dayCfg.bufferReason ?? '') || pendingBufferPreference !== (dayCfg.bufferPreference ?? 'preserve') ? <button className="primary-button" onClick={() => {
            const ordinary = dayPreviewState!.assignments.filter(assignment => assignment.scheduledDate === dayOpen && assignment.status !== 'done' && !groups.get(assignment.groupId)?.recurring)
            const newCapacity = getCapacity(dayPreviewState!, dayOpen)
            const newLoad = planningDayLoad(dayPreviewState!, dayOpen)
            if (ordinary.length && ((pendingDayType ?? dayCfg.type) === 'travel' || newLoad > newCapacity || pendingAvailabilityMode !== 'default')) onReplan(dayOpen, dayPreviewState)
            else updateDayConfig(dayOpen, dayPreviewState!.dayConfigs[dayOpen])
          }}>预览缓冲日调整</button> : <button className="secondary-button" onClick={() => onReplan(dayOpen)}>查看调整建议</button>}
          <button className="secondary-button" disabled={!selectedIds.length} onClick={() => bulkMove()}>批量移动</button>
        </div></div>
        <div className="day-task-list">{dayTasks.map(assignment => <label key={assignment.id} className="select-task-row" onPointerDown={() => startLongPress(assignment.id)} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onPointerMove={cancelLongPress}><input type="checkbox" checked={selectedIds.includes(assignment.id)} onChange={event => setSelectedIds(previous => event.target.checked ? [...previous, assignment.id] : previous.filter(id => id !== assignment.id))}/><button className="select-task-content" onClick={event => { event.preventDefault(); openTaskUnlessLongPressed(assignment.id) }}><strong>{assignment.title}</strong><span>{groups.get(assignment.groupId)?.subject} · {minutesText(assignment.estimatedMinutes)}</span></button>{assignment.locked && <small>已锁定</small>}</label>)}</div>
      </>}
    </Modal>

    <Drawer open={Boolean(taskOpen)} title={taskOpen?.title ?? '任务详情'} subtitle={taskOpenGroup ? `${taskOpenGroup.subject} · 优先级 ${taskOpenGroup.priority}` : undefined} onClose={() => setTaskOpenId(undefined)}>
      {taskOpen && taskOpenGroup && <div className="task-quick-editor">
        <div className="task-detail-metrics"><div><span>预计时间</span><strong>{minutesText(taskOpen.estimatedMinutes)}</strong></div><div><span>状态</span><strong>{taskOpen.status === 'done' ? '已完成' : taskOpen.status === 'partial' ? '部分完成' : '待完成'}</strong></div><div><span>排期来源</span><strong>{taskOpen.intentStrength === 'manual' ? '用户手动' : taskOpen.scheduleSource}</strong></div></div>
        <label className="field"><span>任务标题</span><input value={taskOpen.title} onChange={event => updateAssignment(taskOpen.id, { title: event.target.value })}/></label>
        <label className="field"><span>预计时长（分钟）</span><NumericInput min={1} max={1440} value={taskOpen.estimatedMinutes} onValueChange={value => updateAssignment(taskOpen.id, { estimatedMinutes: value })}/></label>
        <label className="field"><span>移动到</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={taskOpen.scheduledDate ?? ''} onChange={event => moveWithValidation(taskOpen.id, event.target.value)}/></label>
        <label className="field"><span>所属任务组</span><select value={taskOpen.groupId} onChange={event => {
          const targetGroup = state.taskGroups.find(group => group.id === event.target.value)
          if (!targetGroup) return
          const adopt = window.confirm(`移动到“${targetGroup.title}”后，将继承其类别、优先级、规则和目标关联。

确定：同时采用该组默认预计 ${targetGroup.unitMinutes} 分钟（仅未开始任务）。
取消：保留当前预计时长并继续移动。`)
          const preview = cloneActiveState(state)
          const draftTask = preview.assignments.find(item => item.id === taskOpen.id)
          if (draftTask) { draftTask.groupId = targetGroup.id; if (adopt && draftTask.status === 'todo' && draftTask.actualMinutes === 0) draftTask.estimatedMinutes = targetGroup.unitMinutes }
          const placement = taskOpen.scheduledDate ? checkAssignmentPlacement(preview, taskOpen.id, taskOpen.scheduledDate) : undefined
          if (placement?.some(item => item.hard) && !window.confirm(`当前日期在新规则下存在冲突：\n${placement.map(item => `• ${item.label}（${item.current}/${item.limit}）`).join('\n')}\n\n仍要移动任务组并保留当前日期吗？之后可在计划调整中处理。`)) return
          moveAssignmentToGroup(taskOpen.id, targetGroup.id, adopt)
        }}>{state.taskGroups.filter(group => !group.hiddenStandalone || group.id === taskOpen.groupId).map(group => <option key={group.id} value={group.id}>{group.subject} · {group.title}</option>)}</select></label>
        <label className="switch-row"><button type="button" className={`switch ${taskOpen.locked ? 'on' : ''}`} onClick={() => updateAssignment(taskOpen.id, { locked: !taskOpen.locked })}><i/></button><span>锁定任务，自动方案不得移动</span></label>
        <div className="task-impact-note"><strong>关联目标</strong><span>{state.goals.filter(goal => goal.linkedAssignmentIds.includes(taskOpen.id) || goal.linkedTaskGroupIds.includes(taskOpen.groupId) || goal.completionConditions.some(condition => condition.groupId === taskOpen.groupId)).map(goal => `${goal.title}（最晚 ${goal.latestDate}）`).join('；') || '无关联目标'}。移动出现超载或目标风险时，系统会先说明后果。</span></div>
        <div className="drawer-danger-zone">{taskOpen.status === 'done' && <button className="secondary-button" onClick={() => window.confirm(`重新打开“${taskOpen.title}”？已记录的 ${taskOpen.actualMinutes} 分钟会保留。`) && reopenAssignment(taskOpen.id)}>重新打开任务</button>}<button className="danger-button" onClick={() => { const warning = taskOpen.actualMinutes > 0 || taskOpen.progress > 0 ? `此任务已有 ${taskOpen.actualMinutes} 分钟实际用时、进度 ${taskOpen.progress}%。删除会创建可恢复版本，但当前任务将从计划中移除。` : '删除后会更新任务组数量并提供计划版本恢复。'; if (window.confirm(`${warning}

确认移除“${taskOpen.title}”？`)) { removeAssignment(taskOpen.id); setTaskOpenId(undefined) } }}><Trash2 size={16}/>移除任务</button></div>
      </div>}
    </Drawer>
  </>
}

function TasksPage({ onAddSingle, onCreateGroup, onPrepared }: { onAddSingle: () => void; onCreateGroup: () => void; onPrepared: (state: AppState, event: PlanChangeEvent) => void }) {
  const { state, editTaskGroup, prepareTaskGroupEdit, deleteTaskGroup, moveAssignments } = useApp()
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'all'|Priority>('all')
  const [subject, setSubject] = useState<'all'|Subject>('all')
  const [showHidden, setShowHidden] = useState(false)
  const [editing, setEditing] = useState<TaskGroup>()
  const assignmentsByGroup = useMemo(() => new Map(state.taskGroups.map(group => [group.id, state.assignments.filter(item => item.groupId === group.id)])), [state.taskGroups, state.assignments])
  const subjects = Array.from(new Set([...state.settings.customSubjects, ...state.taskGroups.map(group => group.subject)])).sort()
  const groups = state.taskGroups.filter(group => !group.hiddenStandalone && (showHidden || !group.hidden) && (priority === 'all' || group.priority === priority) && (subject === 'all' || group.subject === subject) && (`${group.subject}${group.title}${group.notes ?? ''}`.toLowerCase().includes(search.toLowerCase())))
  const bulkMoveGroup = (group: TaskGroup) => { const date = window.prompt(`把“${group.title}”未完成任务移动到哪一天？（YYYY-MM-DD）`); if (!date) return; moveAssignments(state.assignments.filter(item => item.groupId === group.id && item.status !== 'done' && !item.locked).map(item => item.id), date) }
  return <>
    <section className="tasks-toolbar"><div className="search-box"><Search size={18}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索任务组"/></div><select value={priority} onChange={event => setPriority(event.target.value === 'all' ? 'all' : Number(event.target.value) as Priority)}><option value="all">全部优先级</option>{[5,3,2,1,0].map(item => <option key={item} value={item}>优先级 {item}</option>)}</select><select value={subject} onChange={event => setSubject(event.target.value as 'all'|Subject)}><option value="all">全部科目／类别</option>{subjects.map(item => <option key={item}>{item}</option>)}</select><label className="toggle-label"><input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)}/><span>显示隐藏任务组</span></label><div className="task-create-actions"><button className="secondary-button" onClick={onAddSingle}><Plus size={17}/>添加单项任务</button><button className="primary-button" onClick={onCreateGroup}><Plus size={17}/>创建任务组</button></div></section>
    <section className="group-list">{groups.map(group => { const items = assignmentsByGroup.get(group.id) ?? []; const done = items.filter(item => item.status === 'done').length; const actual = items.reduce((sum,item) => sum + item.actualMinutes,0); const planned = items.reduce((sum,item) => sum + item.estimatedMinutes,0); const durationSuggestion = getDurationSuggestion(state, group.id); const linkedGoals = state.goals.filter(goal => goal.linkedTaskGroupIds.includes(group.id) || goal.completionConditions.some(condition => condition.groupId === group.id)); return <article className="group-card" key={group.id}><div className="group-card-head"><div><span className={`subject-pill subject-${group.subject}`}>{group.subject}</span><span className={`priority-badge priority-${group.priority}`}>P{group.priority}</span><span className="status-pill">{group.status === 'completed' ? '已完成' : group.status === 'archived' ? '已归档' : '进行中'}</span><h3>{group.title}</h3></div><div className="group-actions"><button className="text-button" onClick={() => bulkMoveGroup(group)}>移动未完成</button><button className="text-button" onClick={() => setEditing(group)}>编辑</button><button className="icon-button danger-icon" onClick={() => window.confirm(`删除任务组“${group.title}”？将影响 ${items.length} 项任务、${items.filter(item=>item.status==='done').length} 项已完成、${items.filter(item=>item.actualMinutes>0).length} 项有实际用时和 ${linkedGoals.length} 个目标，并创建可恢复版本。`) && deleteTaskGroup(group.id)}><Trash2 size={17}/></button></div></div><div className="group-stats"><span>{done}/{items.length} 已完成</span><span>预计 {minutesText(planned)}</span><span>实际 {minutesText(actual)}</span><span>关联目标 {linkedGoals.length}</span>{group.dailyMax && <span>每天最多 {group.dailyMax} 个</span>}</div><div className="progress-track"><i style={{width:`${items.length ? done/items.length*100 : 0}%`}}/></div>{(group.notes || group.sourceLabel) && <p className="group-note">{group.notes || group.sourceLabel}</p>}{durationSuggestion && <div className="duration-suggestion"><div><strong>发现用时校准机会</strong><span>最近 {durationSuggestion.sampleSize} 次记录显示当前预计可能需要调整；请在每日复盘中查看样本并生成方案，不会直接覆盖。</span></div></div>}</article> })}
      {!groups.length && <div className="empty-state"><CheckCircle2 size={30}/><h3>{state.taskGroups.filter(group => !group.hiddenStandalone).length ? '没有符合条件的任务组' : '计划还是空的'}</h3><p>{state.taskGroups.length ? '调整筛选条件。' : '可先添加一个单项任务，也可创建批量任务组。'}</p><div className="button-wrap"><button className="secondary-button" onClick={onAddSingle}>添加第一个任务</button><button className="primary-button" onClick={onCreateGroup}>创建批量计划／任务组</button></div></div>}
    </section>
    <TaskGroupDialog open={Boolean(editing)} state={state} initial={editing} onClose={() => setEditing(undefined)} onCreate={() => undefined} onEdit={group => {
      const original = state.taskGroups.find(item => item.id === group.id)
      const affectsPlan = Boolean(original && (original.quantity !== group.quantity || original.unitMinutes !== group.unitMinutes || original.subject !== group.subject
        || original.priority !== group.priority || original.dailyMax !== group.dailyMax || original.activityType !== group.activityType
        || original.highIntensity !== group.highIntensity || original.countInStats !== group.countInStats))
      if (affectsPlan) {
        const prepared = prepareTaskGroupEdit(group)
        onPrepared(prepared.state, prepared.event)
      } else editTaskGroup(group)
    }}/>
  </>
}

function SettingsPage({ sessionUserId, sessionEmail, cloudMessage, onCloudUpload, onPrepared }: { sessionUserId?: string; sessionEmail?: string; cloudMessage?: string; onCloudUpload: () => Promise<string>; onPrepared: (state: AppState, event: PlanChangeEvent) => void }) {
  const { state, namespace, updateSettings, undo, canUndo, replaceState, resetAll, restoreReplanHistory, previewPlanVersion, restorePlanVersion } = useApp()
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [authMessage,setAuthMessage]=useState('')
  const [historyEntry,setHistoryEntry]=useState<AppState['replanHistory'][number]>()
  const [planNameDraft,setPlanNameDraft]=useState(state.settings.planName)
  const [subjectDraft,setSubjectDraft]=useState('')
  const [versionOpen,setVersionOpen]=useState<AppState['planVersions'][number]>()
  const fileRef=useRef<HTMLInputElement>(null)
  useEffect(() => setPlanNameDraft(state.settings.planName), [state.settings.planName])
  const versionDiff = versionOpen ? previewPlanVersion(versionOpen.id) : undefined
  const exportJson=()=>downloadBlob(JSON.stringify(state,null,2),`study-plan-v0.8-${todayISO()}.json`,'application/json')
  const exportCsv=()=>{const groups=new Map(state.taskGroups.map(group=>[group.id,group]));const rows=[['科目/类别','任务','计划日期','状态','预计分钟','实际分钟','进度','优先级','排期来源','用户意图']];for(const item of state.assignments){const group=groups.get(item.groupId);if(group)rows.push([group.subject,item.title,item.scheduledDate??'',item.status,String(item.estimatedMinutes),String(item.actualMinutes),String(item.progress),String(group.priority),item.scheduleSource,item.intentStrength])}downloadBlob('\ufeff'+rows.map(row=>row.map(csvEscape).join(',')).join('\n'),`study-plan-${todayISO()}.csv`,'text/csv;charset=utf-8')}
  const importJson=(file:File)=>{const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(String(reader.result)) as AppState;if(!parsed.version||!parsed.taskGroups)throw new Error();if(window.confirm('导入会覆盖当前数据；导入后会自动执行 v0.7→v0.8 确定性迁移。是否继续？'))replaceState(parsed,true)}catch{window.alert('无法识别这个备份文件。')}};reader.readAsText(file)}
  const login=async(kind:'in'|'up')=>{try{setAuthMessage('处理中……');await(kind==='in'?signIn(email,password):signUp(email,password));setAuthMessage(kind==='in'?'登录成功，正在恢复云端计划':'注册请求已提交，请检查邮箱。')}catch(error){setAuthMessage(error instanceof Error?error.message:'操作失败')}}
  const cloudUpload=async()=>{try{const timestamp=await onCloudUpload();setAuthMessage(`已同步：${new Date(timestamp).toLocaleString()}`)}catch(error){setAuthMessage(error instanceof Error?error.message:'同步失败')}}
  const cloudDownload=async()=>{try{const cloud=await downloadSnapshot(sessionUserId);if(!cloud){setAuthMessage('云端尚无数据');return}if(window.confirm('用云端当前计划覆盖本机当前计划？本机完整版本历史仍保留在本设备。'))replaceState({...cloud,replanHistory:state.replanHistory,conflictBackups:state.conflictBackups,planVersions:state.planVersions},true);setAuthMessage('已从云端恢复')}catch(error){setAuthMessage(error instanceof Error?error.message:'下载失败')}}
  const restoreConflict=(raw:string)=>{try{const parsed=JSON.parse(raw) as AppState;if(window.confirm('恢复这份冲突备份？当前状态会保留在撤销历史中。'))replaceState(parsed,true)}catch{window.alert('冲突备份已损坏，无法恢复。')}}
  const addSubject=()=>{const value=subjectDraft.trim();if(!value)return;updateSettings({customSubjects:Array.from(new Set([...state.settings.customSubjects,value]))});setSubjectDraft('')}
  return <div className="settings-stack">
    <SettingsSection title="计划基础" description="目标日期已统一迁移到“目标”页面，这里只保留计划边界和默认风格，避免多个可编辑真相。"><div className="form-grid"><label className="field span-2"><span>计划名称</span><input value={planNameDraft} onChange={event=>setPlanNameDraft(event.target.value)} onBlur={()=>planNameDraft!==state.settings.planName&&updateSettings({planName:planNameDraft})}/></label><label className="field"><span>开始日期</span><input type="date" value={state.settings.startDate} onChange={event=>updateSettings({startDate:event.target.value})}/></label><label className="field"><span>结束日期</span><input type="date" value={state.settings.endDate} onChange={event=>updateSettings({endDate:event.target.value})}/></label><label className="field"><span>默认排期风格</span><select value={state.settings.planningMode} onChange={event=>updateSettings({planningMode:event.target.value as AppState['settings']['planningMode']})}><option value="sprint">冲刺</option><option value="balanced">平衡</option><option value="relaxed">轻松</option></select></label></div></SettingsSection>
    <SettingsSection title="排期偏好" description="这些是可解释的偏好和范围参数；硬约束、用户手动安排、锁定、执行状态与日期保护不会被静默突破。"><div className="form-grid three"><label className="field"><span>冻结近期天数</span><NumericInput commitMode="blur" min={0} max={7} value={state.settings.freezeDays} onValueChange={value=>updateSettings({freezeDays:value})}/></label><label className="field"><span>常规日最多任务</span><NumericInput commitMode="blur" min={1} max={100} value={state.settings.regularMaxTasks} onValueChange={value=>updateSettings({regularMaxTasks:value})}/></label><label className="field"><span>学习日最多任务</span><NumericInput commitMode="blur" min={1} max={100} value={state.settings.studyMaxTasks} onValueChange={value=>updateSettings({studyMaxTasks:value})}/></label><label className="field"><span>均衡方案目标利用率（%）</span><NumericInput commitMode="blur" min={50} max={100} value={Math.round(state.settings.targetUtilization*100)} onValueChange={value=>updateSettings({targetUtilization:value/100})}/></label><label className="field"><span>接近满载提示线（%）</span><NumericInput commitMode="blur" min={60} max={100} value={Math.round(state.settings.nearFullThreshold*100)} onValueChange={value=>updateSettings({nearFullThreshold:value/100})}/></label><label className="field"><span>缓冲日目标利用率（%）</span><NumericInput commitMode="blur" min={0} max={80} value={Math.round(state.settings.bufferUtilization*100)} onValueChange={value=>updateSettings({bufferUtilization:value/100})}/></label><label className="field"><span>小范围调整优先半径（天）</span><NumericInput commitMode="blur" min={1} max={14} value={state.settings.localRepairRadius} onValueChange={value=>updateSettings({localRepairRadius:value})}/></label><label className="field"><span>单日尽量最多新增任务</span><NumericInput commitMode="blur" min={0} max={10} value={state.settings.maxNewTasksPerDay} onValueChange={value=>updateSettings({maxNewTasksPerDay:value})}/></label><label className="field"><span>单日负载变化预算（%容量）</span><NumericInput commitMode="blur" min={0} max={100} value={Math.round(state.settings.maxLoadChangeRatio*100)} onValueChange={value=>updateSettings({maxLoadChangeRatio:value/100})}/></label><label className="field"><span>单类别建议占比上限（%）</span><NumericInput commitMode="blur" min={30} max={100} value={Math.round(state.settings.subjectShareLimit*100)} onValueChange={value=>updateSettings({subjectShareLimit:value/100})}/></label></div></SettingsSection>
    <SettingsSection title="每日容量" description="容量是默认硬上限。今天已经学习的实际时间会消耗容量，即使该任务不计入正式统计。"><div className="form-grid three"><label className="field"><span>常规日（分钟）</span><NumericInput commitMode="blur" min={0} max={1440} value={state.settings.regularMinutes} onValueChange={value=>updateSettings({regularMinutes:value})}/></label><label className="field"><span>学习日（分钟）</span><NumericInput commitMode="blur" min={0} max={1440} value={state.settings.studyMinutes} onValueChange={value=>updateSettings({studyMinutes:value})}/></label><label className="field"><span>旅游日（分钟）</span><NumericInput commitMode="blur" min={0} max={1440} value={state.settings.travelMinutes} onValueChange={value=>updateSettings({travelMinutes:value})}/></label></div><div className="toggle-grid"><Toggle checked={state.settings.countWordsTime} onChange={value=>updateSettings({countWordsTime:value})} label="把每日单词计入正式计划与统计时间"/><Toggle checked={state.settings.showWarnings} onChange={value=>updateSettings({showWarnings:value})} label="显示进度风险提醒"/><Toggle checked={state.settings.optionalReview} onChange={value=>updateSettings({optionalReview:value})} label="保留每日复盘入口"/><Toggle checked={state.settings.keepOfflineOnLogout} onChange={value=>updateSettings({keepOfflineOnLogout:value})} label="退出登录后保留个人离线缓存"/></div></SettingsSection>
    <CalendarConstraintManager onPrepared={onPrepared}/>
    <SettingsSection title="自定义科目／类别" description="保留学习预设，同时允许增加自己的类别；存储层不会把产品永久限制为学校科目。"><div className="custom-subject-editor"><div className="button-wrap"><input value={subjectDraft} onChange={event=>setSubjectDraft(event.target.value)} placeholder="例如：数学竞赛、研究项目"/><button className="primary-button" onClick={addSubject}>添加</button></div><div className="tag-list">{state.settings.customSubjects.map(item=><span key={item}>{item}<button aria-label={`删除${item}`} onClick={()=>updateSettings({customSubjects:state.settings.customSubjects.filter(subject=>subject!==item)})}>×</button></span>)}</div></div></SettingsSection>
    <SettingsSection title="自适应时长建议" description="只使用最近有效样本生成建议，不自动覆盖预计或移动日历；孤立异常值按 IQR 规则降低影响。"><div className="form-grid three"><label className="field"><span>历史窗口（最近完成数）</span><NumericInput commitMode="blur" min={3} max={50} value={state.settings.duration.windowSize} onValueChange={value=>updateSettings({duration:{...state.settings.duration,windowSize:value}})}/></label><label className="field"><span>最少样本数</span><NumericInput commitMode="blur" min={2} max={20} value={state.settings.duration.minimumSamples} onValueChange={value=>updateSettings({duration:{...state.settings.duration,minimumSamples:value}})}/></label><label className="field"><span>偏差提示阈值（%）</span><NumericInput commitMode="blur" min={5} max={100} value={Math.round(state.settings.duration.deviationThreshold*100)} onValueChange={value=>updateSettings({duration:{...state.settings.duration,deviationThreshold:value/100}})}/></label></div><Toggle checked={state.settings.duration.enabled} onChange={value=>updateSettings({duration:{...state.settings.duration,enabled:value}})} label="启用复盘中的时长建议"/></SettingsSection>
    <SettingsSection title="计划版本与恢复" description="重大变更保存为本机版本，最多 10 个。完整历史当前仅存于此设备，不进入普通 Supabase 自动保存载荷。"><div className="history-list">{state.planVersions.length?[...state.planVersions].reverse().map(version=><div className="history-row" key={version.id}><div><strong>{version.reason}</strong><span>{new Date(version.timestamp).toLocaleString()} · 移动 {version.summary.movedTaskCount} 项 · 影响 {version.summary.affectedDateCount} 日</span><small>本机版本 · schema v{version.schemaVersion}</small></div><div className="button-wrap"><button className="secondary-button" onClick={()=>setVersionOpen(version)}>查看恢复差异</button></div></div>):<p className="muted-text">还没有重大计划版本。</p>}</div></SettingsSection>
    <SettingsSection title="旧版重排记录" description="为兼容 v0.7 历史继续可读、可恢复；v0.8 的新重大变化统一使用计划版本。"><div className="history-list">{state.replanHistory.length?[...state.replanHistory].reverse().map(entry=><div className="history-row" key={entry.id}><div><strong>{entry.label}</strong><span>{new Date(entry.createdAt).toLocaleString()} · 移动 {entry.moveCount} 项</span></div><div className="button-wrap">{entry.afterSnapshot&&<button className="secondary-button" onClick={()=>setHistoryEntry(entry)}>查看差异</button>}<button className="secondary-button" onClick={()=>window.confirm('恢复到此旧记录之前？')&&restoreReplanHistory(entry.id)}>恢复</button></div></div>):<p className="muted-text">没有旧版记录。</p>}</div></SettingsSection>
    <SettingsSection title="数据与恢复" description={`当前数据空间：${namespace==='guest'?'游客演示':sessionEmail??'个人账号'}。JSON 备份可能包含个人计划，请妥善保管。`}><div className="button-wrap"><button className="secondary-button" onClick={exportJson}><Download size={16}/>导出 JSON</button><button className="secondary-button" onClick={exportCsv}><FileDown size={16}/>导出 CSV</button><button className="secondary-button" onClick={()=>window.print()}><FileDown size={16}/>打印 / 导出 PDF</button><button className="secondary-button" onClick={()=>fileRef.current?.click()}><Upload size={16}/>导入 JSON</button><input ref={fileRef} type="file" accept="application/json" hidden onChange={event=>event.target.files?.[0]&&importJson(event.target.files[0])}/><button className="secondary-button" disabled={!canUndo} onClick={undo}><RotateCcw size={16}/>恢复上一步</button>{namespace==='guest'&&<><button className="secondary-button" onClick={()=>window.confirm('恢复完整功能演示计划？当前游客修改会被覆盖。')&&resetAll('demo')}>恢复演示计划</button><button className="secondary-button" onClick={()=>window.confirm('从空白计划开始？当前游客数据会被清空。')&&resetAll('blank')}>从空白开始</button></>}<button className="danger-button" onClick={()=>window.confirm('确认重置当前数据空间？请先导出备份。')&&resetAll(namespace==='guest'?'demo':'blank')}><Trash2 size={16}/>重置计划</button></div>{state.conflictBackups.length>0&&<div className="conflict-backups"><strong>同步冲突备份</strong><p>不同设备冲突会保留副本，不静默覆盖。</p>{state.conflictBackups.slice(-5).reverse().map((raw,index)=><div key={index}><span>备份 {state.conflictBackups.length-index}</span><div className="button-wrap"><button className="text-button" onClick={()=>restoreConflict(raw)}>恢复</button><button className="text-button" onClick={()=>downloadBlob(raw,`study-plan-conflict-${index+1}.json`,'application/json')}>下载</button></div></div>)}</div>}</SettingsSection>
    <SettingsSection title="Supabase 云同步" description={supabaseConfigured?'登录后同步当前可移植状态；重型版本历史保持本机，不会让普通自动保存载荷膨胀。':'尚未配置。复制 .env.example 为 .env，并填写项目 URL 与 publishable / anon key。'}>{!supabaseConfigured?<div className="code-note">VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</div>:sessionEmail?<div className="cloud-panel"><div><Cloud size={20}/><span>已登录：{sessionEmail}</span></div><div className="button-wrap"><button className="secondary-button" onClick={cloudUpload}>立即上传</button><button className="secondary-button" onClick={cloudDownload}>从云端恢复</button><button className="secondary-button" onClick={()=>signOut()}>退出登录</button></div></div>:<div className="auth-form"><input type="email" placeholder="邮箱" value={email} onChange={event=>setEmail(event.target.value)}/><input type="password" placeholder="密码" value={password} onChange={event=>setPassword(event.target.value)}/><button className="primary-button" onClick={()=>login('in')}>登录</button><button className="secondary-button" onClick={()=>login('up')}>注册</button></div>}{(authMessage||cloudMessage)&&<p className="settings-message">{authMessage||cloudMessage}</p>}</SettingsSection>
    <SettingsSection title="AI 接口预留" description="v0.8 不实现自然语言 AI 功能，只保留 parseUserIntent(input, context): PlanChangeEventDraft 接口方向。"><div className="reserved-card"><Sparkles size={21}/><div><strong>AI 功能未启用</strong><p>未来 AI 只能产生变化事件草稿，不能直接应用日历修改；用户仍需查看完整方案并决定。</p></div></div></SettingsSection>
    <HistoryDiffDialog entry={historyEntry} onClose={()=>setHistoryEntry(undefined)}/>
    <Modal open={Boolean(versionOpen)} title="恢复计划版本前预览" onClose={()=>setVersionOpen(undefined)} wide mobileFullscreen>{versionOpen&&versionDiff&&<><p><strong>{versionOpen.reason}</strong><br/><span className="muted-text">恢复前会先保存当前计划；实际用时、进度、完成状态、完成日期、计时器和复盘记录不会被旧快照覆盖。</span></p><div className="proposal-summary-grid"><div><strong>{versionDiff.moved.length}</strong><span>任务日期变化</span></div><div><strong>{versionDiff.added.length}</strong><span>将增加</span></div><div><strong>{versionDiff.removed.length}</strong><span>将移除</span></div><div><strong>{versionDiff.goalChanges.length}</strong><span>目标变化</span></div></div><details open><summary>任务日期变化（{versionDiff.moved.length}）</summary><ul>{versionDiff.moved.map(item=><li key={item.id}>{item.title}：{item.from??'未安排'} → {item.to??'未安排'}</li>)}</ul></details><details><summary>增加／移除任务</summary><ul>{versionDiff.added.map(item=><li key={`a-${item.id}`}>增加：{item.title}</li>)}{versionDiff.removed.map(item=><li key={`r-${item.id}`}>移除：{item.title}</li>)}</ul></details><details><summary>目标变化（{versionDiff.goalChanges.length}）</summary><ul>{versionDiff.goalChanges.map(item=><li key={item.id}>{item.title}：{item.before??'无'} → {item.after??'无'}</li>)}</ul></details><div className="modal-actions"><button className="secondary-button" onClick={()=>setVersionOpen(undefined)}>取消</button><button className="primary-button" onClick={()=>{restorePlanVersion(versionOpen.id);setVersionOpen(undefined)}}>恢复此版本</button></div></>}</Modal>
  </div>
}

function SettingsSection({title,description,children}:{title:string;description:string;children:React.ReactNode}){return <section className="settings-section"><div><h2>{title}</h2><p>{description}</p></div><div>{children}</div></section>}
function Toggle({checked,onChange,label}:{checked:boolean;onChange:(v:boolean)=>void;label:string}){return <label className="switch-row"><button type="button" className={`switch ${checked?'on':''}`} onClick={()=>onChange(!checked)}><i/></button><span>{label}</span></label>}
function EmptyState({title,text}:{title:string;text:string}){return <div className="empty-state"><CheckCircle2 size={30}/><h3>{title}</h3><p>{text}</p></div>}
function downloadBlob(content:string,name:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function csvEscape(v:string){return `"${v.replaceAll('"','""')}"`}
