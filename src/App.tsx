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
import { cloneActiveState } from './lib/state'
import { buildBlankState, buildGuestDemoState, normalizeState } from './lib/seed'
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
import { IntakePage } from './components/IntakePage'
import { ExportPage } from './components/ExportPage'
import { NumericInput } from './components/NumericInput'
import { adjustmentPolicyForEvent, eventWithPreferences } from './lib/adjustment'
import { applyConflictDecisions, mergeConstraintExceptions } from './lib/conflicts'
import { downloadSnapshot, getSession, preparePortableState, signIn, signOut, signUp, supabase, supabaseConfigured, uploadSnapshot } from './lib/supabase'
import { buildCalendarPrintHtml, buildCalendarSvg, downloadSvgAsPng, safeExportName } from './lib/exports'
import { Analytics } from '@vercel/analytics/react'
import './styles.css'

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
    state, namespace, ready, updateSettings, prepareSingleAssignment, prepareTaskGroup,
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
  const [cloudReady, setCloudReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('local')
  const [firstLoginOpen, setFirstLoginOpen] = useState(false)
  const [cloudMessage, setCloudMessage] = useState('')
  const [actionNotice, setActionNotice] = useState<string>()
  const [dataSwitching, setDataSwitching] = useState(false)
  const currentIssueCount = useMemo(() => analyzePlan(state, todayISO()).filter(issue => issue.level === 'danger').length, [state])
  const previousUserId = useRef<string>()
  const guestSnapshotRef = useRef<AppState>()
  const [guestImportAvailable, setGuestImportAvailable] = useState(false)
  const stateRef = useRef(state)
  const cloudSaveQueue = useRef<CloudSaveQueue>({})
  stateRef.current = state

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
    if (!ready || initialRouteHandled.current) return
    initialRouteHandled.current = true
    const trulyBlank = state.assignments.length === 0 && state.taskGroups.length === 0 && state.intakeBatches.length === 0
    if (trulyBlank && (state.templateKind === 'blank' || namespace !== 'guest')) setPage('intake')
  }, [ready, namespace, state.assignments.length, state.taskGroups.length, state.intakeBatches.length, state.templateKind])

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
…30476 tokens truncated…ate) {
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
    <SettingsSection title="计划基础" description="目标日期已统一迁移到“目标”页面，这里只保留计划边界和默认风格，避免多个可编辑真相。"><div className="form-grid"><label className="field span-2"><span>计划名称</span><input value={planNameDraft} onChange={event=>setPlanNameDraft(event.target.value)} onBlur={()=>planNameDraft!==state.settings.planName&&updateSettings({planName:planNameDraft})}/></label><label className="field"><span>开始日期</span><input type="date" value={state.settings.startDate} onChange={event=>prepareSettingsChange({startDate:event.target.value}, '调整计划开始日期', 'availability-change')}/></label><label className="field"><span>结束日期</span><input type="date" value={state.settings.endDate} onChange={event=>prepareSettingsChange({endDate:event.target.value}, '调整计划结束日期', 'availability-change')}/></label><label className="field"><span>默认排期风格</span><select value={state.settings.planningMode} onChange={event=>updateSettings({planningMode:event.target.value as AppState['settings']['planningMode']})}><option value="sprint">冲刺</option><option value="balanced">平衡</option><option value="relaxed">轻松</option></select></label></div></SettingsSection>
    <SettingsSection title="显示" description="跟随系统适合多设备使用；深色模式会同步调整页面、弹窗、表单和统计图表的对比度。"><div className="form-grid"><label className="field"><span>颜色模式</span><select value={state.settings.theme} onChange={event=>updateSettings({theme:event.target.value as AppState['settings']['theme']})}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></div></SettingsSection>
    <details className="settings-advanced"><summary>高级排期参数</summary><div className="settings-advanced-body">
    <SettingsSection title="排期偏好" description="这些是可解释的偏好和范围参数；硬约束、用户手动安排、锁定、执行状态与日期保护不会被静默突破。"><div className="form-grid three"><label className="field"><span>冻结近期天数</span><NumericInput commitMode="blur" min={0} max={7} value={state.settings.freezeDays} onValueChange={value=>updateSettings({freezeDays:value})}/></label><label className="field"><span>常规日最多任务</span><NumericInput commitMode="blur" min={1} max={100} value={state.settings.regularMaxTasks} onValueChange={value=>updateSettings({regularMaxTasks:value})}/></label><label className="field"><span>学习日最多任务</span><NumericInput commitMode="blur" min={1} max={100} value={state.settings.studyMaxTasks} onValueChange={value=>updateSettings({studyMaxTasks:value})}/></label><label className="field"><span>均衡方案目标利用率（%）</span><NumericInput commitMode="blur" min={50} max={100} value={Math.round(state.settings.targetUtilization*100)} onValueChange={value=>updateSettings({targetUtilization:value/100})}/></label><label className="field"><span>接近满载提示线（%）</span><NumericInput commitMode="blur" min={60} max={100} value={Math.round(state.settings.nearFullThreshold*100)} onValueChange={value=>updateSettings({nearFullThreshold:value/100})}/></label><label className="field"><span>缓冲日目标利用率（%）</span><NumericInput commitMode="blur" min={0} max={80} value={Math.round(state.settings.bufferUtilization*100)} onValueChange={value=>updateSettings({bufferUtilization:value/100})}/></label><label className="field"><span>小范围调整优先半径（天）</span><NumericInput commitMode="blur" min={1} max={14} value={state.settings.localRepairRadius} onValueChange={value=>updateSettings({localRepairRadius:value})}/></label><label className="field"><span>单日尽量最多新增任务</span><NumericInput commitMode="blur" min={0} max={10} value={state.settings.maxNewTasksPerDay} onValueChange={value=>updateSettings({maxNewTasksPerDay:value})}/></label><label className="field"><span>单日负载变化预算（%容量）</span><NumericInput commitMode="blur" min={0} max={100} value={Math.round(state.settings.maxLoadChangeRatio*100)} onValueChange={value=>updateSettings({maxLoadChangeRatio:value/100})}/></label><label className="field"><span>单类别建议占比上限（%）</span><NumericInput commitMode="blur" min={30} max={100} value={Math.round(state.settings.subjectShareLimit*100)} onValueChange={value=>updateSettings({subjectShareLimit:value/100})}/></label></div></SettingsSection>
    <SettingsSection title="每日容量" description="容量是默认硬上限。今天已经学习的实际时间会消耗容量，即使该任务不计入正式统计。"><div className="form-grid three"><label className="field"><span>常规日（分钟）</span><NumericInput commitMode="blur" min={0} max={1440} value={state.settings.regularMinutes} onValueChange={value=>prepareSettingsChange({regularMinutes:value}, '调整常规日默认容量', 'availability-change')}/></label><label className="field"><span>学习日（分钟）</span><NumericInput commitMode="blur" min={0} max={1440} value={state.settings.studyMinutes} onValueChange={value=>prepareSettingsChange({studyMinutes:value}, '调整学习日默认容量', 'availability-change')}/></label><label className="field"><span>旅游日（分钟）</span><NumericInput commitMode="blur" min={0} max={1440} value={state.settings.travelMinutes} onValueChange={value=>prepareSettingsChange({travelMinutes:value}, '调整旅游日默认容量', 'availability-change')}/></label></div><div className="toggle-grid"><Toggle checked={state.settings.countWordsTime} onChange={value=>updateSettings({countWordsTime:value})} label="把每日单词计入正式计划与统计时间"/><Toggle checked={state.settings.showWarnings} onChange={value=>updateSettings({showWarnings:value})} label="显示进度风险提醒"/><Toggle checked={state.settings.optionalReview} onChange={value=>updateSettings({optionalReview:value})} label="当天任务全部完成时自动打开复盘（入口始终保留）"/><Toggle checked={state.settings.keepOfflineOnLogout} onChange={value=>updateSettings({keepOfflineOnLogout:value})} label="退出登录后保留个人离线缓存"/></div></SettingsSection>
    <CalendarConstraintManager onPrepared={onPrepared}/>
    <SettingsSection title="自定义科目／类别" description="保留学习预设，同时允许增加自己的类别；存储层不会把产品永久限制为学校科目。"><div className="custom-subject-editor"><div className="button-wrap"><input value={subjectDraft} onChange={event=>setSubjectDraft(event.target.value)} placeholder="例如：数学竞赛、研究项目"/><button className="primary-button" onClick={addSubject}>添加</button></div><div className="tag-list">{state.settings.customSubjects.map(item=><span key={item}>{item}<button aria-label={`删除${item}`} onClick={()=>updateSettings({customSubjects:state.settings.customSubjects.filter(subject=>subject!==item)})}>×</button></span>)}</div></div></SettingsSection>
    <SettingsSection title="自适应时长建议" description="只使用最近有效样本生成建议，不自动覆盖预计或移动日历；孤立异常值按 IQR 规则降低影响。"><div className="form-grid three"><label className="field"><span>历史窗口（最近完成数）</span><NumericInput commitMode="blur" min={3} max={50} value={state.settings.duration.windowSize} onValueChange={value=>updateSettings({duration:{...state.settings.duration,windowSize:value}})}/></label><label className="field"><span>最少样本数</span><NumericInput commitMode="blur" min={2} max={20} value={state.settings.duration.minimumSamples} onValueChange={value=>updateSettings({duration:{...state.settings.duration,minimumSamples:value}})}/></label><label className="field"><span>偏差提示阈值（%）</span><NumericInput commitMode="blur" min={5} max={100} value={Math.round(state.settings.duration.deviationThreshold*100)} onValueChange={value=>updateSettings({duration:{...state.settings.duration,deviationThreshold:value/100}})}/></label></div><Toggle checked={state.settings.duration.enabled} onChange={value=>updateSettings({duration:{...state.settings.duration,enabled:value}})} label="启用复盘中的时长建议"/></SettingsSection>
    </div></details>
    <details className="settings-advanced"><summary>恢复与维护</summary><div className="settings-advanced-body">
    <SettingsSection title="计划版本与恢复" description="重大变更保存为本机版本，最多 10 个。完整历史当前仅存于此设备，不进入普通 Supabase 自动保存载荷。"><div className="history-list">{state.planVersions.length?[...state.planVersions].reverse().map(version=><div className="history-row" key={version.id}><div><strong>{version.reason}</strong><span>{new Date(version.timestamp).toLocaleString()} · 移动 {version.summary.movedTaskCount} 项 · 影响 {version.summary.affectedDateCount} 日</span><small>本机版本 · schema v{version.schemaVersion}</small></div><div className="button-wrap"><button className="secondary-button" onClick={()=>setVersionOpen(version)}>查看恢复差异</button></div></div>):<p className="muted-text">还没有重大计划版本。</p>}</div></SettingsSection>
    {state.replanHistory.length > 0 && <SettingsSection title="旧版恢复记录" description="仅在检测到旧版本历史时显示。"><div className="history-list">{[...state.replanHistory].reverse().map(entry=><div className="history-row" key={entry.id}><div><strong>{entry.label}</strong><span>{new Date(entry.createdAt).toLocaleString()} · 移动 {entry.moveCount} 项</span></div><div className="button-wrap">{entry.afterSnapshot&&<button className="secondary-button" onClick={()=>setHistoryEntry(entry)}>查看差异</button>}<button className="secondary-button" onClick={()=>restoreReplanHistory(entry.id)}>恢复</button></div></div>)}</div></SettingsSection>}
    </div></details>
    <SettingsSection title="数据与恢复" description={`当前数据空间：${namespace==='guest'?'游客演示':sessionEmail??'个人账号'}。JSON 备份可能包含个人计划，请妥善保管。`}><div className="button-wrap"><button className="secondary-button" onClick={exportJson}><Download size={16}/>导出 JSON</button><button className="secondary-button" onClick={exportCsv}><FileDown size={16}/>导出 CSV</button><button className="secondary-button" onClick={()=>window.print()}><FileDown size={16}/>打印 / 导出 PDF</button><button className="secondary-button" onClick={()=>fileRef.current?.click()}><Upload size={16}/>导入 JSON</button><input ref={fileRef} type="file" accept="application/json" hidden onChange={event=>event.target.files?.[0]&&importJson(event.target.files[0])}/><button className="secondary-button" disabled={!canUndo} onClick={undo}><RotateCcw size={16}/>恢复上一步</button>{namespace==='guest'&&<><button className="secondary-button" onClick={()=>window.confirm('恢复完整功能演示计划？当前游客修改会被覆盖。')&&resetAll('demo')}>恢复演示计划</button><button className="secondary-button" onClick={()=>window.confirm('从空白计划开始？当前游客数据会被清空。')&&resetAll('blank')}>从空白开始</button></>}<button className="danger-button" onClick={()=>window.confirm('确认重置当前数据空间？请先导出备份。')&&resetAll(namespace==='guest'?'demo':'blank')}><Trash2 size={16}/>重置计划</button></div>{state.conflictBackups.length>0&&<div className="conflict-backups"><strong>同步冲突备份</strong><p>不同设备冲突会保留副本，不静默覆盖。</p>{state.conflictBackups.slice(-5).reverse().map((raw,index)=><div key={index}><span>备份 {state.conflictBackups.length-index}</span><div className="button-wrap"><button className="text-button" onClick={()=>restoreConflict(raw)}>恢复</button><button className="text-button" onClick={()=>downloadBlob(raw,`study-plan-conflict-${index+1}.json`,'application/json')}>下载</button></div></div>)}</div>}</SettingsSection>
    {supabaseConfigured && <SettingsSection title="账号与同步" description="登录后同步当前计划；完整版本历史仍保留在本机。">{sessionEmail?<div className="cloud-panel"><div><Cloud size={20}/><span>已登录：{sessionEmail}</span></div><div className="button-wrap"><button className="secondary-button" onClick={cloudUpload}>立即上传</button><button className="secondary-button" onClick={cloudDownload}>从云端恢复</button><button className="secondary-button" onClick={()=>signOut()}>退出登录</button></div></div>:<div className="auth-form"><input type="email" placeholder="邮箱" value={email} onChange={event=>setEmail(event.target.value)}/><input type="password" placeholder="密码" value={password} onChange={event=>setPassword(event.target.value)}/><button className="primary-button" onClick={()=>login('in')}>登录</button><button className="secondary-button" onClick={()=>login('up')}>注册</button></div>}{(authMessage||cloudMessage)&&<p className="settings-message">{authMessage||cloudMessage}</p>}</SettingsSection>}

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
