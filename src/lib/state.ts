import type { AppState, AppStatePortable } from '../types'

/**
 * 深拷贝当前可变计划，但让大型本地历史数组保持引用，避免普通输入反复复制快照。
 */
export function cloneActiveState(state: AppState): AppState {
  const next = structuredClone({
    ...state,
    replanHistory: [],
    conflictBackups: [],
    planVersions: [],
  }) as AppState
  next.replanHistory = state.replanHistory
  next.conflictBackups = state.conflictBackups
  next.planVersions = state.planVersions
  return next
}

/** 云端与方案快照只携带当前可移植状态，不嵌套大型历史。 */
export function portableState(state: AppState): AppStatePortable {
  const {
    replanHistory: _history,
    conflictBackups: _backups,
    planVersions: _versions,
    ...portable
  } = state
  return structuredClone(portable)
}

export function hydratePortableState(portable: AppStatePortable, local?: Pick<AppState, 'replanHistory' | 'conflictBackups' | 'planVersions'>): AppState {
  return {
    ...structuredClone(portable),
    replanHistory: local?.replanHistory ?? [],
    conflictBackups: local?.conflictBackups ?? [],
    planVersions: local?.planVersions ?? [],
  }
}

export function stableSignature(value: unknown): string {
  const sortValue = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortValue)
    if (!input || typeof input !== 'object') return input
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]))
  }
  const text = JSON.stringify(sortValue(value))
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
