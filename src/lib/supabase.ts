import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { AppState } from '../types'
import { portableState } from './state'
import { validateStateInput } from './state-schema'

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
export function preparePortableState(state: AppState) {
  return portableState(state)
}

export class CloudRevisionConflictError extends Error {
  constructor(public expectedRevision: number) {
    super('云端计划已被另一台设备更新。当前修改已保留在本机，请先比较冲突版本。')
    this.name = 'CloudRevisionConflictError'
  }
}

export interface CloudSnapshot {
  state: AppState
  revision: number
}

async function resolveUserId(userId?: string): Promise<string> {
  if (userId) return userId
  const session = await getSession()
  if (!session) throw new Error('请先登录')
  return session.user.id
}

export async function uploadSnapshot(state: AppState, userId?: string, expectedRevision?: number): Promise<{ savedAt: string; revision: number }> {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const resolvedUserId = await resolveUserId(userId)
  const now = new Date().toISOString()
  const portable = preparePortableState(state)
  const payload = { ...portable, lastCloudSyncAt: now, updatedAt: state.updatedAt }
  const nextRevision = (expectedRevision ?? 0) + 1
  if (expectedRevision === undefined) {
    const { error } = await supabase.from('study_snapshots').insert({
      user_id: resolvedUserId, data: payload, client_updated_at: state.updatedAt, updated_at: now, revision: nextRevision,
    })
    if (error) {
      if (error.code === '23505') throw new CloudRevisionConflictError(0)
      throw error
    }
    return { savedAt: now, revision: nextRevision }
  }
  const { data, error } = await supabase.from('study_snapshots').update({
    data: payload, client_updated_at: state.updatedAt, updated_at: now, revision: nextRevision,
  }).eq('user_id', resolvedUserId).eq('revision', expectedRevision).select('revision').maybeSingle()
  if (error) throw error
  if (!data) throw new CloudRevisionConflictError(expectedRevision)
  return { savedAt: now, revision: Number(data.revision) }
}

export async function downloadSnapshot(userId?: string): Promise<CloudSnapshot | undefined> {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const resolvedUserId = await resolveUserId(userId)
  const { data, error } = await supabase.from('study_snapshots').select('data, revision').eq('user_id', resolvedUserId).maybeSingle()
  if (error) throw error
  if (!data) return undefined
  const validation = validateStateInput(data.data, 'cloud')
  if (!validation.success || !validation.data) throw new Error(`云端快照结构无效：${validation.issues.slice(0, 3).join('；')}`)
  return { state: validation.data, revision: Math.max(1, Number(data.revision) || 1) }
}
