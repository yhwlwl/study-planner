import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  AppSettings, AppState, Assignment, DayConfig, ReplanAudit, ReplanBundle, ReplanHistoryEntry, ReplanRequest,
  ReplanResult, TaskGroup
} from './types'
import {
  buildBlankState, buildGuestDemoState, buildInitialState,
  createAssignmentsForGroup, normalizeState
} from './lib/seed'
import { clearLocalState, loadLocalState, saveLocalState } from './lib/db'
import { generateReplanBundle } from './lib/planner'
import { uid } from './lib/id'

type Recipe = (draft: AppState) => void

interface AppContextValue {
  state: AppState
  namespace: string
  ready: boolean
  loadedFromStorage: boolean
  canUndo: boolean
  commit: (recipe: Recipe, options?: { history?: boolean }) => void
  replaceState: (state: AppState, history?: boolean) => void
  loadDataSpace: (namespace: string, fallback?: AppState) => Promise<AppState>
  setDataSpace: (namespace: string, state: AppState, history?: boolean) => Promise<void>
  clearDataSpace: (namespace: string) => Promise<void>
  undo: () => void
  updateSettings: (patch: Partial<AppSettings>) => void
  updateDayConfig: (date: string, patch: Partial<DayConfig>) => void
  updateAssignment: (id: string, patch: Partial<Assignment>) => void
  moveAssignments: (ids: string[], date: string, source?: 'manual' | 'carryover') => void
  finishAssignment: (id: string, actualMinutes?: number, source?: 'timer' | 'manual' | 'finish') => void
  addTime: (id: string, minutes: number, source?: 'timer' | 'manual' | 'finish') => void
  addTaskGroup: (group: TaskGroup) => void
  editTaskGroup: (group: TaskGroup) => void
  deleteTaskGroup: (id: string) => void
  previewReplan: (request?: Partial<ReplanRequest>, baseState?: AppState) => ReplanBundle
  applyReplan: (result: ReplanResult, editedState?: AppState, audit?: ReplanAudit) => void
  restoreReplanHistory: (id: string) => void
  startTimer: (assignmentId: string) => void
  pauseTimer: () => void
  stopTimer: () => number
  resetAll: (kind?: 'demo' | 'blank') => Promise<void>
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

function withoutNestedHistory(state: AppState) {
  const snapshot = structuredClone(state)
  snapshot.replanHistory = []
  snapshot.conflictBackups = []
  return snapshot
}

function templateState(kind: 'demo' | 'blank') {
  if (kind === 'blank') return buildBlankState()
  return buildGuestDemoState()
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(buildInitialState)
  const [namespace, setNamespace] = useState('guest')
  const [ready, setReady] = useState(false)
  const [loadedFromStorage, setLoadedFromStorage] = useState(false)
  const history = useRef<AppState[]>([])
  const stateRef = useRef(state)
  const namespaceRef = useRef(namespace)
  stateRef.current = state
  namespaceRef.current = namespace

  useEffect(() => {
    let mounted = true
    loadLocalState('guest').then(saved => {
      if (mounted && saved?.version) {
        setState(normalizeState(saved))
        setLoadedFromStorage(true)
      }
    }).finally(() => mounted && setReady(true))
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!ready) return
    const currentNamespace = namespace
    const handle = window.setTimeout(() => saveLocalState(currentNamespace, state), 250)
    return () => window.clearTimeout(handle)
  }, [state, namespace, ready])

  const replaceState = useCallback((nextInput: AppState, pushHistory = true) => {
    setState(prev => {
      if (pushHistory) history.current = [...history.current.slice(-29), structuredClone(prev)]
      const next = normalizeState(nextInput)
      next.updatedAt = new Date().toISOString()
      return next
    })
  }, [])

  const commit = useCallback((recipe: Recipe, options?: { history?: boolean }) => {
    setState(prev => {
      if (options?.history !== false) history.current = [...history.current.slice(-29), structuredClone(prev)]
      const next = structuredClone(prev)
      recipe(next)
      next.updatedAt = new Date().toISOString()
      return next
    })
  }, [])

  const loadDataSpace = useCallback(async (nextNamespace: string, fallback?: AppState) => {
    const saved = await loadLocalState(nextNamespace)
    const next = normalizeState(saved ?? fallback ?? (nextNamespace === 'guest' ? buildGuestDemoState() : buildBlankState()))
    history.current = []
    setNamespace(nextNamespace)
    setLoadedFromStorage(Boolean(saved))
    setState(next)
    return next
  }, [])

