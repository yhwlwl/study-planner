import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BarChart3, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Cloud, CloudOff,
  Download, FileDown, Filter, LayoutDashboard, ListTodo, Lock, Menu, Plus, RefreshCw,
  RotateCcw, Search, Settings as SettingsIcon, Sparkles, Trash2, Upload, X
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { addMonths, endOfMonth, format, getDay, isWithinInterval, parseISO, startOfMonth } from 'date-fns'
import { useApp } from './AppContext'
import type { AppState, Assignment, DayType, Priority, ReplanBundle, ReplanRequest, Subject, TaskGroup } from './types'
import { clampDate, dateRange, dayTypeLabel, fmtDate, fmtWeekday, getCapacity, getDayConfig, minutesText, shiftDate, todayISO } from './lib/date'
import { analyzePlan, effectiveMinutes, getDurationSuggestion, predictCompletion, suggestMoveDates } from './lib/planner'
import { uid } from './lib/id'
import { buildBlankState, buildGuestDemoState, normalizeState } from './lib/seed'
import { loadLocalState } from './lib/db'
import { Modal } from './components/Modal'
import { Drawer } from './components/Drawer'
import { TaskCard } from './components/TaskCard'
import { ReplanDialog } from './components/ReplanDialog'
import { TaskGroupDialog } from './components/TaskGroupDialog'
import { HistoryDiffDialog } from './components/HistoryDiffDialog'
import { FocusTimerPage, getTimerElapsedSeconds } from './components/FocusTimerPage'
import { downloadSnapshot, getSession, signIn, signOut, signUp, supabase, supabaseConfigured, uploadSnapshot } from './lib/supabase'
import './styles.css'

type Page = 'today' | 'calendar' | 'tasks' | 'stats' | 'settings' | 'timer'
type ShiftScope = 'today' | 'future'
type CloudSyncStatus = 'local' | 'restoring' | 'saving' | 'saved' | 'error'

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'today', label: '今日', icon: LayoutDashboard },
  { id: 'calendar', label: '月历', icon: CalendarDays },
  { id: 'tasks', label: '全部任务', icon: ListTodo },
  { id: 'stats', label: '统计', icon: BarChart3 },
  { id: 'settings', label: '设置', icon: SettingsIcon }
]

