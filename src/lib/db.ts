import { openDB } from 'idb'
import type { AppState } from '../types'

const DB_NAME = 'study-planner-db'
const STORE = 'app'
const keyFor = (namespace: string) => `state:${namespace}`
const historyKeyFor = (namespace: string) => `history:${namespace}`
const backupKeyFor = (namespace: string) => `backups:${namespace}`

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
    }
  })
}

/**
 * Large replan snapshots and conflict backups are local-only data. Keeping them in
 * separate IndexedDB records means ordinary edits only rewrite the active plan,
 * instead of cloning and persisting several megabytes of history every time.
 */
function coreState(state: AppState): AppState {
  return {
    ...state,
    replanHistory: [],
    conflictBackups: []
  }
}

export async function loadLocalState(namespace = 'guest'): Promise<AppState | undefined> {
  const database = await db()
  const transaction = database.transaction(STORE, 'readonly')
  const store = transaction.objectStore(STORE)
  const [storedCore, storedHistory, storedBackups] = await Promise.all([
    store.get(keyFor(namespace)) as Promise<AppState | undefined>,
    store.get(historyKeyFor(namespace)) as Promise<AppState['replanHistory'] | undefined>,
    store.get(backupKeyFor(namespace)) as Promise<string[] | undefined>
  ])
  await transaction.done
  if (!storedCore) return undefined

  // Backward-compatible migration: older versions stored everything in one record.
  return {
    ...storedCore,
    replanHistory: storedHistory ?? storedCore.replanHistory ?? [],
    conflictBackups: storedBackups ?? storedCore.conflictBackups ?? []
  }
}

type SaveWaiter = { resolve: () => void; reject: (error: unknown) => void }
type SaveSlot = {
  pending?: AppState
  running: boolean
  waiters: SaveWaiter[]
  lastHistoryRef?: AppState['replanHistory']
  lastBackupRef?: string[]
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
  const backups = state.conflictBackups ?? []
  if (slot.lastBackupRef !== backups) {
    requests.push(store.put(backups, backupKeyFor(namespace)))
    slot.lastBackupRef = backups
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
    const waiters = slot.waiters.splice(0)
    waiters.forEach(waiter => waiter.resolve())
  } catch (error) {
    const waiters = slot.waiters.splice(0)
    waiters.forEach(waiter => waiter.reject(error))
  } finally {
    slot.running = false
    if (slot.pending) void drainSaveQueue(namespace, slot)
  }
}

/**
 * Coalesces rapid edits. If several state changes arrive while IndexedDB is still
 * writing, only the newest state is persisted next; obsolete intermediate writes
 * are skipped instead of forming a slow backlog.
 */
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
    store.delete(keyFor(namespace)),
    store.delete(historyKeyFor(namespace)),
    store.delete(backupKeyFor(namespace))
  ])
  await transaction.done
  saveSlots.delete(namespace)
}
