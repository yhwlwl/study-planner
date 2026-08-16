import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight, CalendarDays, CheckCircle2, ChevronLeft, Clock3, ListChecks,
  RefreshCw, SlidersHorizontal, Sparkles,
} from 'lucide-react'
import type { AppState, DurationSuggestion, PlanChangeEvent, SchedulingPreference } from '../types'
import { analyzePlan, allDurationSuggestions } from '../lib/planner'
import { cloneActiveState } from '../lib/state'
import { dateRange, getCapacity, shiftDate, todayISO } from '../lib/date'
import { uid } from '../lib/id'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'

export type AdjustmentReason = 'current-conflicts' | 'too-tiring' | 'future-replan' | 'execution-difference'
type ActiveAction = 'center' | 'availability' | 'deadline' | 'bulk-move' | 'current-conflicts' | 'duration' | 'load' | 'replan'
type LoadPreference = 'preserve' | 'balanced' | 'goal' | 'rest'
type ReplanOutcome = 'preserve' | 'balanced' | 'goal' | 'rest'

const preferenceCopy: Record<LoadPreference, { title: string; description: string }> = {
  preserve: { title: '尽量保持现在的安排', description: '只在新条件确实放不下时移动任务。' },
  balanced: { title: '让每天更均匀', description: '在不突破硬约束的前提下平衡每天的负载。' },
  goal: { title: '优先保障最近目标', description: '优先把临近目标日期的任务安排好。' },
  rest: { title: '留出更多休息空间', description: '接受更多缓冲，减少连续高负载。' },
}

const actionGroups: Array<{ title: string; description: string; items: Array<{ id: Exclude<ActiveAction, 'center'>; title: string; description: string; tone?: 'attention' | 'secondary' }> }> = [
  {
    title: '调整计划条件',
    description: '先说明新的日期、期限或移动要求，系统再计算受影响的任务。',
    items: [
      { id: 'availability', title: '调整日期可用时间', description: '临时有事、休息或只能学习一会儿。' },
      { id: 'deadline', title: '修改任务或目标期限', description: '截止日期提前、推迟或完成要求发生变化。' },
      { id: 'bulk-move', title: '批量移动任务', description: '将所选任务移到某天，或整体顺延若干天。' },
    ],
  },
  {
    title: '根据当前状态调整',
    description: '处理已经出现的问题，或明确告诉系统未来要怎么取舍。',
    items: [
      { id: 'current-conflicts', title: '修复当前计划问题', description: '只处理已检测到的容量、期限或规则冲突。', tone: 'attention' },
      { id: 'duration', title: '校准任务预计时长', description: '根据同类任务的实际用时更新未来预计；有新冲突才调整日期。' },
      { id: 'load', title: '减少未来一段时间的负载', description: '设置每日上限、轻量日、连续高负载和长任务条件。' },
      { id: 'replan', title: '重新安排剩余计划', description: '保留历史、已完成和锁定内容，重新计算未完成任务。' },
    ],
  },
]

function inPlanDate(date: string, state: AppState) {
  return date < state.settings.startDate ? state.settings.startDate : date > state.settings.endDate ? state.settings.endDate : date
}

function ActionCard({ actionId, title, description, tone, blocked = false, onClick }: { actionId: string; title: string; description: string; tone?: 'attention' | 'secondary'; blocked?: boolean; onClick: () => void }) {
  const tutorialTarget = actionId === 'current-conflicts' ? 'repair-current' : actionId === 'replan' ? 'future-replan' : undefined
  return <button type="button" data-tutorial-target={tutorialTarget} data-tutorial-action={actionId} aria-disabled={blocked || undefined} className={`adjustment-action-card ${tone ?? ''} ${blocked ? 'tutorial-disabled-control' : ''}`} onClick={onClick}>
    <span className="adjustment-action-copy"><strong>{title}</strong><span>{description}</span></span>
    <ArrowUpRight size={18} aria-hidden="true" />
  </button>
}

