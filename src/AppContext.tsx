import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppSettings, AppState, Assignment, DayConfig, ReplanResult, TaskGroup } from './types'
import { buildInitialState, createAssignmentsForGroup } from './lib/seed'
import { clearLocalState, loadLocalState, saveLocalState } from './lib/db'
import { replanState } from './lib/planner'
import { uid } from './lib/id'

type Recipe = (draft: AppState) => void

interface AppContextValue {
  state: AppState
  ready: boolean
  loadedFromStorage: boolean
  canUndo: boolean
  commit: (recipe: Recipe, options?: { history?: boolean }) => void
  replaceState: (state: AppState, history?: boolean) => void
  undo: () => void
  updateSettings: (patch: Partial<AppSettings>) => void
  updateDayConfig: (date: string, patch: Partial<DayConfig>) => void
  updateAssignment: (id: string, patch: Partial<Assignment>) => void
  finishAssignment: (id: string, actualMinutes?: number) => void
  addTime: (id: string, minutes: number) => void
  addTaskGroup: (group: TaskGroup) => void
  editTaskGroup: (group: TaskGroup) => void
  deleteTaskGroup: (id: string) => void
  previewReplan: (fromDate?: string) => ReplanResult
  applyReplan: (result: ReplanResult) => void
  startTimer: (assignmentId: string) => void
  pauseTimer: () => void
  stopTimer: () => number
  resetAll: () => Promise<void>
}

const AppContext = createContext<AppContextValue | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(buildInitialState)
  const [ready, setReady] = useState(false)
  const [loadedFromStorage, setLoadedFromStorage] = useState(false)
  const history = useRef<AppState[]>([])
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let mounted = true
    loadLocalState().then(saved => {
      if (mounted && saved?.version) {
        setState(saved)
        setLoadedFromStorage(true)
      }
    }).finally(() => mounted && setReady(true))
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!ready) return
    const handle = window.setTimeout(() => saveLocalState(state), 250)
    return () => window.clearTimeout(handle)
  }, [state, ready])

  const replaceState = useCallback((next: AppState, pushHistory = true) => {
    setState(prev => {
      if (pushHistory) history.current = [...history.current.slice(-29), structuredClone(prev)]
      return { ...structuredClone(next), updatedAt: new Date().toISOString() }
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

  const undo = useCallback(() => {
    const previous = history.current.pop()
    if (previous) setState(previous)
  }, [])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => commit(draft => {
    draft.settings = { ...draft.settings, ...patch }
  }), [commit])

  const updateDayConfig = useCallback((date: string, patch: Partial<DayConfig>) => commit(draft => {
    draft.dayConfigs[date] = { ...(draft.dayConfigs[date] ?? { date, type: 'regular' }), ...patch, date }
  }), [commit])

  const updateAssignment = useCallback((id: string, patch: Partial<Assignment>) => commit(draft => {
    const item = draft.assignments.find(a => a.id === id)
    if (item) Object.assign(item, patch)
  }), [commit])

  const addTime = useCallback((id: string, minutes: number) => commit(draft => {
    const item = draft.assignments.find(a => a.id === id)
    if (!item || minutes <= 0) return
    item.actualMinutes += minutes
    item.timeEntries.push({ id: uid('time'), minutes, createdAt: new Date().toISOString() })
  }), [commit])

  const finishAssignment = useCallback((id: string, actualMinutes?: number) => commit(draft => {
    const item = draft.assignments.find(a => a.id === id)
    if (!item) return
    if (actualMinutes && actualMinutes > 0) {
      item.actualMinutes += actualMinutes
      item.timeEntries.push({ id: uid('time'), minutes: actualMinutes, createdAt: new Date().toISOString() })
    }
    item.progress = 100
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
      a.estimatedMinutes = group.unitMinutes
      a.title = group.quantity > 1 ? `${group.title} ${String(a.index).padStart(2, '0')}` : group.title
    }
    if (!old.recurring && !group.recurring && group.quantity > existing.length) {
      const extra = createAssignmentsForGroup(group).slice(existing.length)
      draft.assignments.push(...extra)
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

  const previewReplan = useCallback((fromDate?: string) => replanState(stateRef.current, fromDate), [])
  const applyReplan = useCallback((result: ReplanResult) => replaceState(result.nextState, true), [replaceState])

  const startTimer = useCallback((assignmentId: string) => commit(draft => {
    const now = Date.now()
    if (draft.timer.running && draft.timer.startedAt) {
      draft.timer.accumulatedSeconds += Math.floor((now - draft.timer.startedAt) / 1000)
    }
    draft.timer = { assignmentId, startedAt: now, accumulatedSeconds: draft.timer.assignmentId === assignmentId ? draft.timer.accumulatedSeconds : 0, running: true }
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

  const resetAll = useCallback(async () => {
    await clearLocalState()
    history.current = []
    setState(buildInitialState())
  }, [])

  const value = useMemo<AppContextValue>(() => ({
    state, ready, loadedFromStorage, canUndo: history.current.length > 0, commit, replaceState, undo,
    updateSettings, updateDayConfig, updateAssignment, finishAssignment, addTime,
    addTaskGroup, editTaskGroup, deleteTaskGroup, previewReplan, applyReplan,
    startTimer, pauseTimer, stopTimer, resetAll
  }), [state, ready, loadedFromStorage, commit, replaceState, undo, updateSettings, updateDayConfig, updateAssignment, finishAssignment, addTime, addTaskGroup, editTaskGroup, deleteTaskGroup, previewReplan, applyReplan, startTimer, pauseTimer, stopTimer, resetAll])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside AppProvider')
  return value
}
