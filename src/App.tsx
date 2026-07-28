import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BarChart3, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Cloud, CloudOff,
  Download, FileDown, Filter, LayoutDashboard, ListTodo, Menu, Plus, RefreshCw,
  RotateCcw, Search, Settings as SettingsIcon, Sparkles, Trash2, Upload, X
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import { addMonths, endOfMonth, format, getDay, isWithinInterval, parseISO, startOfMonth } from 'date-fns'
import { useApp } from './AppContext'
import type { AppState, Assignment, DayType, Priority, ReplanResult, Subject, TaskGroup } from './types'
import { clampDate, dateRange, dayTypeLabel, fmtDate, fmtWeekday, getCapacity, getDayConfig, minutesText, todayISO } from './lib/date'
import { predictCompletion } from './lib/planner'
import { uid } from './lib/id'
import { Modal } from './components/Modal'
import { TaskCard } from './components/TaskCard'
import { ReplanDialog } from './components/ReplanDialog'
import { TaskGroupDialog } from './components/TaskGroupDialog'
import { downloadSnapshot, getSession, signIn, signOut, signUp, supabase, supabaseConfigured, uploadSnapshot } from './lib/supabase'
import './styles.css'

type Page = 'today' | 'calendar' | 'tasks' | 'stats' | 'settings'
type CloudSyncStatus = 'local' | 'restoring' | 'saving' | 'saved' | 'error'

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'today', label: '今日', icon: LayoutDashboard },
  { id: 'calendar', label: '月历', icon: CalendarDays },
  { id: 'tasks', label: '全部任务', icon: ListTodo },
  { id: 'stats', label: '统计', icon: BarChart3 },
  { id: 'settings', label: '设置', icon: SettingsIcon }
]

export default function App() {
  const { state, ready, loadedFromStorage, updateSettings, previewReplan, applyReplan, replaceState } = useApp()
  const [page, setPage] = useState<Page>('today')
  const [mobileNav, setMobileNav] = useState(false)
  const [replan, setReplan] = useState<ReplanResult>()
  const [replanOpen, setReplanOpen] = useState(false)
  const [sessionUser, setSessionUser] = useState<{ id: string; email?: string }>()
  const [cloudReady, setCloudReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>('local')
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    if (!supabase) return
    const applySession = (session: Session | null) => {
      const user = session ? { id: session.user.id, email: session.user.email } : undefined
      setSessionUser(user)
      if (!user) {
        setCloudReady(false)
        setSyncStatus('local')
      }
    }
    getSession().then(applySession)
    const { data } = supabase.auth.onAuthStateChange((_event, session) => applySession(session))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!ready || !sessionUser?.id) return
    let cancelled = false
    setCloudReady(false)
    setSyncStatus('restoring')

    const bootstrapCloud = async () => {
      try {
        const local = structuredClone(stateRef.current)
        const cloud = await downloadSnapshot()
        if (cancelled) return
        const deviceUserKey = 'study-planner-cloud-user'
        const firstLoginOnDevice = window.localStorage.getItem(deviceUserKey) !== sessionUser.id

        if (cloud) {
          const cloudUpdatedAt = Date.parse(cloud.updatedAt) || 0
          const localUpdatedAt = Date.parse(local.updatedAt) || 0
          const restoreCloud = firstLoginOnDevice || !loadedFromStorage || cloudUpdatedAt >= localUpdatedAt
          if (restoreCloud) {
            cloud.conflictBackups = [...(cloud.conflictBackups ?? []).slice(-2), local]
            replaceState(cloud, false)
          } else {
            await uploadSnapshot(local)
          }
        } else {
          await uploadSnapshot(local)
        }

        window.localStorage.setItem(deviceUserKey, sessionUser.id)
        if (!cancelled) {
          setCloudReady(true)
          setSyncStatus('saved')
        }
      } catch {
        if (!cancelled) {
          setCloudReady(false)
          setSyncStatus('error')
        }
      }
    }

    void bootstrapCloud()
    return () => { cancelled = true }
  }, [ready, sessionUser?.id, loadedFromStorage, replaceState])

  useEffect(() => {
    if (!ready || !sessionUser?.id || !cloudReady) return
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
  }, [state, ready, sessionUser?.id, cloudReady])

  const openReplan = () => {
    setReplan(previewReplan())
    setReplanOpen(true)
  }

  if (!ready) return <div className="loading-screen"><div className="spinner"/><p>正在载入学习计划……</p></div>

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
          <div className={`sync-status ${sessionUser ? 'online' : ''} ${syncStatus === 'error' ? 'sync-error' : ''}`}>{sessionUser ? <Cloud size={16}/> : <CloudOff size={16}/>}<span>{!sessionUser ? '当前仅本地保存' : syncStatus === 'restoring' ? '正在从云端恢复' : syncStatus === 'saving' ? '正在自动保存' : syncStatus === 'error' ? '云同步失败' : '已自动保存到云端'}</span></div>
          <button className="collapse-button" onClick={() => updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed })}><ChevronLeft size={18}/><span>收起侧边栏</span></button>
        </div>
      </aside>
      {mobileNav && <button className="mobile-overlay" onClick={() => setMobileNav(false)} aria-label="关闭菜单"/>}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21}/></button>
          <div className="page-heading"><h1>{navItems.find(n => n.id === page)?.label}</h1><span>{format(new Date(), 'yyyy年M月d日')}</span></div>
          <div className="topbar-actions"><button className="secondary-button" onClick={openReplan}><RefreshCw size={16}/>重新排期</button></div>
        </header>
        <div className="page-content">
          {page === 'today' && <TodayPage onNavigate={setPage}/>} 
          {page === 'calendar' && <CalendarPage/>}
          {page === 'tasks' && <TasksPage/>}
          {page === 'stats' && <StatsPage/>}
          {page === 'settings' && <SettingsPage sessionEmail={sessionUser?.email}/>} 
        </div>
      </main>
      <ReplanDialog result={replan} open={replanOpen} onClose={() => setReplanOpen(false)} onApply={() => { if (replan) applyReplan(replan); setReplanOpen(false) }}/>
    </div>
  )
}

function TodayPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { state, commit } = useApp()
  const rawToday = todayISO()
  const defaultDate = clampDate(rawToday, state.settings.startDate, state.settings.endDate)
  const [date, setDate] = useState(defaultDate)
  const [completeTarget, setCompleteTarget] = useState<Assignment>()
  const [actual, setActual] = useState('')
  const [progress, setProgress] = useState(100)
  const groups = useMemo(() => new Map(state.taskGroups.map(g => [g.id, g])), [state.taskGroups])
  const tasks = state.assignments.filter(a => a.scheduledDate === date).sort((a,b) => (groups.get(b.groupId)?.priority ?? 0) - (groups.get(a.groupId)?.priority ?? 0) || a.status.localeCompare(b.status))
  const counted = tasks.filter(a => groups.get(a.groupId)?.countInStats || state.settings.countWordsTime)
  const planned = counted.reduce((sum,a) => sum + Math.round(a.estimatedMinutes * Math.max(0,1-a.progress/100)), 0)
  const actualTotal = counted.reduce((sum,a) => sum + a.actualMinutes, 0)
  const done = tasks.filter(a => a.status === 'done').length
  const capacity = getCapacity(state, date)
  const config = getDayConfig(state, date)
  const corePrediction = predictCompletion(state, g => g.priority === 5 && !g.recurring && g.targetDate <= state.settings.coreTargetDate)
  const chemistryPrediction = predictCompletion(state, g => g.title === '预习' && g.subject === '化学')
  const risk = planned > capacity ? `今日计划超过容量 ${minutesText(planned - capacity)}` : corePrediction && corePrediction !== '已完成' && corePrediction > state.settings.coreTargetDate ? `核心任务预计 ${fmtDate(corePrediction)} 完成，晚于目标` : undefined

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
      <button className="secondary-button" onClick={() => onNavigate('calendar')}><CalendarDays size={16}/>打开月历</button>
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
      <div className="task-list">{tasks.length ? tasks.map(a => <TaskCard key={a.id} assignment={a} group={groups.get(a.groupId)!} onComplete={openComplete}/>) : <EmptyState title="今天没有任务" text="可以到月历调整计划，或把今天设为休息日。"/>}</div>
    </section>
    <Modal open={Boolean(completeTarget)} title={completeTarget ? `记录：${completeTarget.title}` : '记录任务'} onClose={() => setCompleteTarget(undefined)}>
      <div className="form-stack">
        <label className="field"><span>本次实际用时（分钟，可留空）</span><input type="number" min="0" step="1" value={actual} onChange={e => setActual(e.target.value)} autoFocus/></label>
        <label className="field"><span>若未完成，填写当前进度</span><input type="number" min="1" max="99" value={progress} onChange={e => setProgress(Number(e.target.value))}/></label>
      </div>
      <div className="modal-actions"><button className="secondary-button" onClick={() => saveCompletion(false)}>保存为部分完成</button><button className="primary-button" onClick={() => saveCompletion(true)}>标记完成</button></div>
    </Modal>
  </>
}