function ActionHeader({ title, description, onBack }: { title: string; description: string; onBack: () => void }) {
  return <>
    <button type="button" className="adjustment-back-button" onClick={onBack}><ChevronLeft size={17} />返回调整中心</button>
    <section className="adjustment-action-header">
      <div className="adjustment-action-icon"><SlidersHorizontal size={21} /></div>
      <div><strong>{title}</strong><p>{description}</p></div>
    </section>
  </>
}

export function AdjustmentIntentDialog({
  open, state, initialDate, initialReason = 'current-conflicts', onClose, onPrepared,
  onOpenIntake, onOpenDeadline, onOpenBulkMove, onDurationSuggestion, tutorialMode, onTutorialBlocked,
}: {
  open: boolean
  state: AppState
  initialDate?: string
  initialReason?: AdjustmentReason
  onClose: () => void
  onPrepared: (prepared: AppState, event: PlanChangeEvent) => void
  onOpenIntake?: () => void
  onOpenDeadline?: () => void
  onOpenBulkMove?: () => void
  onDurationSuggestion?: (suggestion: DurationSuggestion) => void
  tutorialMode?: 'repair' | 'future'
  onTutorialBlocked?: (message?: string) => void
}) {
  const today = todayISO()
  const defaultDate = inPlanDate(initialDate ?? today, state)
  const [activeAction, setActiveAction] = useState<ActiveAction>('center')
  const [availabilityStart, setAvailabilityStart] = useState(defaultDate)
  const [availabilityEnd, setAvailabilityEnd] = useState(defaultDate)
  const [availabilityMode, setAvailabilityMode] = useState<'unavailable' | 'reduced'>('unavailable')
  const [availableMinutes, setAvailableMinutes] = useState(60)
  const [availabilityReason, setAvailabilityReason] = useState('临时没有学习时间')
  const [loadStart, setLoadStart] = useState(defaultDate)
  const [loadEnd, setLoadEnd] = useState(inPlanDate(shiftDate(defaultDate, 6), state))
  const [loadDailyMax, setLoadDailyMax] = useState(Math.max(30, Math.round(getCapacity(state, defaultDate) * 0.8)))
  const [lightDaysPerWeek, setLightDaysPerWeek] = useState(1)
  const [maxHighLoadStreak, setMaxHighLoadStreak] = useState(2)
  const [maxLongHighPerDay, setMaxLongHighPerDay] = useState(1)
  const [loadPreference, setLoadPreference] = useState<LoadPreference>('rest')
  const [replanStart, setReplanStart] = useState(defaultDate)
  const [includeToday, setIncludeToday] = useState(false)
  const [replanSubject, setReplanSubject] = useState('all')
  const [replanOutcome, setReplanOutcome] = useState<ReplanOutcome>('balanced')
  const [todayMode, setTodayMode] = useState<'none' | '30' | '60' | 'custom'>('none')
  const [customMinutes, setCustomMinutes] = useState(30)

  const overdueAssignments = useMemo(() => state.assignments
    .filter(item => item.status !== 'done' && item.scheduledDate && item.scheduledDate < today), [state.assignments, today])
  const currentIssues = useMemo(() => {
    const hard = analyzePlan(state, today).filter(issue => issue.level === 'danger')
    const overdue = overdueAssignments
      .map(item => ({ level: 'danger' as const, date: item.scheduledDate, message: `“${item.title}”仍停留在过去日期，需要重新安排。` }))
    return [...overdue, ...hard]
  }, [state, today, overdueAssignments])
  const durationSuggestions = useMemo(() => allDurationSuggestions(state), [state])
  const subjects = useMemo(() => Array.from(new Set(state.taskGroups.map(group => group.subject))).sort(), [state.taskGroups])
  const initialAction: ActiveAction = tutorialMode ? 'center' : initialReason === 'too-tiring' ? 'load' : initialReason === 'future-replan' ? 'replan' : initialDate ? 'current-conflicts' : 'center'

  useEffect(() => {
    if (!open) return
    setActiveAction(initialAction)
    setAvailabilityStart(defaultDate)
    setAvailabilityEnd(defaultDate)
    setAvailabilityMode('unavailable')
    setAvailableMinutes(60)
    setAvailabilityReason('临时没有学习时间')
    setLoadStart(defaultDate)
    setLoadEnd(inPlanDate(shiftDate(defaultDate, 6), state))
    setLoadDailyMax(Math.max(30, Math.round(getCapacity(state, defaultDate) * 0.8)))
    setLightDaysPerWeek(1)
    setMaxHighLoadStreak(2)
    setMaxLongHighPerDay(1)
    setLoadPreference('rest')
    setReplanStart(defaultDate)
    setIncludeToday(false)
    setReplanSubject('all')
    setReplanOutcome(tutorialMode === 'future' ? 'goal' : 'balanced')
    setTodayMode('none')
    setCustomMinutes(30)
  }, [open, initialAction, defaultDate, state, tutorialMode])

  const backToCenter = () => setActiveAction('center')
  const todayExtraMinutes = todayMode === '30' ? 30 : todayMode === '60' ? 60 : todayMode === 'custom' ? Math.max(0, customMinutes) : 0

  const submit = () => {
    const now = new Date().toISOString()
    const prepared = cloneActiveState(state)
    let event: PlanChangeEvent

    if (activeAction === 'availability') {
      if (!availabilityStart || !availabilityEnd || availabilityStart > availabilityEnd) return
      const dates = dateRange(availabilityStart, availabilityEnd)
      prepared.calendarConstraints.push({
        id: uid('constraint'), startDate: availabilityStart, endDate: availabilityEnd,
        kind: availabilityMode === 'unavailable' ? 'unavailable' : 'reduced-capacity',
        capacityMinutes: availabilityMode === 'unavailable' ? 0 : Math.max(0, Math.min(1440, availableMinutes)),
        protected: true, reason: availabilityReason.trim() || '调整日期可用时间', createdAt: now, updatedAt: now,
      })
      event = {
        id: uid('event'), type: 'availability-change', action: 'repair', title: '调整日期可用时间',
        description: `${availabilityStart} 至 ${availabilityEnd}：${availabilityMode === 'unavailable' ? '完全不安排学习任务' : `每天可用 ${Math.max(0, Math.min(1440, availableMinutes))} 分钟`}。系统会保护这段日期并预览受影响任务。`,
        affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: [], affectedDates: dates, createdAt: now,
        metadata: { availabilityMode, capacityMinutes: availabilityMode === 'unavailable' ? 0 : availableMinutes, preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'] },
      }
    } else if (activeAction === 'current-conflicts') {
      const affectedDates = currentIssues.flatMap(issue => issue.date ? [issue.date] : []).filter((date, index, values) => values.indexOf(date) === index)
      const affectedAssignmentIds = Array.from(new Set([
        ...overdueAssignments.map(item => item.id),
        ...state.assignments.filter(item => item.status !== 'done' && item.scheduledDate && affectedDates.includes(item.scheduledDate)).map(item => item.id),
      ]))
      const affectedGroupIds = Array.from(new Set(state.assignments.filter(item => affectedAssignmentIds.includes(item.id)).map(item => item.groupId)))
      const affectedGoalIds = state.goals.filter(goal => goal.linkedAssignmentIds.some(id => affectedAssignmentIds.includes(id)) || goal.linkedTaskGroupIds.some(id => affectedGroupIds.includes(id)) || goal.completionConditions.some(condition => affectedGroupIds.includes(condition.groupId))).map(goal => goal.id)
      event = {
        id: uid('event'), type: 'execution-difference', action: 'repair', title: '修复当前计划问题',
        description: `当前检测到 ${currentIssues.length} 个容量、期限或规则问题。只处理这些问题，不主动重写没有问题的未来安排。`,
        affectedGoalIds, affectedGroupIds, affectedAssignmentIds,
        affectedDates, createdAt: now,
        metadata: { preferredPreferences: ['preserve', 'balanced', 'goal', 'rest'], requestedOutcome: 'fix-current', sourceDate: initialDate ?? today },
      }
    } else if (activeAction === 'load') {
      const start = loadStart <= loadEnd ? loadStart : loadEnd
      const end = loadStart <= loadEnd ? loadEnd : loadStart
      const loadConstraints = {
        startDate: start, endDate: end,
        maxMinutesPerDay: Math.max(30, Math.min(1440, Math.round(loadDailyMax))),
        lightDaysPerWeek: Math.max(0, Math.min(7, Math.round(lightDaysPerWeek))),
        maxHighLoadStreak: Math.max(0, Math.min(14, Math.round(maxHighLoadStreak))),
        maxLongHighPerDay: Math.max(0, Math.min(10, Math.round(maxLongHighPerDay))),
      }
      event = {
        id: uid('event'), type: 'load-preference-change', action: 'optimize', title: '减少未来一段时间的负载',
        description: `${start} 至 ${end}：每天最多 ${loadConstraints.maxMinutesPerDay} 分钟；每周至少 ${loadConstraints.lightDaysPerWeek} 个轻量日；最多连续 ${loadConstraints.maxHighLoadStreak} 个高负载日；每天最多 ${loadConstraints.maxLongHighPerDay} 个长任务或高强度任务。`,
        affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: [], affectedDates: dateRange(start, end), createdAt: now,
        metadata: {
          preferredPreference: loadPreference, preferredPreferences: [loadPreference, ...(['preserve', 'balanced', 'goal', 'rest'] as SchedulingPreference[]).filter(item => item !== loadPreference)],
          loadConstraints, requestedOutcome: 'reduce-load', sourceDate: start,
        },
      }
    } else if (activeAction === 'replan') {
      const candidates = state.assignments.filter(item => {
        if (item.status === 'done' || state.timer.assignmentId === item.id) return false
        if (replanSubject === 'all') return true
        return state.taskGroups.find(group => group.id === item.groupId)?.subject === replanSubject
      })
      const fixedAssignmentIds = replanSubject === 'all'
        ? []
        : state.assignments.filter(item => !candidates.some(candidate => candidate.id === item.id) && item.status !== 'done').map(item => item.id)
      const preferences: SchedulingPreference[] = [replanOutcome, ...(['preserve', 'balanced', 'goal', 'rest'] as SchedulingPreference[]).filter(item => item !== replanOutcome)]
      event = {
        id: uid('event'), type: 'future-replanning', action: 'rebuild', title: '重新安排剩余计划',
        description: `从 ${replanStart} 开始${includeToday ? '，包含今天' : '，不改动今天'}；${replanSubject === 'all' ? '重新计算全部未完成任务' : `只调整“${replanSubject}”任务`}；${preferenceCopy[replanOutcome].description}`,
        affectedGoalIds: [], affectedGroupIds: [], affectedAssignmentIds: candidates.map(item => item.id),
        affectedDates: [replanStart], createdAt: now,
        metadata: {
          preferredPreference: replanOutcome, preferredPreferences: preferences, requestedOutcome: replanOutcome,
          fromDate: replanStart, includeToday, fixedAssignmentIds: fixedAssignmentIds.length ? fixedAssignmentIds : undefined,
          scopeSubject: replanSubject, todayExtraMinutes,
        },
      }
    } else {
      return
    }

    prepared.changeEvents = [...prepared.changeEvents, event].slice(-100)
    prepared.updatedAt = now
    onPrepared(prepared, event)
  }

  const renderCenter = () => <>
    <section className="adjustment-intro">
      <div>
        <span className="adjustment-eyebrow">计划调整中心</span>
        <strong>先选择你要执行的动作</strong>
        <p>黑色标题是要做的事，灰色说明是适用场景。系统会先生成预览，确认后才会改变正式计划。</p>
      </div>
      <div className="adjustment-intro-badges"><span>改动先预览</span><span>历史不改写</span><span>可随时撤销</span></div>
    </section>
    <div className="adjustment-action-groups">
      {actionGroups.map(group => <section className="adjustment-action-group" key={group.title}>
        <header><div><strong>{group.title}</strong><span>{group.description}</span></div></header>
        <div className="adjustment-action-grid">
          {group.items.map(item => {
            const allowedTutorialAction = !tutorialMode || item.id === (tutorialMode === 'repair' ? 'current-conflicts' : 'replan')
            return <ActionCard key={item.id} actionId={item.id} title={item.title} description={item.id === 'current-conflicts' ? `${item.description} 当前 ${currentIssues.length} 个待处理问题。` : item.description} tone={item.tone} blocked={!allowedTutorialAction} onClick={() => {
              if (!allowedTutorialAction) { onTutorialBlocked?.('教程中先完成高亮的调整动作'); return }
              if (item.id === 'deadline') { onClose(); onOpenDeadline?.(); return }
              if (item.id === 'bulk-move') { onClose(); onOpenBulkMove?.(); return }
              setActiveAction(item.id)
            }} />
          })}
        </div>
      </section>)}
    </div>
    <section className="adjustment-related-entry">
      <div><strong>有新任务需要加入？</strong><span>先添加到录入，之后再统一安排，不会打乱当前正式计划。</span></div>
      <button type="button" className={`secondary-button ${tutorialMode ? 'tutorial-disabled-control' : ''}`} aria-disabled={Boolean(tutorialMode) || undefined} onClick={() => { if (tutorialMode) { onTutorialBlocked?.('教程中稍后会亲手体验录入'); return }; onClose(); onOpenIntake?.() }}>打开录入 <ArrowUpRight size={15} /></button>
    </section>
  </>

  const renderAvailability = () => <>
    <ActionHeader title="调整日期可用时间" description="临时有事、休息或只能学习一会儿。先设置日期和分钟数，再预览受影响任务。" onBack={backToCenter} />
    <section className="adjustment-form-section">
      <div className="adjustment-form-grid">
        <label className="field"><span>开始日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={availabilityStart} onChange={event => { setAvailabilityStart(event.target.value); if (availabilityEnd < event.target.value) setAvailabilityEnd(event.target.value) }} /></label>
        <label className="field"><span>结束日期</span><input type="date" min={availabilityStart} max={state.settings.endDate} value={availabilityEnd} onChange={event => setAvailabilityEnd(event.target.value)} /></label>
        <fieldset className="field span-2"><legend>这段时间还能学习吗？</legend><div className="segmented-control"><button type="button" className={availabilityMode === 'unavailable' ? 'active' : ''} onClick={() => setAvailabilityMode('unavailable')}>完全没空／休息</button><button type="button" className={availabilityMode === 'reduced' ? 'active' : ''} onClick={() => setAvailabilityMode('reduced')}>每天只能学一会儿</button></div></fieldset>
        {availabilityMode === 'reduced' && <label className="field"><span>每天最多分钟</span><NumericInput min={0} max={1440} value={availableMinutes} onValueChange={setAvailableMinutes} /></label>}
        <label className={`field ${availabilityMode === 'unavailable' ? 'span-2' : ''}`}><span>原因（可选）</span><input value={availabilityReason} onChange={event => setAvailabilityReason(event.target.value)} placeholder="例如：旅行、发烧、校内活动" /></label>
      </div>
      <div className="adjustment-form-note"><CalendarDays size={17} /><span>这段日期会被保护。系统只搬出必要任务，不会把这次临时变化变成永久的每日规则。</span></div>
    </section>
  </>

  const renderCurrentConflicts = () => <>
    <ActionHeader title="修复当前计划问题" description="只处理已经检测到的容量、期限或规则冲突，尽量少移动没有问题的任务。" onBack={backToCenter} />
    <section className="adjustment-form-section">
      <div className={`adjustment-issue-summary ${currentIssues.length ? 'has-issues' : 'clear'}`}>
        {currentIssues.length ? <RefreshCw size={20} /> : <CheckCircle2 size={20} />}
        <div><strong>{currentIssues.length ? `当前检测到 ${currentIssues.length} 个待处理问题` : '当前没有明显硬冲突'}</strong><span>{currentIssues.length ? '下一步会生成只针对这些问题的最小修复预览。' : '仍然可以生成一次校验，确认当前安排符合容量、期限和规则。'}</span></div>
      </div>
      {currentIssues.length > 0 && <ul className="adjustment-issue-list">{currentIssues.slice(0, 8).map((issue, index) => <li key={`${issue.date ?? 'all'}-${index}`}><span>{issue.date ?? '计划范围'}</span>{issue.message}</li>)}</ul>}
    </section>
  </>

  const renderDuration = () => <>
    <ActionHeader title="校准任务预计时长" description="根据同类任务的实际用时更新未来预计。已完成、部分完成和手动改过时长的任务不会被覆盖。" onBack={backToCenter} />
    <section className="adjustment-form-section">
      {durationSuggestions.length ? <div className="duration-calibration-list">{durationSuggestions.map(suggestion => {
        const group = state.taskGroups.find(item => item.id === suggestion.groupId)
        return <article key={suggestion.groupId} className="duration-calibration-card"><div><strong>{group?.title ?? '任务组'}</strong><span>当前 {suggestion.currentEstimate} 分钟 · 最近 {suggestion.sampleCount} 个样本平均 {Math.round(suggestion.recentAverage)} 分钟</span><small>建议更新为 {suggestion.suggestedEstimate} 分钟；只改变预计时长，日期会先保持不动并重新校验。</small></div><button type="button" className="secondary-button" onClick={() => { onClose(); onDurationSuggestion?.(suggestion) }}>预览更新影响</button></article>
      })}</div> : <div className="adjustment-empty-state"><Clock3 size={23} /><strong>暂时没有校准建议</strong><span>需要达到最少样本数，并且实际用时持续偏离当前预计后，系统才会提出调整。</span></div>}
    </section>
  </>

  const renderLoad = () => <>
    <ActionHeader title="减少未来一段时间的负载" description="把希望达到的条件直接告诉系统，再由系统在范围内重新安排未完成任务。" onBack={backToCenter} />
    <section className="adjustment-form-section">
      <div className="adjustment-form-grid">
        <label className="field"><span>开始日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={loadStart} onChange={event => setLoadStart(event.target.value)} /></label>
        <label className="field"><span>结束日期</span><input type="date" min={loadStart} max={state.settings.endDate} value={loadEnd} onChange={event => setLoadEnd(event.target.value)} /></label>
        <label className="field"><span>每天最多安排（分钟）</span><NumericInput min={30} max={1440} step={10} value={loadDailyMax} onValueChange={setLoadDailyMax} /></label>
        <label className="field"><span>每周至少几个轻量日</span><NumericInput min={0} max={7} value={lightDaysPerWeek} onValueChange={setLightDaysPerWeek} /></label>
        <label className="field"><span>最多连续几个高负载日</span><NumericInput min={0} max={14} value={maxHighLoadStreak} onValueChange={setMaxHighLoadStreak} /></label>
        <label className="field"><span>每天最多几个长／高强度任务</span><NumericInput min={0} max={10} value={maxLongHighPerDay} onValueChange={setMaxLongHighPerDay} /></label>
      </div>
      <fieldset className="adjustment-choice-fieldset"><legend>如果条件互相挤压，优先保留什么？</legend><div className="adjustment-preference-options">{(['rest', 'balanced', 'preserve', 'goal'] as LoadPreference[]).map(item => <button type="button" key={item} className={loadPreference === item ? 'selected' : ''} onClick={() => setLoadPreference(item)}><strong>{preferenceCopy[item].title}</strong><span>{preferenceCopy[item].description}</span></button>)}</div></fieldset>
      <div className="adjustment-form-note"><Sparkles size={17} /><span>这些条件只用于本次减负预览；确认后，任务日期会按方案改变，原有历史记录和锁定内容保持不动。</span></div>
    </section>
  </>

  const renderReplan = () => {
    const canIncludeToday = replanStart <= today
    return <>
      <ActionHeader title="重新安排剩余计划" description="保留历史、已完成和锁定内容，从指定日期开始重新计算未完成任务。" onBack={backToCenter} />
      <section className="adjustment-form-section">
        <div className="adjustment-form-grid">
          <label className="field"><span>从哪天开始</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={replanStart} disabled={tutorialMode === 'future'} onChange={event => setReplanStart(event.target.value)} /></label>
          <label className="field"><span>调整哪些任务</span><select value={replanSubject} disabled={tutorialMode === 'future'} onChange={event => setReplanSubject(event.target.value)}><option value="all">全部未完成任务</option>{subjects.map(subject => <option value={subject} key={subject}>{subject}任务</option>)}</select></label>
        </div>
        <label className="adjustment-check-row"><input type="checkbox" checked={includeToday && canIncludeToday} onChange={event => setIncludeToday(event.target.checked)} disabled={!canIncludeToday || tutorialMode === 'future'} /><span><strong>包含今天</strong><small>把今天尚未完成的任务也纳入重排；未来任务是否进入今天，仍需在下面明确开放额外分钟。</small></span></label>
        {includeToday && canIncludeToday && <div className="adjustment-today-control compact">{(['none', '30', '60', 'custom'] as const).map(item => <button type="button" key={item} className={todayMode === item ? 'active' : ''} onClick={() => setTodayMode(item)}><strong>{item === 'none' ? '不再新增' : item === 'custom' ? '自定义' : `${item} 分钟`}</strong><span>{item === 'none' ? '今天保持现状' : '额外接收未来任务'}</span></button>)}</div>}
        {includeToday && todayMode === 'custom' && <label className="field compact-field"><span>今天额外可用分钟</span><NumericInput min={0} max={720} value={customMinutes} onValueChange={setCustomMinutes} /></label>}
        <fieldset className="adjustment-choice-fieldset"><legend>这次重排采用什么取舍？</legend><div className="adjustment-preference-options">{(['preserve', 'balanced', 'goal', 'rest'] as ReplanOutcome[]).map(item => <button type="button" key={item} className={replanOutcome === item ? 'selected' : ''} disabled={tutorialMode === 'future' && item !== 'goal'} onClick={() => setReplanOutcome(item)}><strong>{preferenceCopy[item].title}</strong><span>{preferenceCopy[item].description}</span></button>)}</div></fieldset>
        <div className="adjustment-form-note"><ListChecks size={17} /><span>已完成、部分执行记录、锁定和过去日期都会被保护；只会重新计算你选择范围内仍未完成的任务。</span></div>
      </section>
    </>
  }

  const isCenter = activeAction === 'center'
  const submitLabel = activeAction === 'availability' ? '分析日期变化' : activeAction === 'current-conflicts' ? '分析并预览最小修复' : activeAction === 'load' ? '生成减负预览' : activeAction === 'replan' ? '生成重新安排预览' : ''
  const canSubmit = activeAction === 'availability'
    ? Boolean(availabilityStart && availabilityEnd && availabilityStart <= availabilityEnd)
    : activeAction === 'load'
      ? Boolean(loadStart && loadEnd && loadStart <= loadEnd)
      : activeAction === 'replan'
        ? Boolean(replanStart)
        : activeAction === 'current-conflicts'

  return <Modal open={open} title="计划调整中心" onClose={onClose} wide mobileFullscreen className="adjustment-modal">
    <div className="adjustment-dialog-shell">
      {isCenter ? renderCenter() : activeAction === 'availability' ? renderAvailability() : activeAction === 'current-conflicts' ? renderCurrentConflicts() : activeAction === 'duration' ? renderDuration() : activeAction === 'load' ? renderLoad() : activeAction === 'replan' ? renderReplan() : renderCenter()}
      {!isCenter && activeAction !== 'duration' && <div className="adjustment-guarantees"><strong>系统始终保护</strong><span>过去日期、已完成任务、正在计时任务、锁定任务、目标最晚日期和受保护日期。手动安排不是锁定，但会被高权重保留。</span></div>}
      {!isCenter && activeAction !== 'duration' && <div className="modal-actions adjustment-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" data-tutorial-target={activeAction === 'current-conflicts' ? 'repair-submit' : activeAction === 'replan' ? 'future-submit' : undefined} data-tutorial-action={activeAction === 'current-conflicts' ? 'submit-repair' : activeAction === 'replan' ? 'submit-future' : undefined} disabled={!canSubmit} onClick={submit}>{submitLabel}</button></div>}
    </div>
  </Modal>
}
