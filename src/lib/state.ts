import type { AppState } from '../types'

/**
 * Deep-clones the active plan while keeping large local-only history arrays by
 * reference. The active data remains fully isolated for mutation, but opening a
 * preview no longer copies megabytes of immutable snapshot strings.
 */
export function cloneActiveState(state: AppState): AppState {
  const next = structuredClone({
    ...state,
    replanHistory: [],
    conflictBackups: []
  }) as AppState
  next.replanHistory = state.replanHistory
  next.conflictBackups = state.conflictBackups
  return next
}