export default function App() {
  const {
    state, namespace, ready, updateSettings, previewReplan, applyReplan,
    replaceState, loadDataSpace, setDataSpace, clearDataSpace
  } = useApp()
  const [page, setPage] = useState<Page>('today')
  const [mobileNav, setMobileNav] = useState(false)
  const [replan, setReplan] = useState<ReplanBundle>()
  const [replanOpen, setReplanOpen] = useState(false)
  const [replanRequest, setReplanRequest] = useState<ReplanRequest>({ mode: 'repair', fromDate: todayISO(), freezeDays: 2 })
  const [replanBaseState, setReplanBaseState] = useState<AppState>()
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string }>()
  const [cloudReady, setCloudReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('local')
  const [firstLoginOpen, setFirstLoginOpen] = useState(false)
  const [cloudMessage, setCloudMessage] = useState('')
  const [dataSwitching, setDataSwitching] = useState(false)
  const previousUserId = useRef<string>()
  const stateRef = useRef(state)
  stateRef.current = state

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
        const userNamespace = `user:${sessionUser.id}`
        const localUser = await loadLocalState(userNamespace)
        const cloud = await downloadSnapshot()
        if (cancelled) return
        if (cloud) {
          const normalizedCloud = normalizeState(cloud)
          const normalizedLocal = localUser ? normalizeState(localUser) : undefined
          const localNewer = normalizedLocal && Date.parse(normalizedLocal.updatedAt) > Date.parse(normalizedCloud.updatedAt)
          if (localNewer) {
            const useLocal = window.confirm(`检测到此设备的个人计划比云端更新。

确定：使用本机版本并上传云端。
取消：恢复云端版本，并把本机版本保存为冲突备份。`)
            if (useLocal) {
              await setDataSpace(userNamespace, normalizedLocal, false)
              await uploadSnapshot(normalizedLocal)
              setCloudMessage('已使用较新的本机版本并同步到云端。')
            } else {
              normalizedCloud.conflictBackups = [...(normalizedCloud.conflictBackups ?? []).slice(-4), JSON.stringify(normalizedLocal)]
              await setDataSpace(userNamespace, normalizedCloud, false)
              setCloudMessage('已恢复云端版本，本机版本已保留为冲突备份。')
            }
          } else {
            if (normalizedLocal && normalizedLocal.updatedAt !== normalizedCloud.updatedAt) {
              normalizedCloud.conflictBackups = [...(normalizedCloud.conflictBackups ?? []).slice(-4), JSON.stringify(normalizedLocal)]
            }
            await setDataSpace(userNamespace, normalizedCloud, false)
            setCloudMessage('已从云端恢复个人计划。')
          }
          if (!cancelled) {
            setCloudReady(true)
            setSyncStatus('saved')
            setDataSwitching(false)
          }
          return
        }
        if (localUser && localUser.taskGroups.length > 0) {
          const normalizedLocal = normalizeState(localUser)
          await setDataSpace(userNamespace, normalizedLocal, false)
          const uploadLocal = window.confirm('云端没有计划，但此设备保存了一份个人计划。是否把它作为云端初始版本？')
          if (uploadLocal) {
            await uploadSnapshot(normalizedLocal)
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
        // 云端为空时绝不上传游客数据，先让用户选择模板。
        await loadDataSpace(userNamespace, buildBlankState())
        if (!cancelled) {
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
    setSyncStatus('saving')
    let cancelled = false
    const id = window.setTimeout(async () => {
      try {
        await uploadSnapshot(state)
        if (!cancelled) setSyncStatus('saved')
      } catch {
        if (!cancelled) setSyncStatus('error')
      }
    }, 1200)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [state, ready, sessionUser?.id, cloudReady, namespace])

  useEffect(() => {
    const retry = async () => {
      if (!sessionUser?.id || !cloudReady || namespace !== `user:${sessionUser.id}`) return
      setSyncStatus('saving')
      try {
        await uploadSnapshot(stateRef.current)
        setSyncStatus('saved')
      } catch {
        setSyncStatus('error')
      }
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [sessionUser?.id, cloudReady, namespace])

  const openReplan = (patch?: Partial<ReplanRequest>, baseState?: AppState) => {
    const source = baseState ?? state
    const request = { ...replanRequest, freezeDays: source.settings.freezeDays, ...patch }
    setReplanRequest(request)
    setReplanBaseState(baseState)
    setReplan(previewReplan(request, baseState))
    setReplanOpen(true)
  }

  const initializeAccount = async (kind: 'blank' | 'demo') => {
    if (!sessionUser?.id) return
    const initial = kind === 'demo' ? buildGuestDemoState() : buildBlankState()
    await setDataSpace(`user:${sessionUser.id}`, initial, false)
    await uploadSnapshot(initial)
    setCloudReady(true)
    setSyncStatus('saved')
    setFirstLoginOpen(false)
    setDataSwitching(false)
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
          <div className={`sync-status ${sessionUser ? 'online' : ''} ${syncStatus === 'error' ? 'sync-error' : ''}`}>{sessionUser ? <Cloud size={16}/> : <CloudOff size={16}/>}<span>{!sessionUser ? '游客演示 · 仅本地保存' : syncStatus === 'restoring' ? '正在从云端恢复' : syncStatus === 'saving' ? '正在自动保存' : syncStatus === 'error' ? '云同步失败' : cloudReady ? '已自动保存到云端' : '等待初始化个人计划'}</span></div>
          <button className="collapse-button" onClick={() => updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed })}><ChevronLeft size={18}/><span>收起侧边栏</span></button>
        </div>
      </aside>
      {mobileNav && <button className="mobile-overlay" onClick={() => setMobileNav(false)} aria-label="关闭菜单"/>}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21}/></button>
          <div className="page-heading"><h1>{navItems.find(n => n.id === page)?.label}</h1><span>{format(new Date(), 'yyyy年M月d日')}</span></div>
          <div className="topbar-actions"><ActiveTimerReturnButton onOpen={() => setPage('timer')}/><button className="secondary-button" onClick={() => openReplan()}><RefreshCw size={16}/>重排中心</button></div>
        </header>
        <div className="page-content">
          {page === 'today' && <TodayPage onNavigate={setPage} onReplan={date => openReplan({ mode: 'repair', fromDate: date })}/>} 
          {page === 'calendar' && <CalendarPage onReplan={(date, baseState) => openReplan({ mode: 'repair', fromDate: date }, baseState)}/>} 
          {page === 'tasks' && <TasksPage/>}
          {page === 'stats' && <StatsPage/>}
          {page === 'settings' && <SettingsPage sessionEmail={sessionUser?.email} cloudMessage={cloudMessage}/>} 
        </div>
      </main>
      <ReplanDialog
        bundle={replan}
        currentState={replanBaseState ?? state}
        open={replanOpen}
        request={replanRequest}
        onRequestChange={setReplanRequest}
        onRegenerate={() => setReplan(previewReplan(replanRequest, replanBaseState))}
        onClose={() => { setReplanOpen(false); setReplanBaseState(undefined) }}
        onApply={(result, editedState, audit) => { applyReplan(result, editedState, audit); setReplanOpen(false); setReplanBaseState(undefined) }}
      />
      <Modal open={firstLoginOpen} title="欢迎使用 · 选择个人计划起点" onClose={() => {}}>
        <p className="onboarding-copy">云端还没有你的计划。游客演示数据不会上传，也不会包含其他账号的计划。请选择一个独立的个人空间起点。</p>
        <div className="template-options">
          <button onClick={() => void initializeAccount('blank')}><strong>从空白开始</strong><span>创建一个长期使用的新计划。</span></button>
          <button onClick={() => void initializeAccount('demo')}><strong>使用功能演示模板</strong><span>先体验任务、月历、计时和重排。</span></button>
        </div>
      </Modal>
    </div>
  )
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

function TodayPage({ onNavigate, onReplan }: { onNavigate: (page: Page) => void; onReplan: (date: string) => void }) {
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
  const corePrediction = predictCompletion(state, g => g.priority === 5 && !g.recurring && g.targetDate <= state.settings.coreTargetDate)
  const chemistryPrediction = predictCompletion(state, g => g.title === '预习' && g.subject === '化学')
  const risk = planned > capacity ? `今日计划超过容量 ${minutesText(planned - capacity)}` : corePrediction && corePrediction !== '已完成' && corePrediction > state.settings.coreTargetDate ? `核心任务预计 ${fmtDate(corePrediction)} 完成，晚于目标` : undefined

  const shiftPreview = useMemo(() => {
    const next = structuredClone(state)
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
  }, [state, groups, date, shiftScope, shiftDays, shiftLocked])

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
        item.timeEntries.push({ id: uid('time'), minutes, createdAt: new Date().toISOString() })
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
      <div className="button-wrap"><button className="secondary-button" onClick={() => onNavigate('calendar')}><CalendarDays size={16}/>打开月历</button><button className="secondary-button" onClick={()=>setShiftOpen(true)}>整体顺延</button>{tasks.some(t=>t.status!=='done'&&!groups.get(t.groupId)?.recurring)&&<button className="secondary-button" onClick={()=>prepareCarryover(date)}>结束今天</button>}</div>
    </section>
    <section className="compact-metrics">
      <div><span>预计时间</span><strong>{minutesText(planned)}</strong></div>
      <div><span>实际记录</span><strong>{minutesText(actualTotal)}</strong></div>
      <div><span>完成情况</span><strong>{done}/{tasks.length}</strong></div>
      <div><span>当日容量</span><strong>{minutesText(capacity)}</strong></div>
    </section>
    {state.settings.showWarnings && risk && <div className="alert warning"><Sparkles size={18}/><div><strong>进度提醒</strong><span>{risk}</span></div></div>}
    {state.settings.showWarnings && chemistryPrediction && chemistryPrediction !== '已完成' && chemistryPrediction > state.settings.chemistryTargetDate && <div className="alert danger"><Sparkles size={18}/><div><strong>化学预习存在延期风险</strong><span>当前预计 {fmtDate(chemistryPrediction)} 完成，目标是 {fmtDate(state.settings.chemistryTargetDate)}。</span></div></div>}
    <section className="section-block">
      <div className="section-title"><div><h2>今日任务</h2><p>完成后勾选，可录入精确到 1 分钟的实际用时。</p></div></div>
      <div className="task-list">{tasks.length ? tasks.map(a => <TaskCard key={a.id} assignment={a} group={groups.get(a.groupId)!} onComplete={openComplete} onOpenTimer={() => onNavigate('timer')}/>) : <EmptyState title="今天没有任务" text="可以到月历调整计划，或把今天设为休息日。"/>}</div>
    </section>
    <Modal open={Boolean(completeTarget)} title={completeTarget ? `记录：${completeTarget.title}` : '记录任务'} onClose={() => setCompleteTarget(undefined)}>
      <div className="form-stack">
        <label className="field"><span>本次实际用时（分钟，可留空）</span><input type="number" min="0" step="1" value={actual} onChange={e => setActual(e.target.value)} autoFocus/></label>
        <label className="field"><span>若未完成，填写当前进度</span><input type="number" min="1" max="99" value={progress} onChange={e => setProgress(Number(e.target.value))}/></label>
      </div>
      <div className="modal-actions"><button className="secondary-button" onClick={() => saveCompletion(false)}>保存为部分完成</button><button className="primary-button" onClick={() => saveCompletion(true)}>标记完成</button></div>
    </Modal>
    <Modal open={endTodayOpen} title="结束今天 · 处理未完成任务" onClose={()=>setEndTodayOpen(false)} wide>
      <p className="muted-text">系统给出推荐日期，你可以逐项修改、保留为逾期，或进入重排中心比较完整方案。</p>
      <div className="carryover-list">{tasks.filter(t=>t.status!== 'done'&&!groups.get(t.groupId)?.recurring).map(a=><div key={a.id} className="carryover-row"><div><strong>{a.title}</strong><span>{groups.get(a.groupId)?.subject} · 当前安排 {a.scheduledDate}</span></div><select value={carryDates[a.id]??''} onChange={e=>setCarryDates(prev=>({...prev,[a.id]:e.target.value}))}><option value="">保留在原日并标记逾期</option>{suggestMoveDates(state,a.id,8).filter(d=>d>date).slice(0,5).map(d=><option key={d} value={d}>{moveImpactLabel(a,d)}</option>)}</select></div>)}</div>
      <div className="modal-actions"><button className="secondary-button" onClick={()=>{setEndTodayOpen(false);onReplan(date)}}>比较完整方案</button><button className="primary-button" onClick={()=>{for(const [id,target] of Object.entries(carryDates))if(target)moveAssignments([id],target,'carryover');setEndTodayOpen(false)}}>应用这些选择</button></div>
    </Modal>
    <Modal open={shiftOpen} title="整体顺延 · 先看影响再应用" onClose={()=>setShiftOpen(false)} wide>
      <p className="muted-text">适合“今天完全没时间”的情况。每日重复任务不会移动；你的选择会被记录为手动意图，之后自动重排会优先保留。</p>
      <div className="replan-controls">
        <div className="segmented-control">
          <button className={shiftScope==='today'?'active':''} onClick={()=>setShiftScope('today')}>仅今日未完成</button>
          <button className={shiftScope==='future'?'active':''} onClick={()=>setShiftScope('future')}>从今天起全部</button>
        </div>
        <label className="field compact-field"><span>顺延天数</span><input type="number" min="1" max="14" value={shiftDays} onChange={e=>setShiftDays(Math.max(1,Math.min(14,Number(e.target.value)||1)))}/></label>
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

function CalendarPage({ onReplan }: { onReplan: (date: string, baseState?: AppState) => void }) {
  const { state, commit, updateAssignment, updateDayConfig, moveAssignments } = useApp()
  const [month, setMonth] = useState(startOfMonth(parseISO(state.settings.startDate)))
  const [dayOpen, setDayOpen] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [overflowSelectedIds, setOverflowSelectedIds] = useState<string[]>([])
  const [overflowPanel, setOverflowPanel] = useState<{ date: string; top: number; left: number }>()
  const [taskOpenId, setTaskOpenId] = useState<string>()
  const [moveNotice, setMoveNotice] = useState<{ id: string; title: string; date: string }>()
  const [pendingDayType, setPendingDayType] = useState<DayType>()
  const [pendingCustomMinutes, setPendingCustomMinutes] = useState<number>()
  const [dragAssignmentId, setDragAssignmentId] = useState<string>()
  const [dragTargetDate, setDragTargetDate] = useState<string>()
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
  const days = dateRange(format(monthStart, 'yyyy-MM-dd'), format(monthEnd, 'yyyy-MM-dd'))
  const blanks = Array.from({ length: getDay(monthStart) })
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
  const countedMinutes = (assignment: Assignment) => {
    const group = groups.get(assignment.groupId)
    return group && (group.countInStats || state.settings.countWordsTime) ? effectiveMinutes(assignment) : 0
  }
  const loadFor = (date: string) => tasksFor(date).reduce((sum, assignment) => sum + countedMinutes(assignment), 0)

  const moveWithValidation = (assignmentId: string, targetDate: string) => {
    const assignment = state.assignments.find(item => item.id === assignmentId)
    const group = assignment && groups.get(assignment.groupId)
    if (!assignment || !group || assignment.locked || assignment.scheduledDate === targetDate) return false
    if (targetDate < state.settings.startDate || targetDate > state.settings.endDate) {
      window.alert('目标日期超出当前计划范围。')
      return false
    }
    const sameGroupCount = state.assignments.filter(item => item.groupId === group.id && item.scheduledDate === targetDate && item.id !== assignmentId).length
    if (group.dailyMax && sameGroupCount >= group.dailyMax) {
      window.alert(`“${group.title}”每天最多安排 ${group.dailyMax} 个。`)
      return false
    }
    const targetLoad = loadFor(targetDate) - (assignment.scheduledDate === targetDate ? countedMinutes(assignment) : 0)
    const projected = targetLoad + countedMinutes(assignment)
    const capacity = getCapacity(state, targetDate)
    const risks: string[] = []
    if (projected > capacity) risks.push(`将从 ${minutesText(targetLoad)} 增至 ${minutesText(projected)}，超过容量 ${minutesText(projected - capacity)}`)
    if (targetDate > group.targetDate) risks.push(`会越过目标日期 ${group.targetDate}`)
    if (targetDate > group.dueDate) risks.push(`会越过最终截止日期 ${group.dueDate}`)
    if (risks.length && !window.confirm(`移动“${assignment.title}”到 ${targetDate}？\n\n${risks.join('\n')}`)) return false
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
    window.clearTimeout(longPressTimer.current)
    longPressTimer.current = window.setTimeout(() => setTaskOpenId(assignmentId), 350)
  }
  const cancelLongPress = () => window.clearTimeout(longPressTimer.current)

  const openOverflow = (date: string, event: React.MouseEvent) => {
    event.stopPropagation()
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
    const moving = state.assignments.filter(item => ids.includes(item.id) && !item.locked)
    const selectedByGroup = new Map<string, number>()
    for (const assignment of moving) selectedByGroup.set(assignment.groupId, (selectedByGroup.get(assignment.groupId) ?? 0) + 1)
    for (const [groupId, selectedCount] of selectedByGroup) {
      const group = groups.get(groupId)
      if (!group?.dailyMax) continue
      const existing = state.assignments.filter(item => item.groupId === groupId && item.scheduledDate === target && !ids.includes(item.id)).length
      if (existing + selectedCount > group.dailyMax) { window.alert(`“${group.title}”每天最多安排 ${group.dailyMax} 个。`); return false }
    }
    const projected = loadFor(target) + moving.reduce((sum, assignment) => sum + (assignment.scheduledDate === target ? 0 : countedMinutes(assignment)), 0)
    const capacity = getCapacity(state, target)
    const lateTitles = moving.filter(assignment => { const group = groups.get(assignment.groupId); return Boolean(group && target > group.targetDate) }).map(assignment => assignment.title)
    const risks: string[] = []
    if (projected > capacity) risks.push(`预计 ${minutesText(projected)}，超过容量 ${minutesText(projected - capacity)}`)
    if (lateTitles.length) risks.push(`${lateTitles.length} 项会越过目标日期`)
    if (risks.length && !window.confirm(`批量移动到 ${target}？\n\n${risks.join('\n')}`)) return false
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
    dayPreviewState = structuredClone(state)
    const type = pendingDayType ?? dayCfg.type
    dayPreviewState.dayConfigs[dayOpen] = {
      ...dayCfg,
      date: dayOpen,
      type,
      customMinutes: type === 'custom' ? pendingCustomMinutes ?? dayCfg.customMinutes ?? state.settings.regularMinutes : undefined,
      userSet: true
    }
  }

  return <>
    <section className="calendar-toolbar"><div><h2>{format(month, 'yyyy年M月')}</h2><p>拖拽任务可改期；点击日期管理全天，点击“+N 项”只展开被折叠任务。</p></div><div><button className="icon-button" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft size={19}/></button><button className="secondary-button" onClick={() => setMonth(startOfMonth(parseISO(state.settings.startDate)))}>计划开始</button><button className="icon-button" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight size={19}/></button></div></section>
    {moveNotice && <div className="manual-move-notice"><div><strong>已记录你的手动安排</strong><span>「{moveNotice.title}」已移到 {moveNotice.date}，自动重排会优先保留，也不会近期拉回原日期。</span></div><div className="button-wrap"><button className="secondary-button" onClick={() => { updateAssignment(moveNotice.id, { locked: true }); setMoveNotice(undefined) }}><Lock size={15}/>同时锁定</button><button className="text-button" onClick={() => setMoveNotice(undefined)}>知道了</button></div></div>}
    <section className="calendar-card">
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
            className={`calendar-cell ${!inPlan ? 'outside' : ''} ${config ? `day-${config.type}` : ''} ${ratio > 1 ? 'load-over' : ratio > .8 ? 'load-near' : ''} ${dragTargetDate === date ? 'calendar-drag-target' : ''}`}
            onDragOver={event => { if (!inPlan) return; event.preventDefault(); setDragTargetDate(date) }}
            onDrop={event => inPlan && drop(date, event)}
            onClick={() => {
              if (!inPlan) return
              setDayOpen(date)
              const current = getDayConfig(state, date)
              setPendingDayType(current.type)
              setPendingCustomMinutes(current.customMinutes)
            }}
          >
            <div className="calendar-date"><span>{Number(date.slice(-2))}</span>{config && <small>{dayTypeLabel[config.type]}</small>}</div>
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
                onClick={event => { event.stopPropagation(); setTaskOpenId(assignment.id) }}
                className={assignment.status === 'done' ? 'mini-done' : ''}
              ><span className={`subject-dot subject-${groups.get(assignment.groupId)?.subject}`}/><span>{assignment.title}</span><em>{minutesText(assignment.estimatedMinutes)}</em></div>)}
              {tasks.length > calendarTaskLimit && <button className="calendar-more-button" onClick={event => openOverflow(date, event)}>+{tasks.length - calendarTaskLimit} 项</button>}
            </div>
            {dragTargetDate === date && dragged && <div className={`calendar-drop-preview ${projected > capacity ? 'over' : ''}`}><strong>放入后 {minutesText(projected)}</strong><span>{projected > capacity ? `超载 ${minutesText(projected - capacity)}` : `剩余 ${minutesText(capacity - projected)}`}</span></div>}
            {inPlan && <footer>{minutesText(load)} / {minutesText(capacity)}</footer>}
          </div>
        })}
      </div>
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
            <button className="overflow-task-content" onClick={() => setTaskOpenId(assignment.id)}><span className={`subject-dot subject-${groups.get(assignment.groupId)?.subject}`}/><div><strong>{assignment.title}</strong><span>{groups.get(assignment.groupId)?.subject} · {minutesText(assignment.estimatedMinutes)}</span></div></button>
            {assignment.locked ? <small>已锁定</small> : <button className="text-button" onClick={() => setTaskOpenId(assignment.id)}>移动</button>}
          </div>)}
        </div>
      </section>
    </div>}

    <Modal open={Boolean(dayOpen)} title={dayOpen ? `${fmtDate(dayOpen)} · ${fmtWeekday(dayOpen)}` : '日期'} onClose={() => { setDayOpen(undefined); setSelectedIds([]); setPendingDayType(undefined); setPendingCustomMinutes(undefined) }} wide>
      {dayOpen && dayCfg && dayPreviewState && <>
        <div className="day-settings-row">
          <label className="field"><span>日期类型</span><select value={pendingDayType ?? dayCfg.type} onChange={event => setPendingDayType(event.target.value as DayType)}>{(['regular', 'study', 'travel', 'custom'] as DayType[]).map(type => <option key={type} value={type}>{dayTypeLabel[type]}</option>)}</select></label>
          {(pendingDayType ?? dayCfg.type) === 'custom' && <label className="field"><span>可用分钟</span><input type="number" value={pendingCustomMinutes ?? dayCfg.customMinutes ?? 210} onChange={event => setPendingCustomMinutes(Number(event.target.value))}/></label>}
          <label className="field grow"><span>备注</span><input value={dayCfg.note ?? ''} onChange={event => updateDayConfig(dayOpen, { note: event.target.value })} placeholder="例如：外出、下午补课"/></label>
        </div>
        <div className="day-load-summary day-load-live"><span>预计 {minutesText(loadFor(dayOpen))}</span><span>容量 {minutesText(getCapacity(state, dayOpen))} → {minutesText(getCapacity(dayPreviewState, dayOpen))}</span><span>{dayTasks.filter(task => task.status === 'done').length}/{dayTasks.length} 已完成</span><em className={loadFor(dayOpen) > getCapacity(dayPreviewState, dayOpen) ? 'over' : ''}>{loadFor(dayOpen) > getCapacity(dayPreviewState, dayOpen) ? `调整后超载 ${minutesText(loadFor(dayOpen) - getCapacity(dayPreviewState, dayOpen))}` : `调整后剩余 ${minutesText(getCapacity(dayPreviewState, dayOpen) - loadFor(dayOpen))}`}</em></div>
        <div className="bulk-row"><span>已选择 {selectedIds.length} 项</span><div className="button-wrap">
          {(pendingDayType ?? dayCfg.type) !== dayCfg.type || ((pendingDayType ?? dayCfg.type) === 'custom' && pendingCustomMinutes !== dayCfg.customMinutes) ? <button className="primary-button" onClick={() => {
            const ordinary = dayPreviewState!.assignments.filter(assignment => assignment.scheduledDate === dayOpen && assignment.status !== 'done' && !groups.get(assignment.groupId)?.recurring)
            const newCapacity = getCapacity(dayPreviewState!, dayOpen)
            const newLoad = ordinary.reduce((sum, assignment) => sum + countedMinutes(assignment), 0)
            if (ordinary.length && ((pendingDayType ?? dayCfg.type) === 'travel' || newLoad > newCapacity)) onReplan(dayOpen, dayPreviewState)
            else updateDayConfig(dayOpen, dayPreviewState!.dayConfigs[dayOpen])
          }}>预览并应用日期类型</button> : <button className="secondary-button" onClick={() => onReplan(dayOpen)}>预览局部修复</button>}
          <button className="secondary-button" disabled={!selectedIds.length} onClick={() => bulkMove()}>批量移动</button>
        </div></div>
        <div className="day-task-list">{dayTasks.map(assignment => <label key={assignment.id} className="select-task-row"><input type="checkbox" checked={selectedIds.includes(assignment.id)} onChange={event => setSelectedIds(previous => event.target.checked ? [...previous, assignment.id] : previous.filter(id => id !== assignment.id))}/><button className="select-task-content" onClick={event => { event.preventDefault(); setTaskOpenId(assignment.id) }}><strong>{assignment.title}</strong><span>{groups.get(assignment.groupId)?.subject} · {minutesText(assignment.estimatedMinutes)}</span></button>{assignment.locked && <small>已锁定</small>}</label>)}</div>
      </>}
    </Modal>

    <Drawer open={Boolean(taskOpen)} title={taskOpen?.title ?? '任务详情'} subtitle={taskOpenGroup ? `${taskOpenGroup.subject} · 优先级 ${taskOpenGroup.priority}` : undefined} onClose={() => setTaskOpenId(undefined)}>
      {taskOpen && taskOpenGroup && <div className="task-quick-editor">
        <div className="task-detail-metrics"><div><span>预计时间</span><strong>{minutesText(taskOpen.estimatedMinutes)}</strong></div><div><span>状态</span><strong>{taskOpen.status === 'done' ? '已完成' : taskOpen.status === 'partial' ? '部分完成' : '待完成'}</strong></div><div><span>排期来源</span><strong>{taskOpen.intentStrength === 'manual' ? '用户手动' : taskOpen.scheduleSource}</strong></div></div>
        <label className="field"><span>移动到</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={taskOpen.scheduledDate ?? ''} onChange={event => moveWithValidation(taskOpen.id, event.target.value)}/></label>
        <label className="switch-row"><button type="button" className={`switch ${taskOpen.locked ? 'on' : ''}`} onClick={() => updateAssignment(taskOpen.id, { locked: !taskOpen.locked })}><i/></button><span>锁定任务，自动重排不得移动</span></label>
        <div className="task-impact-note"><strong>目标日期 {taskOpenGroup.targetDate}</strong><span>最终截止 {taskOpenGroup.dueDate}。移动出现超载或越过目标时，系统会先说明后果。</span></div>
      </div>}
    </Drawer>
  </>
}

