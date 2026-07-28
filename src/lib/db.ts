import { openDB } from 'idb'
import type { AppState } from '../types'

const DB_NAME = 'study-planner-db'
const STORE = 'app'
const KEY = 'state'

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
    }
  })
}

export async function loadLocalState(): Promise<AppState | undefined> {
  const database = await db()
  return database.get(STORE, KEY)
}

export async function saveLocalState(state: AppState): Promise<void> {
  const database = await db()
  await database.put(STORE, state, KEY)
}

export async function clearLocalState(): Promise<void> {
  const database = await db()
  await database.delete(STORE, KEY)
}
