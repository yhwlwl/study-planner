import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { AppState } from '../types'
import { portableState } from './state'
import { validateStateInput } from './state-schema'
import { recordAnalyticsEvent, recordSignupConfirmedIfPending, rememberPendingSignup, visitorId } from './analytics'

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
  if (error) {
    if (/confirm|verified|验证|确认/i.test(error.message)) rememberPendingSignup(email)
    throw error
  }
  return data.session
}

export async function signUp(email: string, password: string) {
  if (!supabase) throw new Error('Supabase 尚未配置')
  void recordAnalyticsEvent('signup_started', { metadata: { emailDomain: email.trim().toLowerCase().split('@')[1] } })
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  if (data.user) {
    rememberPendingSignup(email, data.user.id)
    if (data.session) void recordSignupConfirmedIfPending(data.user.id, data.user.email)
  }
  return data.session
}

export async function resendSignupConfirmation(email: string) {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const { error } = await supabase.auth.resend({ type: 'signup', email })
  if (error) throw error
}

export async function signOut() {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export type FeedbackType = 'bug' | 'feature'

export async function submitFeedback(input: { type: FeedbackType; content: string }) {
  if (!supabase) throw new Error('反馈服务暂不可用，请稍后重试。')
  const content = input.content.trim()
  if (!content) throw new Error('请填写反馈内容。')
  if (content.length > 4000) throw new Error('反馈内容不能超过 4000 个字符。')
  const session = await getSession()
  const { error } = await supabase.from('feedback_submissions').insert({
    feedback_type: input.type === 'feature' ? 'suggestion' : 'bug',
    content,
    user_id: session?.user.id ?? null,
    visitor_id: typeof window === 'undefined' ? null : visitorId(),
  })
  if (error) throw new Error('反馈提交失败，请稍后重试。')
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

type SupabaseErrorShape = { code?: string; message?: string; details?: string; hint?: string }

/**
 * 前端可能先于 Supabase schema migration 发布。若 revision 列暂时不存在，
 * 云端恢复不能因此整体失效；只在明确的“缺少 revision 列”错误下退回旧协议。
 */
export function isMissingCloudRevisionColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as SupabaseErrorShape
  const text = [candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' ')
  return candidate.code === '42703'
    || candidate.code === 'PGRST204'
    || (/\brevision\b/i.test(text) && /(does not exist|not found|schema cache|不存在|未找到)/i.test(text))
}

async function resolveUserId(userId?: string): Promise<string> {
  if (userId) return userId
  const session = await getSession()
  if (!session) throw new Error('请先登录')
  return session.user.id
}

/**
 * v0.8/v0.9 过渡期曾有快照写入旧的 manual-intent 别名 `soft`。
 * 当前领域模型只保留 normal/manual/locked，因此在云端入口做一次无损兼容归一，
 * 让旧快照能够进入后续 normalizeState；未知值仍交给严格 schema 拒绝。
 */
function normalizeLegacyCloudSnapshot(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const snapshot = raw as Record<string, unknown>
  if (!Array.isArray(snapshot.assignments)) return raw
  let changed = false
  const assignments = snapshot.assignments.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const assignment = item as Record<string, unknown>
    if (assignment.intentStrength !== 'soft') return item
    changed = true
    return { ...assignment, intentStrength: 'manual' }
  })
  return changed ? { ...snapshot, assignments } : raw
}

function validateCloudSnapshot(raw: unknown, revision: unknown): CloudSnapshot {
  const validation = validateStateInput(normalizeLegacyCloudSnapshot(raw), 'cloud')
  if (!validation.success || !validation.data) throw new Error(`云端快照结构无效：${validation.issues.slice(0, 3).join('；')}`)
  return { state: validation.data, revision: Math.max(1, Number(revision) || 1) }
}

async function uploadLegacySnapshot(
  resolvedUserId: string,
  payload: ReturnType<typeof preparePortableState> & { lastCloudSyncAt: string; updatedAt: string },
  stateUpdatedAt: string,
  now: string,
  expectedRevision?: number,
): Promise<{ savedAt: string; revision: number }> {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const { error } = await supabase.from('study_snapshots').upsert({
    user_id: resolvedUserId,
    data: payload,
    client_updated_at: stateUpdatedAt,
    updated_at: now,
  }, { onConflict: 'user_id' })
  if (error) throw error
  return { savedAt: now, revision: Math.max(1, (expectedRevision ?? 0) + 1) }
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
      if (isMissingCloudRevisionColumn(error)) return uploadLegacySnapshot(resolvedUserId, payload, state.updatedAt, now)
      if (error.code === '23505') throw new CloudRevisionConflictError(0)
      throw error
    }
    return { savedAt: now, revision: nextRevision }
  }
  const { data, error } = await supabase.from('study_snapshots').update({
    data: payload, client_updated_at: state.updatedAt, updated_at: now, revision: nextRevision,
  }).eq('user_id', resolvedUserId).eq('revision', expectedRevision).select('revision').maybeSingle()
  if (error) {
    if (isMissingCloudRevisionColumn(error)) return uploadLegacySnapshot(resolvedUserId, payload, state.updatedAt, now, expectedRevision)
    throw error
  }
  if (!data) throw new CloudRevisionConflictError(expectedRevision)
  return { savedAt: now, revision: Number(data.revision) }
}

export async function downloadSnapshot(userId?: string): Promise<CloudSnapshot | undefined> {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const resolvedUserId = await resolveUserId(userId)
  const current = await supabase.from('study_snapshots').select('data, revision').eq('user_id', resolvedUserId).maybeSingle()
  if (current.error) {
    if (!isMissingCloudRevisionColumn(current.error)) throw current.error
    const legacy = await supabase.from('study_snapshots').select('data').eq('user_id', resolvedUserId).maybeSingle()
    if (legacy.error) throw legacy.error
    if (!legacy.data) return undefined
    return validateCloudSnapshot(legacy.data.data, 1)
  }
  if (!current.data) return undefined
  return validateCloudSnapshot(current.data.data, current.data.revision)
}