function TasksPage() {
  const { state, addTaskGroup, editTaskGroup, deleteTaskGroup, moveAssignments } = useApp()
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'all'|Priority>('all')
  const [subject, setSubject] = useState<'all'|Subject>('all')
  const [showHidden, setShowHidden] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<TaskGroup>()
  const assignmentsByGroup = useMemo(() => new Map(state.taskGroups.map(g=>[g.id,state.assignments.filter(a=>a.groupId===g.id)])),[state])
  const groups = state.taskGroups.filter(g => (showHidden || !g.hidden) && (priority==='all'||g.priority===priority) && (subject==='all'||g.subject===subject) && (`${g.subject}${g.title}${g.notes??''}`.toLowerCase().includes(search.toLowerCase())))
  const save = (g: TaskGroup) => editing ? editTaskGroup(g) : addTaskGroup(g)
  const duplicate = (g: TaskGroup) => addTaskGroup({ ...structuredClone(g), id: uid('group'), title: `${g.title}（副本）` })
  const bulkMoveGroup = (g: TaskGroup) => {
    const date = window.prompt(`把“${g.title}”未完成任务移动到哪一天？（YYYY-MM-DD）`)
    if (!date) return
    moveAssignments(state.assignments.filter(a=>a.groupId===g.id&&a.status!=='done'&&!a.locked).map(a=>a.id), date)
  }

  return <>
    <section className="tasks-toolbar">
      <div className="search-box"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索任务"/></div>
      <select value={priority} onChange={e=>setPriority(e.target.value==='all'?'all':Number(e.target.value) as Priority)}><option value="all">全部优先级</option>{[5,3,2,1,0].map(p=><option key={p} value={p}>优先级 {p}</option>)}</select>
      <select value={subject} onChange={e=>setSubject(e.target.value as 'all'|Subject)}><option value="all">全部科目</option>{['语文','数学','英语','物理','化学','生物','其他'].map(s=><option key={s}>{s}</option>)}</select>
      <label className="toggle-label"><input type="checkbox" checked={showHidden} onChange={e=>setShowHidden(e.target.checked)}/><span>显示优先级 0</span></label>
      <button className="primary-button" onClick={()=>{setEditing(undefined);setDialog(true)}}><Plus size={17}/>新增任务</button>
    </section>
    <section className="group-list">
      {groups.map(g=>{
        const items=assignmentsByGroup.get(g.id)??[]
        const done=items.filter(a=>a.status==='done').length
        const actual=items.reduce((s,a)=>s+a.actualMinutes,0)
        const planned=items.reduce((s,a)=>s+a.estimatedMinutes,0)
        const durationSuggestion=getDurationSuggestion(state,g.id)
        return <article className="group-card" key={g.id}>
          <div className="group-card-head"><div><span className={`subject-pill subject-${g.subject}`}>{g.subject}</span><span className={`priority-badge priority-${g.priority}`}>P{g.priority}</span><h3>{g.title}</h3></div><div className="group-actions"><button className="text-button" onClick={()=>bulkMoveGroup(g)}>移动未完成</button><button className="text-button" onClick={()=>duplicate(g)}>复制</button><button className="text-button" onClick={()=>{setEditing(g);setDialog(true)}}>编辑</button><button className="icon-button danger-icon" onClick={()=>window.confirm('删除该任务及其所有子任务？')&&deleteTaskGroup(g.id)}><Trash2 size={17}/></button></div></div>
          <div className="group-stats"><span>{done}/{items.length} 已完成</span><span>预计 {minutesText(planned)}</span><span>实际 {minutesText(actual)}</span><span>目标 {fmtDate(g.targetDate)}</span>{g.dailyMax&&<span>每天最多 {g.dailyMax} 个</span>}</div>
          <div className="progress-track"><i style={{width:`${items.length?done/items.length*100:0}%`}}/></div>
          {(g.notes||g.sourceLabel)&&<p className="group-note">{g.notes||g.sourceLabel}</p>}
          {durationSuggestion&&<div className="duration-suggestion"><div><strong>用时校准建议</strong><span>最近 {durationSuggestion.sampleSize} 次记录建议把单次预计从 {durationSuggestion.currentMinutes} 分钟调整为 {durationSuggestion.minutes} 分钟。</span></div><button className="secondary-button" onClick={()=>editTaskGroup({...g,unitMinutes:durationSuggestion.minutes})}>接受建议</button></div>}
        </article>
      })}
      {!groups.length&&<EmptyState title="没有符合条件的任务" text="调整筛选条件，或新增一项任务。"/>}
    </section>
    <TaskGroupDialog open={dialog} onClose={()=>setDialog(false)} initial={editing} defaults={{targetDate:state.settings.endDate,dueDate:state.settings.endDate}} onSave={save}/>
  </>
}

