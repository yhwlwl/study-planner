import type { Session } from '@supabase/supabase-js'
import { visitorId } from './analytics'
import { getSession, supabase } from './supabase'

export type FeedbackType = 'bug' | 'suggestion' | 'experience' | 'other'
export type FeedbackStatus = 'new' | 'reviewing' | 'planned' | 'resolved' | 'closed'

export interface FeedbackReply {
  id: string
  feedback_id: string
  content: string
  created_at: string
}

export interface FeedbackAttachment {
  id: string
  feedback_id: string
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  created_at: string
  signed_url?: string
}

export interface FeedbackRecord {
  id: string
  user_id: string | null
  feedback_type: FeedbackType
  content: string
  status: FeedbackStatus
  created_at: string
  replies: FeedbackReply[]
  attachments: FeedbackAttachment[]
}

export interface FeedbackSessionContext {
  session: Session | null
  isAdmin: boolean
}

const SCREENSHOT_BUCKET = 'feedback-screenshots'
const GUEST_SECRET_KEY = 'study-planner:feedback-guest-secret'
const MAX_SCREENSHOTS = 3
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
const ALLOWED_SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
let memoryGuestSecret = ''

function sessionIsFeedbackAdmin(session: Session | null): boolean {
  return Boolean((session?.user as any)?.app_metadata?.feedback_admin === true)
}

export async function getFeedbackSessionContext(options?: { refresh?: boolean }): Promise<FeedbackSessionContext> {
  let session = await getSession()
  if (session && options?.refresh && supabase) {
    const refreshed = await supabase.auth.refreshSession()
    if (!refreshed.error && refreshed.data.session) session = refreshed.data.session
  }
  return { session, isAdmin: sessionIsFeedbackAdmin(session) }
}

export function validateFeedbackScreenshots(files: File[]): string | undefined {
  if (files.length > MAX_SCREENSHOTS) return `最多上传 ${MAX_SCREENSHOTS} 张截图。`
  for (const file of files) {
    if (!ALLOWED_SCREENSHOT_TYPES.has(file.type)) return '截图仅支持 PNG、JPG/JPEG、WebP。'
    if (file.size <= 0 || file.size > MAX_SCREENSHOT_BYTES) return '每张截图不能超过 5MB。'
  }
  return undefined
}

function screenshotExtension(file: File) {
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  return 'jpg'
}

function randomToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function guestFeedbackSecret(): string {
  if (memoryGuestSecret) return memoryGuestSecret
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(GUEST_SECRET_KEY)
      if (stored && stored.length >= 32) {
        memoryGuestSecret = stored
        return stored
      }
    } catch {
      // localStorage 不可用时退回到当前页面生命周期内的内存密钥。
    }
  }

  const generated = `${randomToken()}.${randomToken()}`
  memoryGuestSecret = generated
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(GUEST_SECRET_KEY, generated) } catch { /* ignore */ }
  }
  return generated
}

export async function submitFeedback(input: { type: FeedbackType; content: string; screenshots?: File[] }) {
  if (!supabase) throw new Error('反馈服务暂不可用，请稍后重试。')
  const content = input.content.trim()
  const screenshots = input.screenshots ?? []
  if (!content) throw new Error('请填写反馈内容。')
  if (content.length > 4000) throw new Error('反馈内容不能超过 4000 个字符。')
  const screenshotError = validateFeedbackScreenshots(screenshots)
  if (screenshotError) throw new Error(screenshotError)

  const session = await getSession()
  if (screenshots.length > 0 && !session) throw new Error('登录后才能上传截图。你也可以先移除截图，只提交文字反馈。')

  const stableVisitorId = typeof window === 'undefined' ? null : visitorId()

  if (!session) {
    if (!stableVisitorId) throw new Error('反馈提交失败，请刷新页面后重试。')
    const result = await supabase.rpc('submit_guest_feedback', {
      p_feedback_type: input.type,
      p_content: content,
      p_visitor_id: stableVisitorId,
      p_guest_secret: guestFeedbackSecret(),
    })
    if (result.error || !result.data) throw new Error('反馈提交失败，请稍后重试。')
    return { id: String(result.data), uploadedCount: 0, failedCount: 0 }
  }

  const basePayload = {
    feedback_type: input.type,
    content,
    user_id: session.user.id,
    visitor_id: stableVisitorId,
  }

  const inserted = await supabase.from('feedback_submissions').insert(basePayload).select('id').single()
  if (inserted.error || !inserted.data?.id) throw new Error('反馈提交失败，请稍后重试。')
  const feedbackId = String(inserted.data.id)
  let uploadedCount = 0
  let failedCount = 0

  for (const file of screenshots) {
    const storagePath = `${session.user.id}/${feedbackId}/${randomToken()}.${screenshotExtension(file)}`
    const upload = await supabase.storage.from(SCREENSHOT_BUCKET).upload(storagePath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    })
    if (upload.error) {
      failedCount += 1
      continue
    }
    const metadata = await supabase.from('feedback_attachments').insert({
      feedback_id: feedbackId,
      storage_path: storagePath,
      file_name: file.name.slice(0, 255) || `截图.${screenshotExtension(file)}`,
      mime_type: file.type,
      size_bytes: file.size,
    })
    if (metadata.error) failedCount += 1
    else uploadedCount += 1
  }

  return { id: feedbackId, uploadedCount, failedCount }
}

