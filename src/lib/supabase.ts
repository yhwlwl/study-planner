import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { AppState } from '../types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const supabaseConfigured = Boolean(url && anon)
export const supabase: SupabaseClient | undefined = supabaseConfigured ? createClient(url!, anon!) : undefined

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}

export async function signUp(email: string, password: string) {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data.session
}

export async function signOut() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/**
 * Replan snapshots and conflict backups are intentionally local-only. They can be
 * several times larger than the active plan and previously made every cloud upsert
 * resend megabytes of nested JSON. The active plan still syncs completely.
 */
export function preparePortableState(state: AppState): AppState {
  return {
    ...state,
    replanHistory: [],
    conflictBackups: []
  }
}

async function resolveUserId(userId?: string): Promise<string> {
  if (userId) return userId
  const session = await getSession()
  if (!session) throw new Error('请先登录')
  return session.user.id
}

export async function uploadSnapshot(state: AppState, userId?: string): Promise<string> {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const resolvedUserId = await resolveUserId(userId)
  const now = new Date().toISOString()
  const portable = preparePortableState(state)
  const payload = { ...portable, lastCloudSyncAt: now, updatedAt: state.updatedAt }
  const { error } = await supabase.from('study_snapshots').upsert({
    user_id: resolvedUserId,
    data: payload,
    client_updated_at: state.updatedAt,
    updated_at: now
  }, { onConflict: 'user_id' })
  if (error) throw error
  return now
}

export async function downloadSnapshot(userId?: string): Promise<AppState | undefined> {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const resolvedUserId = await resolveUserId(userId)
  const { data, error } = await supabase.from('study_snapshots').select('data').eq('user_id', resolvedUserId).maybeSingle()
  if (error) throw error
  return data?.data as AppState | undefined
}