function StatsPage() {
  const { state } = useApp()
  const groups = new Map(state.taskGroups.map(g=>[g.id,g]))
  const dates = dateRange(state.settings.startDate,state.settings.endDate)
  const daily = dates.map(date=>{
    const tasks=state.assignments.filter(a=>a.scheduledDate===date)
    return { date: date.slice(5).replace('-','.'), planned: tasks.reduce((s,a)=>s+((groups.get(a.groupId)?.countInStats||state.settings.countWordsTime)?a.estimatedMinutes:0),0), actual: tasks.reduce((s,a)=>s+a.actualMinutes,0) }
  })
  const subjectData = ['语文','数学','英语','物理','化学','生物','其他'].map(subject=>{
    const ids=new Set(state.taskGroups.filter(g=>g.subject===subject).map(g=>g.id))
    const items=state.assignments.filter(a=>ids.has(a.groupId))
    return { subject, planned: items.reduce((s,a)=>s+a.estimatedMinutes,0), actual: items.reduce((s,a)=>s+a.actualMinutes,0) }
  }).filter(x=>x.planned>0)
  const priorityData = [5,3,2,1,0].map(p=>{
    const ids=new Set(state.taskGroups.filter(g=>g.priority===p).map(g=>g.id)); const items=state.assignments.filter(a=>ids.has(a.groupId)); const done=items.filter(a=>a.status==='done').length
    return { priority:`P${p}`, completion:items.length?Math.round(done/items.length*100):0 }
  })
  const totalPlan = state.assignments.reduce((s,a)=>s+((groups.get(a.groupId)?.countInStats||state.settings.countWordsTime)?a.estimatedMinutes:0),0)
  const totalActual = state.assignments.reduce((s,a)=>s+a.actualMinutes,0)
  const corePrediction = predictCompletion(state,g=>g.priority===5&&!g.recurring&&g.targetDate<=state.settings.coreTargetDate)
  const chemPrediction = predictCompletion(state,g=>g.subject==='化学'&&g.title==='预习')
  const remaining = state.assignments.filter(a=>a.status!=='done'&&(groups.get(a.groupId)?.priority??0)>0).reduce((s,a)=>s+effectiveMinutes(a),0)

  return <>
    <section className="summary-grid stats-summary">
      <div className="metric-card"><span>累计实际学习</span><strong>{minutesText(totalActual)}</strong><small>计划总量 {minutesText(totalPlan)}</small></div>
      <div className="metric-card"><span>计划与实际差值</span><strong>{totalActual-totalPlan>0?'+':''}{minutesText(Math.abs(totalActual-totalPlan))}</strong><small>{totalActual>totalPlan?'实际高于预计':'实际低于预计'}</small></div>
      <div className="metric-card"><span>核心任务预计完成</span><strong>{corePrediction==='已完成'?'已完成':corePrediction?fmtDate(corePrediction):'尚无法预测'}</strong><small>目标 {fmtDate(state.settings.coreTargetDate)}</small></div>
      <div className="metric-card"><span>剩余预计时间</span><strong>{minutesText(remaining)}</strong><small>化学预习：{chemPrediction==='已完成'?'已完成':chemPrediction?fmtDate(chemPrediction):'待排期'}</small></div>
    </section>
    <section className="chart-grid">
      <ChartCard title="每日计划与实际"><ResponsiveContainer width="100%" height={280}><LineChart data={daily}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" interval={3}/><YAxis/><Tooltip formatter={(v:number)=>`${v} 分钟`}/><Legend/><Line type="monotone" dataKey="planned" name="计划" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="actual" name="实际" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></ChartCard>
      <ChartCard title="各科计划与实际"><ResponsiveContainer width="100%" height={280}><BarChart data={subjectData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="subject"/><YAxis/><Tooltip formatter={(v:number)=>`${v} 分钟`}/><Legend/><Bar dataKey="planned" name="计划" radius={[6,6,0,0]}/><Bar dataKey="actual" name="实际" radius={[6,6,0,0]}/></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="优先级完成进度"><ResponsiveContainer width="100%" height={280}><BarChart data={priorityData} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" domain={[0,100]} tickFormatter={v=>`${v}%`}/><YAxis type="category" dataKey="priority"/><Tooltip formatter={(v:number)=>`${v}%`}/><Bar dataKey="completion" name="完成率" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="各科实际时间占比"><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={subjectData.filter(x=>x.actual>0)} dataKey="actual" nameKey="subject" outerRadius={90} label>{subjectData.map((_,i)=><Cell key={i}/>)}</Pie><Tooltip formatter={(v:number)=>`${v} 分钟`}/><Legend/></PieChart></ResponsiveContainer></ChartCard>
    </section>
  </>
}

function SettingsPage({ sessionEmail, cloudMessage }: { sessionEmail?: string; cloudMessage?: string }) {
  const { state, namespace, updateSettings, undo, canUndo, replaceState, resetAll, restoreReplanHistory } = useApp()
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [authMessage,setAuthMessage]=useState('')
  const [historyEntry,setHistoryEntry]=useState<AppState['replanHistory'][number]>()
  const fileRef=useRef<HTMLInputElement>(null)

  const exportJson=()=>downloadBlob(JSON.stringify(state,null,2),`study-plan-${todayISO()}.json`,'application/json')
  const exportCsv=()=>{
    const groups=new Map(state.taskGroups.map(g=>[g.id,g])); const rows=[['科目','任务','计划日期','状态','预计分钟','实际分钟','进度','优先级','排期来源','用户意图']]
    for(const a of state.assignments){const g=groups.get(a.groupId);if(g)rows.push([g.subject,a.title,a.scheduledDate??'',a.status,String(a.estimatedMinutes),String(a.actualMinutes),String(a.progress),String(g.priority),a.scheduleSource,a.intentStrength])}
    downloadBlob('\ufeff'+rows.map(r=>r.map(csvEscape).join(',')).join('\n'),`study-plan-${todayISO()}.csv`,'text/csv;charset=utf-8')
  }
  const importJson=(file:File)=>{const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(String(reader.result)) as AppState;if(!parsed.version||!parsed.taskGroups)throw new Error();if(window.confirm('导入会覆盖当前数据，是否继续？'))replaceState(parsed,true)}catch{window.alert('无法识别这个备份文件。')}};reader.readAsText(file)}
  const login=async(kind:'in'|'up')=>{try{setAuthMessage('处理中……');await(kind==='in'?signIn(email,password):signUp(email,password));setAuthMessage(kind==='in'?'登录成功，正在恢复云端计划':'注册请求已提交，请检查邮箱。')}catch(e){setAuthMessage(e instanceof Error?e.message:'操作失败')}}
  const cloudUpload=async()=>{try{const t=await uploadSnapshot(state);setAuthMessage(`已同步：${new Date(t).toLocaleString()}`)}catch(e){setAuthMessage(e instanceof Error?e.message:'同步失败')}}
  const cloudDownload=async()=>{try{const cloud=await downloadSnapshot();if(!cloud){setAuthMessage('云端尚无数据');return}if(window.confirm('用云端数据覆盖当前数据？当前状态会保留在撤销历史中。'))replaceState(cloud,true);setAuthMessage('已从云端恢复')}catch(e){setAuthMessage(e instanceof Error?e.message:'下载失败')}}
  const restoreConflict=(raw:string)=>{try{const parsed=JSON.parse(raw) as AppState;if(window.confirm('恢复这份冲突备份？当前状态会保留在撤销历史中。'))replaceState(parsed,true)}catch{window.alert('冲突备份已损坏，无法恢复。')}}

  return <div className="settings-stack">
    <SettingsSection title="计划设置" description="这些参数会参与容量计算、完成日期预测与重新排期。">
      <div className="form-grid">
        <label className="field span-2"><span>计划名称</span><input value={state.settings.planName} onChange={e=>updateSettings({planName:e.target.value})}/></label>
        <label className="field"><span>开始日期</span><input type="date" value={state.settings.startDate} onChange={e=>updateSettings({startDate:e.target.value})}/></label>
        <label className="field"><span>结束日期</span><input type="date" value={state.settings.endDate} onChange={e=>updateSettings({endDate:e.target.value})}/></label>
        <label className="field"><span>核心任务目标</span><input type="date" value={state.settings.coreTargetDate} onChange={e=>updateSettings({coreTargetDate:e.target.value})}/></label>
        <label className="field"><span>化学预习目标</span><input type="date" value={state.settings.chemistryTargetDate} onChange={e=>updateSettings({chemistryTargetDate:e.target.value})}/></label>
        <label className="field"><span>检查缓冲天数</span><input type="number" min="0" value={state.settings.bufferDays} onChange={e=>updateSettings({bufferDays:Number(e.target.value)})}/></label>
        <label className="field"><span>默认排期风格</span><select value={state.settings.planningMode} onChange={e=>updateSettings({planningMode:e.target.value as AppState['settings']['planningMode']})}><option value="sprint">冲刺</option><option value="balanced">平衡</option><option value="relaxed">轻松</option></select></label>
      </div>
    </SettingsSection>
    <SettingsSection title="自动重排偏好" description="这些是软约束。系统会说明突破它们的原因，不会把建议伪装成强制决定。">
      <div className="form-grid three">
        <label className="field"><span>冻结近期天数</span><input type="number" min="0" max="7" value={state.settings.freezeDays} onChange={e=>updateSettings({freezeDays:Number(e.target.value)})}/></label>
        <label className="field"><span>常规日最多任务</span><input type="number" min="1" value={state.settings.regularMaxTasks} onChange={e=>updateSettings({regularMaxTasks:Number(e.target.value)})}/></label>
        <label className="field"><span>学习日最多任务</span><input type="number" min="1" value={state.settings.studyMaxTasks} onChange={e=>updateSettings({studyMaxTasks:Number(e.target.value)})}/></label>
        <label className="field"><span>常规日允许软超载（分钟）</span><input type="number" min="0" value={state.settings.regularOverbookMinutes} onChange={e=>updateSettings({regularOverbookMinutes:Number(e.target.value)})}/></label>
        <label className="field"><span>学习日允许软超载（分钟）</span><input type="number" min="0" value={state.settings.studyOverbookMinutes} onChange={e=>updateSettings({studyOverbookMinutes:Number(e.target.value)})}/></label>
        <label className="field"><span>单科建议占比上限（%）</span><input type="number" min="30" max="100" value={Math.round(state.settings.subjectShareLimit*100)} onChange={e=>updateSettings({subjectShareLimit:Number(e.target.value)/100})}/></label>
      </div>
    </SettingsSection>
    <SettingsSection title="每日容量" description="容量是软上限；明显超载只会进入预览，不会被静默应用。">
      <div className="form-grid three">
        <label className="field"><span>常规日（分钟）</span><input type="number" value={state.settings.regularMinutes} onChange={e=>updateSettings({regularMinutes:Number(e.target.value)})}/></label>
        <label className="field"><span>学习日（分钟）</span><input type="number" value={state.settings.studyMinutes} onChange={e=>updateSettings({studyMinutes:Number(e.target.value)})}/></label>
        <label className="field"><span>旅游日（分钟）</span><input type="number" value={state.settings.travelMinutes} onChange={e=>updateSettings({travelMinutes:Number(e.target.value)})}/></label>
      </div>
      <div className="toggle-grid"><Toggle checked={state.settings.countWordsTime} onChange={v=>updateSettings({countWordsTime:v})} label="把每日单词计入计划与统计时间"/><Toggle checked={state.settings.showWarnings} onChange={v=>updateSettings({showWarnings:v})} label="显示黄色和红色进度提醒"/><Toggle checked={state.settings.optionalReview} onChange={v=>updateSettings({optionalReview:v})} label="显示可选每日复盘入口"/><Toggle checked={state.settings.keepOfflineOnLogout} onChange={v=>updateSettings({keepOfflineOnLogout:v})} label="退出登录后在此设备保留个人离线缓存"/></div>
    </SettingsSection>
    <SettingsSection title="重排历史" description="每次应用重排都会保存一个快照，最多保留最近 10 次。恢复旧版本本身仍可撤销。">
      <div className="history-list">{state.replanHistory.length? [...state.replanHistory].reverse().map(entry=><div className="history-row" key={entry.id}><div><strong>{entry.label}</strong><span>{new Date(entry.createdAt).toLocaleString()} · 移动 {entry.moveCount} 项</span>{entry.audit&&<div className="history-audit-summary"><span>人工决策 {entry.audit.decisions.length}</span><span>日期调整 {entry.audit.dayTypes.length}</span></div>}</div><div className="button-wrap">{entry.afterSnapshot&&<button className="secondary-button" onClick={()=>setHistoryEntry(entry)}>查看差异</button>}<button className="secondary-button" onClick={()=>window.confirm('恢复到这个重排前版本？')&&restoreReplanHistory(entry.id)}>恢复</button></div></div>):<p className="muted-text">还没有重排历史。</p>}</div>
    </SettingsSection>
    <SettingsSection title="数据与恢复" description={`当前数据空间：${namespace==='guest'?'游客演示':sessionEmail??'个人账号'}。JSON 备份可能包含个人计划，请妥善保管。`}>
      <div className="button-wrap"><button className="secondary-button" onClick={exportJson}><Download size={16}/>导出 JSON</button><button className="secondary-button" onClick={exportCsv}><FileDown size={16}/>导出 CSV</button><button className="secondary-button" onClick={()=>window.print()}><FileDown size={16}/>打印 / 导出 PDF</button><button className="secondary-button" onClick={()=>fileRef.current?.click()}><Upload size={16}/>导入 JSON</button><input ref={fileRef} type="file" accept="application/json" hidden onChange={e=>e.target.files?.[0]&&importJson(e.target.files[0])}/><button className="secondary-button" disabled={!canUndo} onClick={undo}><RotateCcw size={16}/>恢复上一步</button>{namespace==='guest'&&<button className="secondary-button" onClick={()=>window.confirm('恢复默认演示数据？')&&resetAll('demo')}>恢复演示数据</button>}<button className="danger-button" onClick={()=>window.confirm('确认重置当前数据空间？请先导出备份。')&&resetAll(namespace==='guest'?'demo':'blank')}><Trash2 size={16}/>重置计划</button></div>
      {(state.conflictBackups?.length??0)>0&&<div className="conflict-backups"><strong>同步冲突备份</strong><p>检测到不同设备版本时会保留副本，不会静默覆盖。</p>{state.conflictBackups!.slice(-5).reverse().map((raw,i)=><div key={i}><span>备份 {state.conflictBackups!.length-i}</span><div className="button-wrap"><button className="text-button" onClick={()=>restoreConflict(raw)}>恢复</button><button className="text-button" onClick={()=>downloadBlob(raw,`study-plan-conflict-${i+1}.json`,'application/json')}>下载</button></div></div>)}</div>}
    </SettingsSection>
    <SettingsSection title="Supabase 云同步" description={supabaseConfigured?'登录后自动恢复当前账号数据，之后修改自动保存。游客数据永远不会上传。':'尚未配置。复制 .env.example 为 .env，并填写项目 URL 与 publishable / anon key。'}>
      {!supabaseConfigured?<div className="code-note">VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</div>:sessionEmail?<div className="cloud-panel"><div><Cloud size={20}/><span>已登录：{sessionEmail}</span></div><div className="button-wrap"><button className="secondary-button" onClick={cloudUpload}>立即上传</button><button className="secondary-button" onClick={cloudDownload}>从云端恢复</button><button className="secondary-button" onClick={()=>signOut()}>退出登录</button></div></div>:<div className="auth-form"><input type="email" placeholder="邮箱" value={email} onChange={e=>setEmail(e.target.value)}/><input type="password" placeholder="密码" value={password} onChange={e=>setPassword(e.target.value)}/><button className="primary-button" onClick={()=>login('in')}>登录</button><button className="secondary-button" onClick={()=>login('up')}>注册</button></div>}
      {(authMessage||cloudMessage)&&<p className="settings-message">{authMessage||cloudMessage}</p>}
    </SettingsSection>
    <SettingsSection title="DeepSeek API" description="当前仍只预留扩展位置，不把 AI 作为排期核心依赖。">
      <div className="reserved-card"><Sparkles size={21}/><div><strong>AI 功能暂未启用</strong><p>后续可通过服务端代理加入自然语言录入、周总结与复杂解释。核心排期保持离线可用和可解释。</p></div></div>
    </SettingsSection>
    <HistoryDiffDialog entry={historyEntry} onClose={()=>setHistoryEntry(undefined)}/>
  </div>
}

function SettingsSection({title,description,children}:{title:string;description:string;children:React.ReactNode}){return <section className="settings-section"><div><h2>{title}</h2><p>{description}</p></div><div>{children}</div></section>}
function Toggle({checked,onChange,label}:{checked:boolean;onChange:(v:boolean)=>void;label:string}){return <label className="switch-row"><button type="button" className={`switch ${checked?'on':''}`} onClick={()=>onChange(!checked)}><i/></button><span>{label}</span></label>}
function ChartCard({title,children}:{title:string;children:React.ReactNode}){return <section className="chart-card"><h3>{title}</h3>{children}</section>}
function EmptyState({title,text}:{title:string;text:string}){return <div className="empty-state"><CheckCircle2 size={30}/><h3>{title}</h3><p>{text}</p></div>}
function downloadBlob(content:string,name:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function csvEscape(v:string){return `"${v.replaceAll('"','""')}"`}