function CalendarPage() {
  const { state, updateAssignment, updateDayConfig, commit } = useApp()
  const [month, setMonth] = useState(startOfMonth(parseISO(state.settings.startDate)))
  const [dayOpen, setDayOpen] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const groups = useMemo(() => new Map(state.taskGroups.map(g => [g.id, g])), [state.taskGroups])
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)
  const days = dateRange(format(monthStart,'yyyy-MM-dd'), format(monthEnd,'yyyy-MM-dd'))
  const blanks = Array.from({ length: getDay(monthStart) })
  const planInterval = { start: parseISO(state.settings.startDate), end: parseISO(state.settings.endDate) }

  const tasksFor = (date: string) => state.assignments.filter(a => a.scheduledDate === date)
  const loadFor = (date: string) => tasksFor(date).reduce((sum,a) => {
    const g = groups.get(a.groupId); return sum + ((g?.countInStats || state.settings.countWordsTime) ? Math.round(a.estimatedMinutes * (1-a.progress/100)) : 0)
  },0)
  const drop = (date: string, e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/assignment-id')
    const a = state.assignments.find(x => x.id === id)
    const g = a && groups.get(a.groupId)
    if (!a || a.locked || !g) return
    if (g.dailyMax && state.assignments.filter(x => x.groupId === g.id && x.scheduledDate === date && x.id !== id).length >= g.dailyMax) {
      window.alert(`“${g.title}”每天最多安排 ${g.dailyMax} 个。`); return
    }
    updateAssignment(id, { scheduledDate: date })
  }

  const dayTasks = dayOpen ? tasksFor(dayOpen) : []
  const dayCfg = dayOpen ? getDayConfig(state, dayOpen) : undefined
  const bulkMove = () => {
    const target = window.prompt('输入目标日期（YYYY-MM-DD）')
    if (!target || !selectedIds.length) return
    commit(draft => { for (const a of draft.assignments) if (selectedIds.includes(a.id) && !a.locked) a.scheduledDate = target })
    setSelectedIds([])
  }

  return <>
    <section className="calendar-toolbar"><div><h2>{format(month,'yyyy年M月')}</h2><p>拖拽任务可改期；点击日期可调整日类型与批量移动。</p></div><div><button className="icon-button" onClick={() => setMonth(addMonths(month,-1))}><ChevronLeft size={19}/></button><button className="secondary-button" onClick={() => setMonth(startOfMonth(parseISO(state.settings.startDate)))}>计划开始</button><button className="icon-button" onClick={() => setMonth(addMonths(month,1))}><ChevronRight size={19}/></button></div></section>
    <section className="calendar-card">
      <div className="weekday-row">{['日','一','二','三','四','五','六'].map(x => <div key={x}>周{x}</div>)}</div>
      <div className="calendar-grid">
        {blanks.map((_,i)=><div className="calendar-cell outside" key={`b${i}`}/>)}
        {days.map(date => {
          const inPlan = isWithinInterval(parseISO(date), planInterval)
          const tasks = tasksFor(date)
          const load = loadFor(date)
          const cap = inPlan ? getCapacity(state,date) : 0
          const ratio = cap ? load/cap : 0
          const cfg = inPlan ? getDayConfig(state,date) : undefined
          return <div key={date} className={`calendar-cell ${!inPlan?'outside':''} ${cfg?`day-${cfg.type}`:''} ${ratio>1?'load-over':ratio>.8?'load-near':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>drop(date,e)} onClick={() => inPlan && setDayOpen(date)}>
            <div className="calendar-date"><span>{Number(date.slice(-2))}</span>{cfg && <small>{dayTypeLabel[cfg.type]}</small>}</div>
            {inPlan && <div className="load-line"><i style={{width:`${Math.min(100,ratio*100)}%`}}/></div>}
            <div className="calendar-tasks">{tasks.slice(0,3).map(a => <div key={a.id} draggable={!a.locked} onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData('text/assignment-id',a.id)}} onClick={e=>e.stopPropagation()} className={a.status==='done'?'mini-done':''}><span className={`subject-dot subject-${groups.get(a.groupId)?.subject}`}/>{a.title}</div>)}{tasks.length>3&&<small>+{tasks.length-3} 项</small>}</div>
            {inPlan && <footer>{minutesText(load)} / {minutesText(cap)}</footer>}
          </div>
        })}
      </div>
    </section>
    <Modal open={Boolean(dayOpen)} title={dayOpen ? `${fmtDate(dayOpen)} · ${fmtWeekday(dayOpen)}` : '日期'} onClose={() => {setDayOpen(undefined);setSelectedIds([])}} wide>
      {dayOpen && dayCfg && <>
        <div className="day-settings-row">
          <label className="field"><span>日期类型</span><select value={dayCfg.type} onChange={e => updateDayConfig(dayOpen,{type:e.target.value as DayType})}>{(['regular','study','travel','custom'] as DayType[]).map(t=><option key={t} value={t}>{dayTypeLabel[t]}</option>)}</select></label>
          {dayCfg.type==='custom'&&<label className="field"><span>可用分钟</span><input type="number" value={dayCfg.customMinutes??210} onChange={e=>updateDayConfig(dayOpen,{customMinutes:Number(e.target.value)})}/></label>}
          <label className="field grow"><span>备注</span><input value={dayCfg.note??''} onChange={e=>updateDayConfig(dayOpen,{note:e.target.value})} placeholder="例如：外出、下午补课"/></label>
        </div>
        <div className="day-load-summary"><span>预计 {minutesText(loadFor(dayOpen))}</span><span>容量 {minutesText(getCapacity(state,dayOpen))}</span><span>{dayTasks.filter(t=>t.status==='done').length}/{dayTasks.length} 已完成</span></div>
        <div className="bulk-row"><span>已选择 {selectedIds.length} 项</span><button className="secondary-button" disabled={!selectedIds.length} onClick={bulkMove}>批量移动</button></div>
        <div className="day-task-list">{dayTasks.map(a => <label key={a.id} className="select-task-row"><input type="checkbox" checked={selectedIds.includes(a.id)} onChange={e=>setSelectedIds(prev=>e.target.checked?[...prev,a.id]:prev.filter(x=>x!==a.id))}/><div><strong>{a.title}</strong><span>{groups.get(a.groupId)?.subject} · {minutesText(a.estimatedMinutes)}</span></div>{a.locked&&<small>已锁定</small>}</label>)}</div>
      </>}
    </Modal>
  </>
}

function TasksPage() {
  const { state, addTaskGroup, editTaskGroup, deleteTaskGroup, commit } = useApp()
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
    commit(draft => { for (const a of draft.assignments) if (a.groupId===g.id&&a.status!=='done'&&!a.locked) a.scheduledDate=date })
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
        return <article className="group-card" key={g.id}>
          <div className="group-card-head"><div><span className={`subject-pill subject-${g.subject}`}>{g.subject}</span><span className={`priority-badge priority-${g.priority}`}>P{g.priority}</span><h3>{g.title}</h3></div><div className="group-actions"><button className="text-button" onClick={()=>bulkMoveGroup(g)}>移动未完成</button><button className="text-button" onClick={()=>duplicate(g)}>复制</button><button className="text-button" onClick={()=>{setEditing(g);setDialog(true)}}>编辑</button><button className="icon-button danger-icon" onClick={()=>window.confirm('删除该任务及其所有子任务？')&&deleteTaskGroup(g.id)}><Trash2 size={17}/></button></div></div>
          <div className="group-stats"><span>{done}/{items.length} 已完成</span><span>预计 {minutesText(planned)}</span><span>实际 {minutesText(actual)}</span><span>目标 {fmtDate(g.targetDate)}</span>{g.dailyMax&&<span>每天最多 {g.dailyMax} 个</span>}</div>
          <div className="progress-track"><i style={{width:`${items.length?done/items.length*100:0}%`}}/></div>
          {(g.notes||g.sourceLabel)&&<p className="group-note">{g.notes||g.sourceLabel}</p>}
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
  const remaining = state.assignments.filter(a=>a.status!=='done'&&(groups.get(a.groupId)?.priority??0)>0).reduce((s,a)=>s+Math.round(a.estimatedMinutes*(1-a.progress/100)),0)

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

function SettingsPage({ sessionEmail }: { sessionEmail?: string }) {
  const { state, updateSettings, undo, canUndo, replaceState, resetAll } = useApp()
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [authMessage,setAuthMessage]=useState('')
  const fileRef=useRef<HTMLInputElement>(null)

  const exportJson=()=>downloadBlob(JSON.stringify(state,null,2),`study-plan-${todayISO()}.json`,'application/json')
  const exportCsv=()=>{
    const groups=new Map(state.taskGroups.map(g=>[g.id,g])); const rows=[['科目','任务','计划日期','状态','预计分钟','实际分钟','进度','优先级']]
    for(const a of state.assignments){const g=groups.get(a.groupId);if(g)rows.push([g.subject,a.title,a.scheduledDate??'',a.status,String(a.estimatedMinutes),String(a.actualMinutes),String(a.progress),String(g.priority)])}
    downloadBlob('\ufeff'+rows.map(r=>r.map(csvEscape).join(',')).join('\n'),`study-plan-${todayISO()}.csv`,'text/csv;charset=utf-8')
  }
  const importJson=(file:File)=>{const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(String(reader.result)) as AppState;if(!parsed.version||!parsed.taskGroups)throw new Error();if(window.confirm('导入会覆盖当前数据，是否继续？'))replaceState(parsed,true)}catch{window.alert('无法识别这个备份文件。')}};reader.readAsText(file)}
  const login=async(kind:'in'|'up')=>{try{setAuthMessage('处理中……');await(kind==='in'?signIn(email,password):signUp(email,password));setAuthMessage(kind==='in'?'登录成功':'注册请求已提交，请检查邮箱设置。')}catch(e){setAuthMessage(e instanceof Error?e.message:'操作失败')}}
  const cloudUpload=async()=>{try{const t=await uploadSnapshot(state);setAuthMessage(`已同步：${new Date(t).toLocaleString()}`)}catch(e){setAuthMessage(e instanceof Error?e.message:'同步失败')}}
  const cloudDownload=async()=>{try{const cloud=await downloadSnapshot();if(!cloud){setAuthMessage('云端尚无数据');return}if(window.confirm('用云端数据覆盖当前数据？当前状态会保留在撤销历史中。'))replaceState(cloud,true);setAuthMessage('已从云端恢复')}catch(e){setAuthMessage(e instanceof Error?e.message:'下载失败')}}

  return <div className="settings-stack">
    <SettingsSection title="计划设置" description="这些参数会参与容量计算、完成日期预测与重新排期。">
      <div className="form-grid">
        <label className="field span-2"><span>计划名称</span><input value={state.settings.planName} onChange={e=>updateSettings({planName:e.target.value})}/></label>
        <label className="field"><span>开始日期</span><input type="date" value={state.settings.startDate} onChange={e=>updateSettings({startDate:e.target.value})}/></label>
        <label className="field"><span>结束日期</span><input type="date" value={state.settings.endDate} onChange={e=>updateSettings({endDate:e.target.value})}/></label>
        <label className="field"><span>核心任务目标</span><input type="date" value={state.settings.coreTargetDate} onChange={e=>updateSettings({coreTargetDate:e.target.value})}/></label>
        <label className="field"><span>化学预习目标</span><input type="date" value={state.settings.chemistryTargetDate} onChange={e=>updateSettings({chemistryTargetDate:e.target.value})}/></label>
        <label className="field"><span>检查缓冲天数</span><input type="number" min="0" value={state.settings.bufferDays} onChange={e=>updateSettings({bufferDays:Number(e.target.value)})}/></label>
      </div>
    </SettingsSection>
    <SettingsSection title="每日容量" description="学习日没有硬性熬夜上限，但超过容量会显示红色预警。">
      <div className="form-grid three">
        <label className="field"><span>常规日（分钟）</span><input type="number" value={state.settings.regularMinutes} onChange={e=>updateSettings({regularMinutes:Number(e.target.value)})}/></label>
        <label className="field"><span>学习日（分钟）</span><input type="number" value={state.settings.studyMinutes} onChange={e=>updateSettings({studyMinutes:Number(e.target.value)})}/></label>
        <label className="field"><span>旅游日（分钟）</span><input type="number" value={state.settings.travelMinutes} onChange={e=>updateSettings({travelMinutes:Number(e.target.value)})}/></label>
      </div>
      <div className="toggle-grid"><Toggle checked={state.settings.countWordsTime} onChange={v=>updateSettings({countWordsTime:v})} label="把每日单词计入计划与统计时间"/><Toggle checked={state.settings.showWarnings} onChange={v=>updateSettings({showWarnings:v})} label="显示黄色和红色进度提醒"/><Toggle checked={state.settings.optionalReview} onChange={v=>updateSettings({optionalReview:v})} label="显示可选每日复盘入口"/></div>
    </SettingsSection>
    <SettingsSection title="数据与恢复" description="本地数据保存在浏览器 IndexedDB；建议定期导出 JSON 完整备份。">
      <div className="button-wrap"><button className="secondary-button" onClick={exportJson}><Download size={16}/>导出 JSON</button><button className="secondary-button" onClick={exportCsv}><FileDown size={16}/>导出 CSV</button><button className="secondary-button" onClick={()=>window.print()}><FileDown size={16}/>打印 / 导出 PDF</button><button className="secondary-button" onClick={()=>fileRef.current?.click()}><Upload size={16}/>导入 JSON</button><input ref={fileRef} type="file" accept="application/json" hidden onChange={e=>e.target.files?.[0]&&importJson(e.target.files[0])}/><button className="secondary-button" disabled={!canUndo} onClick={undo}><RotateCcw size={16}/>恢复上一步</button><button className="danger-button" onClick={()=>window.confirm('确认重置全部数据？请先导出备份。')&&resetAll()}><Trash2 size={16}/>重置计划</button></div>
    </SettingsSection>
    <SettingsSection title="Supabase 云同步" description={supabaseConfigured?'登录后会先自动恢复云端数据，之后每次修改都会自动保存；手动上传和恢复仍可作为补充。':'尚未配置。复制 .env.example 为 .env，并填写项目 URL 与 publishable / anon key。'}>
      {!supabaseConfigured?<div className="code-note">VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</div>:sessionEmail?<div className="cloud-panel"><div><Cloud size={20}/><span>已登录：{sessionEmail}</span></div><div className="button-wrap"><button className="secondary-button" onClick={cloudUpload}>立即上传</button><button className="secondary-button" onClick={cloudDownload}>从云端恢复</button><button className="secondary-button" onClick={()=>signOut()}>退出登录</button></div></div>:<div className="auth-form"><input type="email" placeholder="邮箱" value={email} onChange={e=>setEmail(e.target.value)}/><input type="password" placeholder="密码" value={password} onChange={e=>setPassword(e.target.value)}/><button className="primary-button" onClick={()=>login('in')}>登录</button><button className="secondary-button" onClick={()=>login('up')}>注册</button></div>}
      {authMessage&&<p className="settings-message">{authMessage}</p>}
    </SettingsSection>
    <SettingsSection title="DeepSeek API" description="第一版只预留扩展位置，不把 AI 作为排期核心依赖。">
      <div className="reserved-card"><Sparkles size={21}/><div><strong>AI 功能暂未启用</strong><p>后续可通过服务端代理加入自然语言录入、周总结与复杂重排解释。API Key 不应写入前端。</p></div></div>
    </SettingsSection>
  </div>
}

function SettingsSection({title,description,children}:{title:string;description:string;children:React.ReactNode}){return <section className="settings-section"><div><h2>{title}</h2><p>{description}</p></div><div>{children}</div></section>}
function Toggle({checked,onChange,label}:{checked:boolean;onChange:(v:boolean)=>void;label:string}){return <label className="switch-row"><button type="button" className={`switch ${checked?'on':''}`} onClick={()=>onChange(!checked)}><i/></button><span>{label}</span></label>}
function ChartCard({title,children}:{title:string;children:React.ReactNode}){return <section className="chart-card"><h3>{title}</h3>{children}</section>}
function EmptyState({title,text}:{title:string;text:string}){return <div className="empty-state"><CheckCircle2 size={30}/><h3>{title}</h3><p>{text}</p></div>}
function downloadBlob(content:string,name:string,type:string){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function csvEscape(v:string){return `"${v.replaceAll('"','""')}"`}