  const setDataSpace = useCallback(async (nextNamespace: string, nextInput: AppState, pushHistory = false) => {
    const next = normalizeState(nextInput)
    if (pushHistory) history.current = [...history.current.slice(-29), structuredClone(stateRef.current)]
    else history.current = []
    setNamespace(nextNamespace)
    setLoadedFromStorage(true)
    setState(next)
    await saveLocalState(nextNamespace, next)
  }, [])

  const clearDataSpace = useCallback(async (targetNamespace: string) => {
    await clearLocalState(targetNamespace)
  }, [])

  const undo = useCallback(() => {
    const previous = history.current.pop()
    if (previous) setState(previous)
  }, [])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => commit(draft => {
    draft.settings = { ...draft.settings, ...patch }
  }), [commit])

  const updateDayConfig = useCallback((date: string, patch: Partial<DayConfig>) => commit(draft => {
    draft.dayConfigs[date] = {
      ...(draft.dayConfigs[date] ?? { date, type: 'regular' }),
      ...patch,
      date,
      userSet: patch.userSet ?? true
    }
  }), [commit])

  const updateAssignment = useCallback((id: string, patch: Partial<Assignment>) => commit(draft => {
    const item = draft.assignments.find(a => a.id === id)
    if (!item) return
    const oldDate = item.scheduledDate
    const moving = Object.prototype.hasOwnProperty.call(patch, 'scheduledDate') && patch.scheduledDate !== oldDate
    Object.assign(item, patch)
    if (moving) {
      item.previousDate = oldDate
      item.lastManualMoveAt = new Date().toISOString()
      item.scheduleSource = 'manual'
      item.intentStrength = item.locked ? 'locked' : 'manual'
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'estimatedMinutes')) item.manuallyEstimated = true
    if (Object.prototype.hasOwnProperty.call(patch, 'locked')) {
      item.intentStrength = item.locked ? 'locked' : item.scheduleSource === 'manual' ? 'manual' : 'normal'
    }
  }), [commit])

  const moveAssignments = useCallback((ids: string[], date: string, source: 'manual' | 'carryover' = 'manual') => commit(draft => {
    const now = new Date().toISOString()
    for (const item of draft.assignments) {
      if (!ids.includes(item.id) || item.locked || item.scheduledDate === date) continue
      item.previousDate = item.scheduledDate
      item.scheduledDate = date
      item.lastManualMoveAt = now
      item.scheduleSource = source
      item.intentStrength = 'manual'
    }
  }), [commit])

  const addTime = useCallback((id: string, minutes: number, source: 'timer' | 'manual' | 'finish' = 'manual') => commit(draft => {
    const item = draft.assignments.find(a => a.id === id)
    if (!item || minutes <= 0) return
    item.actualMinutes += minutes
    item.timeEntries.push({ id: uid('time'), minutes, createdAt: new Date().toISOString(), source })
  }), [commit])

  const finishAssignment = useCallback((id: string, actualMinutes?: number, source: 'timer' | 'manual' | 'finish' = 'finish') => commit(draft => {
    const item = draft.assignments.find(a => a.id === id)
    if (!item) return
    if (actualMinutes && actualMinutes > 0) {
      item.actualMinutes += actualMinutes
      item.timeEntries.push({ id: uid('time'), minutes: actualMinutes, createdAt: new Date().toISOString(), source })
    }
    item.progress = 100
    item.remainingMinutes = 0
    item.status = 'done'
    item.completedAt = new Date().toISOString()
    if (draft.timer.assignmentId === id) draft.timer = { accumulatedSeconds: 0, running: false }
  }), [commit])

  const addTaskGroup = useCallback((group: TaskGroup) => commit(draft => {
    draft.taskGroups.push(group)
    draft.assignments.push(...createAssignmentsForGroup(group))
  }), [commit])

  const editTaskGroup = useCallback((group: TaskGroup) => commit(draft => {
    const i = draft.taskGroups.findIndex(g => g.id === group.id)
    if (i < 0) return
    const old = draft.taskGroups[i]
    draft.taskGroups[i] = group
    const existing = draft.assignments.filter(a => a.groupId === group.id).sort((a, b) => a.index - b.index)
    for (const a of existing) {
      if (!a.manuallyEstimated) a.estimatedMinutes = group.unitMinutes
      a.title = group.quantity > 1 ? `${group.title} ${String(a.index).padStart(2, '0')}` : group.title
    }
    if (!old.recurring && !group.recurring && group.quantity > existing.length) {
      draft.assignments.push(...createAssignmentsForGroup(group).slice(existing.length))
    }
    if (!old.recurring && !group.recurring && group.quantity < existing.length) {
      const removable = existing.slice(group.quantity).filter(a => a.status !== 'done')
      const ids = new Set(removable.map(a => a.id))
      draft.assignments = draft.assignments.filter(a => !ids.has(a.id))
    }
  }), [commit])

  const deleteTaskGroup = useCallback((id: string) => commit(draft => {
    draft.taskGroups = draft.taskGroups.filter(g => g.id !== id)
    draft.assignments = draft.assignments.filter(a => a.groupId !== id)
  }), [commit])

  const previewReplan = useCallback((request?: Partial<ReplanRequest>, baseState?: AppState) => {
    const source = baseState ?? stateRef.current
    return generateReplanBundle(source, {
      mode: request?.mode ?? 'repair',
      fromDate: request?.fromDate ?? new Date().toISOString().slice(0, 10),
      strategy: request?.strategy,
      freezeDays: request?.freezeDays ?? source.settings.freezeDays
    })
  }, [])

  const applyReplan = useCallback((result: ReplanResult, editedState?: AppState, audit?: ReplanAudit) => setState(prev => {
    history.current = [...history.current.slice(-29), structuredClone(prev)]
    const entry: ReplanHistoryEntry = {
      id: uid('history'),
      createdAt: new Date().toISOString(),
      label: `${result.request.mode === 'repair' ? '局部修复' : '全面重排'} · ${result.title}`,
      mode: result.request.mode,
      moveCount: result.moves.length,
      snapshot: JSON.stringify(withoutNestedHistory(prev))
    }
    const next = normalizeState(editedState ?? result.nextState)
    entry.afterSnapshot = JSON.stringify(withoutNestedHistory(next))
    entry.audit = audit
    next.replanHistory = [...(prev.replanHistory ?? []), entry].slice(-10)
    next.updatedAt = new Date().toISOString()
    return next
  }), [])

  const restoreReplanHistory = useCallback((id: string) => setState(prev => {
    const entry = prev.replanHistory.find(x => x.id === id)
    if (!entry) return prev
    history.current = [...history.current.slice(-29), structuredClone(prev)]
    try {
      const restored = normalizeState(JSON.parse(entry.snapshot) as AppState)
      restored.replanHistory = prev.replanHistory
      restored.updatedAt = new Date().toISOString()
      return restored
    } catch {
      return prev
    }
  }), [])

  const startTimer = useCallback((assignmentId: string) => commit(draft => {
    const now = Date.now()
    if (draft.timer.running && draft.timer.startedAt) {
      draft.timer.accumulatedSeconds += Math.floor((now - draft.timer.startedAt) / 1000)
    }
    draft.timer = {
      assignmentId,
      startedAt: now,
      accumulatedSeconds: draft.timer.assignmentId === assignmentId ? draft.timer.accumulatedSeconds : 0,
      running: true
    }
  }, { history: false }), [commit])

  const pauseTimer = useCallback(() => commit(draft => {
    if (!draft.timer.running || !draft.timer.startedAt) return
    draft.timer.accumulatedSeconds += Math.floor((Date.now() - draft.timer.startedAt) / 1000)
    draft.timer.startedAt = undefined
    draft.timer.running = false
  }, { history: false }), [commit])

  const stopTimer = useCallback(() => {
    const timer = stateRef.current.timer
    let seconds = timer.accumulatedSeconds
    if (timer.running && timer.startedAt) seconds += Math.floor((Date.now() - timer.startedAt) / 1000)
    commit(draft => { draft.timer = { accumulatedSeconds: 0, running: false } }, { history: false })
    return Math.max(1, Math.round(seconds / 60))
  }, [commit])

  const resetAll = useCallback(async (kind: 'demo' | 'blank' = namespaceRef.current === 'guest' ? 'demo' : 'blank') => {
    const next = templateState(kind)
    await clearLocalState(namespaceRef.current)
    history.current = []
    setState(next)
  }, [])

  const value = useMemo<AppContextValue>(() => ({
    state, namespace, ready, loadedFromStorage, canUndo: history.current.length > 0,
    commit, replaceState, loadDataSpace, setDataSpace, clearDataSpace, undo,
    updateSettings, updateDayConfig, updateAssignment, moveAssignments, finishAssignment, addTime,
    addTaskGroup, editTaskGroup, deleteTaskGroup, previewReplan, applyReplan, restoreReplanHistory,
    startTimer, pauseTimer, stopTimer, resetAll
  }), [
    state, namespace, ready, loadedFromStorage, commit, replaceState, loadDataSpace, setDataSpace,
    clearDataSpace, undo, updateSettings, updateDayConfig, updateAssignment, moveAssignments,
    finishAssignment, addTime, addTaskGroup, editTaskGroup, deleteTaskGroup, previewReplan,
    applyReplan, restoreReplanHistory, startTimer, pauseTimer, stopTimer, resetAll
  ])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
