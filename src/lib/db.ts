import { openDB } from 'idb'
import type { AppState } from '../types'

const DB_NAME = 'study-planner-db'
const STORE = 'app'
const keyFor = (namespace: string) => `state:${namespace}`

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
    }
  })
}

export async function loadLocalState(namespace = 'guest'): Promise<AppState | undefined> {
  const database = await db()
  return database.get(STORE, keyFor(namespace))
}

export async function saveLocalState(namespace: string, state: AppState): Promise<void> {
  const database = await db()
  await database.put(STORE, state, keyFor(namespace))
}

export async function clearLocalState(namespace: string): Promise<void> {
  const database = await db()
  await database.delete(STORE, keyFor(namespace))
}