async function signedAttachment(attachment: FeedbackAttachment): Promise<FeedbackAttachment> {
  if (!supabase) return attachment
  const signed = await supabase.storage.from(SCREENSHOT_BUCKET).createSignedUrl(attachment.storage_path, 60 * 30)
  return signed.error || !signed.data?.signedUrl ? attachment : { ...attachment, signed_url: signed.data.signedUrl }
}

async function listGuestFeedbackForBrowser(): Promise<FeedbackRecord[]> {
  if (!supabase || typeof window === 'undefined') return []
  const stableVisitorId = visitorId()
  const result = await supabase.rpc('list_guest_feedback', {
    p_visitor_id: stableVisitorId,
    p_guest_secret: guestFeedbackSecret(),
  })
  if (result.error) throw new Error('本机游客反馈加载失败，请稍后重试。')
  if (!Array.isArray(result.data)) return []
  return result.data.map((row: any) => ({
    id: String(row.id),
    user_id: row.user_id ? String(row.user_id) : null,
    feedback_type: row.feedback_type as FeedbackType,
    content: String(row.content ?? ''),
    status: row.status as FeedbackStatus,
    created_at: String(row.created_at),
    replies: Array.isArray(row.replies) ? row.replies as FeedbackReply[] : [],
    attachments: [],
  }))
}

function newestFirst(records: FeedbackRecord[]): FeedbackRecord[] {
  const seen = new Set<string>()
  return records
    .filter(record => {
      if (seen.has(record.id)) return false
      seen.add(record.id)
      return true
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

export async function listFeedback(scope: 'mine' | 'admin'): Promise<FeedbackRecord[]> {
  if (!supabase) throw new Error('反馈服务暂不可用，请稍后重试。')
  const { session, isAdmin } = await getFeedbackSessionContext({ refresh: true })
  if (scope === 'admin' && (!session || !isAdmin)) throw new Error('当前账号没有反馈管理权限。')

  const guestRows = scope === 'mine' ? await listGuestFeedbackForBrowser() : []
  if (!session) return guestRows

  let query = supabase
    .from('feedback_submissions')
    .select('id,user_id,feedback_type,content,status,created_at')
    .order('created_at', { ascending: false })
  if (scope === 'mine') query = query.eq('user_id', session.user.id)

  const submissions = await query
  if (submissions.error) throw new Error('反馈记录加载失败，请稍后重试。')
  const rows = (submissions.data ?? []) as Array<Omit<FeedbackRecord, 'replies' | 'attachments'>>
  if (rows.length === 0) return newestFirst(guestRows)

  const ids = rows.map(row => row.id)
  const [repliesResult, attachmentsResult] = await Promise.all([
    supabase.from('feedback_replies').select('id,feedback_id,content,created_at').in('feedback_id', ids).order('created_at', { ascending: true }),
    supabase.from('feedback_attachments').select('id,feedback_id,storage_path,file_name,mime_type,size_bytes,created_at').in('feedback_id', ids).order('created_at', { ascending: true }),
  ])
  if (repliesResult.error) throw new Error('开发者回复加载失败，请稍后重试。')
  if (attachmentsResult.error) throw new Error('反馈截图加载失败，请稍后重试。')

  const replies = (repliesResult.data ?? []) as FeedbackReply[]
  const attachments = await Promise.all(((attachmentsResult.data ?? []) as FeedbackAttachment[]).map(signedAttachment))
  const accountRows = rows.map(row => ({
    ...row,
    replies: replies.filter(reply => reply.feedback_id === row.id),
    attachments: attachments.filter(attachment => attachment.feedback_id === row.id),
  }))

  return scope === 'mine' ? newestFirst([...accountRows, ...guestRows]) : accountRows
}

export async function replyToFeedback(feedbackId: string, content: string) {
  if (!supabase) throw new Error('反馈服务暂不可用，请稍后重试。')
  const trimmed = content.trim()
  if (!trimmed) throw new Error('请填写回复内容。')
  if (trimmed.length > 4000) throw new Error('回复不能超过 4000 个字符。')
  const { isAdmin } = await getFeedbackSessionContext({ refresh: true })
  if (!isAdmin) throw new Error('当前账号没有反馈管理权限。')

  const inserted = await supabase.from('feedback_replies').insert({ feedback_id: feedbackId, content: trimmed })
  if (inserted.error) throw new Error('回复发送失败，请稍后重试。')
  const statusUpdate = await supabase.from('feedback_submissions').update({ status: 'reviewing' }).eq('id', feedbackId).eq('status', 'new')
  if (statusUpdate.error) console.warn('反馈状态未能自动更新为处理中。', statusUpdate.error)
}

export async function updateFeedbackStatus(feedbackId: string, status: FeedbackStatus) {
  if (!supabase) throw new Error('反馈服务暂不可用，请稍后重试。')
  const { isAdmin } = await getFeedbackSessionContext({ refresh: true })
  if (!isAdmin) throw new Error('当前账号没有反馈管理权限。')
  const result = await supabase.from('feedback_submissions').update({ status }).eq('id', feedbackId)
  if (result.error) throw new Error('反馈状态更新失败，请稍后重试。')
}
