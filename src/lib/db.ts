import { openDB } from 'idb'
import type { AppState } from '../types'
import { SCHEMA_VERSION } from '../types'
import { validateStateInput, type StateInputSource } from './state-schema'

const DB_NAME = 'study-planner-db'
const STORE = 'app'
const keyFor = (namespace: string) => `state:${namespace}`
const historyKeyFor = (namespace: string) => `history:${namespace}`
const backupKeyFor = (namespace: string) => `backups:${namespace}`
const versionsKeyFor = (namespace: string) => `versions:${namespace}`
const recoveryKeyFor = (namespace: string) => `recovery:${namespace}`

export interface DataRecoverySnapshot {
  id: string
  createdAt: string
  reason: 'before-migration' | 'invalid-data' | 'before-replacement' | 'cloud-conflict'
  source: StateInputSource
  schemaVersion?: number
  raw: string
  issues?: string[]
}

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
    }
  })
}

function coreState(state: AppState): AppState {
  return { ...state, replanHistory: [], conflictBackups: [], planVersions: [] }
}

export async function loadLocalState(namespace = 'guest'): Promise<AppState | undefined> {
  const database = await db()
  const transaction = database.transaction(STORE, 'readonly')
  const store = transaction.objectStore(STORE)
  const [storedCore, storedHistory, storedBackups, storedVersions] = await Promise.all([
    store.get(keyFor(namespace)) as Promise<AppState | undefined>,
    store.get(historyKeyFor(namespace)) as Promise<AppState['replanHistory'] | undefined>,
    store.get(backupKeyFor(namespace)) as Promise<string[] | undefined>,
    store.get(versionsKeyFor(namespace)) as Promise<AppState['planVersions'] | undefined>,
  ])
  await transaction.done
  if (!storedCore) return undefined
  const combined = {
    ...storedCore,
    replanHistory: storedHistory ?? storedCore.replanHistory ?? [],
    conflictBackups: storedBackups ?? storedCore.conflictBackups ?? [],
    planVersions: storedVersions ?? storedCore.planVersions ?? [],
  }
  const validation = validateStateInput(combined, 'indexeddb')
  const version = Number((combined as Partial<AppState>).schemaVersion ?? (combined as Partial<AppState>).version ?? 0)
  if (!validation.success) {
    await preserveRecoverySnapshot(namespace, combined, 'invalid-data', 'indexeddb', validation.issues)
    return undefined
  }
  if (version > 0 && version < SCHEMA_VERSION) {
    await preserveRecoverySnapshot(namespace, combined, 'before-migration', 'indexeddb')
  }
  return validation.data
}

export async function preserveRecoverySnapshot(
  namespace: string,
  raw: unknown,
  reason: DataRecoverySnapshot['reason'],
  source: StateInputSource,
  issues?: string[],
) {
  const database = await db()
  const existing = await database.get(STORE, recoveryKeyFor(namespace)) as DataRecoverySnapshot[] | undefined
  let serialized: string
  try { serialized = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2) } catch { serialized = String(raw) }
  if (existing?.at(-1)?.raw === serialized && existing.at(-1)?.reason === reason) return existing.at(-1)!
  const snapshot: DataRecoverySnapshot = {
    id: globalThis.crypto?.randomUUID?.() ?? `recovery-${Date.now()}`,
    createdAt: new Date().toISOString(), reason, source,
    schemaVersion: Number((raw as Partial<AppState> | undefined)?.schemaVersion ?? (raw as Partial<AppState> | undefined)?.version) || undefined,
    raw: serialized, issues,
  }
  await database.put(STORE, [...(existing ?? []), snapshot].slice(-10), recoveryKeyFor(namespace))
  return snapshot
}

export async function listRecoverySnapshots(namespace: string): Promise<DataRecoverySnapshot[]> {
  const database = await db()
  return (await database.get(STORE, recoveryKeyFor(namespace)) as DataRecoverySnapshot[] | undefined) ?? []
}

export async function deleteRecoverySnapshot(namespace: string, id: string) {
  const database = await db()
  const existing = await listRecoverySnapshots(namespace)
  await database.put(STORE, existing.filter(item => item.id !== id), recoveryKeyFor(namespace))
}

type SaveWaiter = { resolve: () => void; reject: (error: unknown) => void }
type SaveSlot = {
  pending?: AppState
  running: boolean
  waiters: SaveWaiter[]
  lastHistoryRef?: AppState['replanHistory']
  lastBackupRef?: string[]
  lastVersionsRef?: AppState['planVersions']
}
const saveSlots = new Map<string, SaveSlot>()

async function writeLatest(namespace: string, slot: SaveSlot, state: AppState) {
  const database = await db()
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  const requests: Promise<unknown>[] = [store.put(coreState(state), keyFor(namespace))]
  if (slot.lastHistoryRef !== state.replanHistory) {
    requests.push(store.put(state.replanHistory, historyKeyFor(namespace)))
    slot.lastHistoryRef = state.replanHistory
  }
  if (slot.lastBackupRef !== state.conflictBackups) {
    requests.push(store.put(state.conflictBackups, backupKeyFor(namespace)))
    slot.lastBackupRef = state.conflictBackups
  }
  if (slot.lastVersionsRef !== state.planVersions) {
    requests.push(store.put(state.planVersions, versionsKeyFor(namespace)))
    slot.lastVersionsRef = state.planVersions
  }
  await Promise.all(requests)
  await transaction.done
}

async function drainSaveQueue(namespace: string, slot: SaveSlot) {
  slot.running = true
  try {
    while (slot.pending) {
      const latest = slot.pending
      slot.pending = undefined
      await writeLatest(namespace, slot, latest)
    }
    slot.waiters.splice(0).forEach(waiter => waiter.resolve())
  } catch (error) {
    slot.waiters.splice(0).forEach(waiter => waiter.reject(error))
  } finally {
    slot.running = false
    if (slot.pending) void drainSaveQueue(namespace, slot)
  }
}

export function saveLocalState(namespace: string, state: AppState): Promise<void> {
  const slot = saveSlots.get(namespace) ?? { running: false, waiters: [] }
  saveSlots.set(namespace, slot)
  slot.pending = state
  const promise = new Promise<void>((resolve, reject) => slot.waiters.push({ resolve, reject }))
  if (!slot.running) void drainSaveQueue(namespace, slot)
  return promise
}

export async function clearLocalState(namespace: string): Promise<void> {
  const database = await db()
  const transaction = database.transaction(STORE, 'readwrite')
  const store = transaction.objectStore(STORE)
  await Promise.all([
    store.delete(keyFor(namespace)), store.delete(historyKeyFor(namespace)), store.delete(backupKeyFor(namespace)), store.delete(versionsKeyFor(namespace)),
  ])
  await transaction.done
  saveSlots.delete(namespace)
}
