import { useEffect, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, ImagePlus, Inbox, MessageCircle, RefreshCw, Sparkles, Upload, X } from 'lucide-react'
import {
  appendFeedbackReply,
  FEEDBACK_UNREAD_EVENT,
  getFeedbackSessionContext,
  getUnreadFeedbackReplyCount,
  listFeedback,
  markAdminFollowupsRead,
  markFeedbackRepliesRead,
  replyToFeedback,
  submitFeedback,
  updateFeedbackStatus,
  validateFeedbackScreenshots,
  type FeedbackAttachment,
  type FeedbackRecord,
  type FeedbackReply,
  type FeedbackStatus,
  type FeedbackType,
} from '../lib/feedback'
import '../feedback.css'

const feedbackOptions: Array<{ type: FeedbackType; title: string; description: string; icon: any }> = [
  { type: 'bug', title: 'Bug 反馈', description: '功能异常、显示问题、数据不一致或操作失败。', icon: AlertTriangle },
  { type: 'suggestion', title: '新功能需求', description: '希望增加的能力、新流程或新的使用方式。', icon: Sparkles },
  { type: 'experience', title: '体验优化', description: '现有功能能用，但操作、文案、布局或流程可以更顺手。', icon: CheckCircle2 },
  { type: 'other', title: '其他', description: '不属于以上类别的建议、感受或补充说明。', icon: Inbox },
]

const placeholders: Record<FeedbackType, string> = {
  bug: '请描述你遇到的问题、当时正在做什么，以及你期望发生什么。',
  suggestion: '请描述你希望增加的功能，以及它能帮你解决什么问题。',
  experience: '请描述哪里用起来不够顺手，以及你希望怎样改进。',
  other: '请写下你想告诉我们的内容。',
}

const typeLabels: Record<FeedbackType, string> = {
  bug: 'Bug 反馈', suggestion: '新功能需求', experience: '体验优化', other: '其他',
}

const statusLabels: Record<FeedbackStatus, string> = {
  new: '已收到', reviewing: '处理中', planned: '已计划', resolved: '已解决', closed: '已关闭',
}

const depthLabels: Record<string, string> = {
  new: '新用户', casual: '轻度用户', returning: '回访用户', engaged: '活跃用户', power: '深度用户',
}

function displayTime(value: string) {
  try { return new Date(value).toLocaleString('zh-CN', { hour12: false }) } catch { return value }
}

function detailValue(value: string | number | boolean | null | undefined, options?: { time?: boolean; suffix?: string }) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (options?.time && typeof value === 'string') return displayTime(value)
  return `${value}${options?.suffix ?? ''}`
}

function AttachmentGrid({ attachments }: { attachments: FeedbackAttachment[] }) {
  if (!attachments.length) return null
  return <div className="feedback-attachment-grid">
    {attachments.map(attachment => attachment.signed_url
      ? <a href={attachment.signed_url} target="_blank" rel="noreferrer" key={attachment.id} className="feedback-attachment">
          <img src={attachment.signed_url} alt={attachment.file_name}/>
          <span>{attachment.file_name}</span>
        </a>
      : <div className="feedback-attachment unavailable" key={attachment.id}><span>{attachment.file_name}</span></div>)}
  </div>
}

function SelectedReplyFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (!files.length) return null
  return <div className="feedback-selected-files feedback-reply-files">
    {files.map((file, index) => <div key={`${file.name}-${file.size}-${index}`}>
      <span>{file.name}</span>
      <button type="button" aria-label={`移除 ${file.name}`} onClick={() => onRemove(index)}><X size={15}/></button>
    </div>)}
  </div>
}

function AdminDetails({ record }: { record: FeedbackRecord }) {
  const groups: Array<{ title: string; items: Array<[string, string]> }> = [
    {
      title: '身份与反馈',
      items: [
        ['反馈 ID', detailValue(record.id)],
        ['用户 ID', detailValue(record.user_id)],
        ['游客 ID', detailValue(record.visitor_id)],
        ['账号模式', record.account_mode === 'account' ? '登录账号' : record.account_mode === 'guest' ? '游客' : '—'],
        ['反馈类型', typeLabels[record.feedback_type]],
        ['处理状态', statusLabels[record.status]],
        ['提交时间', detailValue(record.created_at, { time: true })],
      ],
    },
    {
      title: '来源与设备环境',
      items: [
        ['应用版本', detailValue(record.app_version)],
        ['所在页面', detailValue(record.page_path)],
        ['User Agent', detailValue(record.user_agent)],
        ['UTM 来源', detailValue(record.utm_source)],
        ['UTM 活动', detailValue(record.utm_campaign)],
        ['首次来源页', detailValue(record.first_referrer)],
        ['浏览器语言', detailValue(record.browser_language)],
        ['客户端时区', detailValue(record.client_timezone)],
        ['PWA 模式', detailValue(record.is_pwa)],
      ],
    },
    {
      title: '使用时长与活跃度',
      items: [
        ['首次访问', detailValue(record.first_seen_at, { time: true })],
        ['最近访问', detailValue(record.last_seen_at, { time: true })],
        ['使用跨度', detailValue(record.tenure_days, { suffix: ' 天' })],
        ['累计 Session', detailValue(record.total_sessions)],
        ['累计事件', detailValue(record.total_events)],
        ['累计活跃天数', detailValue(record.total_active_days, { suffix: ' 天' })],
        ['近 30 天 Session', detailValue(record.sessions_30d)],
        ['近 30 天事件', detailValue(record.events_30d)],
        ['近 30 天活跃天数', detailValue(record.active_days_30d, { suffix: ' 天' })],
        ['近 30 天访问页面数', detailValue(record.unique_pages_30d)],
      ],
    },
    {
      title: '学习规划器使用情况',
      items: [
        ['任务数', detailValue(record.assignment_count)],
        ['已完成任务数', detailValue(record.completed_assignment_count)],
        ['任务组数', detailValue(record.task_group_count)],
        ['目标数', detailValue(record.goal_count)],
        ['录入批次数', detailValue(record.intake_batch_count)],
        ['重排次数', detailValue(record.replan_count)],
      ],
    },
    {
      title: '用户深度快照',
      items: [
        ['深度分数', record.depth_score === null || record.depth_score === undefined ? '—' : `${record.depth_score} / 100`],
        ['深度等级', record.depth_level ? `${depthLabels[record.depth_level] ?? record.depth_level}（${record.depth_level}）` : '—'],
        ['计算时间', detailValue(record.depth_calculated_at, { time: true })],
      ],
    },
  ]

  return <details className="feedback-admin-details">
    <summary>查看详细信息</summary>
    <div className="feedback-detail-groups">
      {groups.map(group => <section className="feedback-detail-group" key={group.title}>
        <h4>{group.title}</h4>
        <dl className="feedback-detail-grid">
          {group.items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>)}
      <p className="feedback-detail-security">安全字段 guest_access_hash 不下发到管理端页面。</p>
    </div>
  </details>
}

function replyLabel(reply: FeedbackReply, scope: 'mine' | 'admin') {
  if (reply.author_type === 'admin') return '开发者'
  if (scope === 'mine') return '你'
  return reply.author_type === 'guest' ? '游客' : '用户'
}

function replyIsNew(reply: FeedbackReply, scope: 'mine' | 'admin') {
  if (reply.read_at) return false
  return scope === 'mine' ? reply.author_type === 'admin' : reply.author_type !== 'admin'
}

function FeedbackList({ scope, refreshKey, onUnreadCountChange }: { scope: 'mine' | 'admin'; refreshKey: number; onUnreadCountChange?: (count: number) => void }) {
  const [records, setRecords] = useState<FeedbackRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [replyingId, setReplyingId] = useState<string>()
  const [replyText, setReplyText] = useState('')
  const [replyFiles, setReplyFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const next = await listFeedback(scope)
      setRecords(next)
      if (scope === 'mine') {
        const remaining = await markFeedbackRepliesRead(next)
        onUnreadCountChange?.(remaining)
      } else {
        await markAdminFollowupsRead(next)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '反馈记录加载失败。')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [scope, refreshKey])

  const beginReply = (feedbackId: string) => {
    setReplyingId(feedbackId)
    setReplyText('')
    setReplyFiles([])
    setError('')
    setNotice('')
  }

  const cancelReply = () => {
    setReplyingId(undefined)
    setReplyText('')
    setReplyFiles([])
  }

  const chooseReplyFiles = (record: FeedbackRecord, files: FileList | null) => {
    const next = Array.from(files ?? [])
    const validation = validateFeedbackScreenshots(next)
    if (validation) { setError(validation); return }
    if (!record.user_id && next.length) {
      setError('游客反馈暂不支持在会话中传图片；可以继续发送文字。')
      return
    }
    setReplyFiles(next)
    setError('')
  }

  const sendReply = async (record: FeedbackRecord) => {
    if (!replyText.trim() || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = scope === 'admin'
        ? await replyToFeedback(record.id, replyText, replyFiles)
        : await appendFeedbackReply(record, replyText, replyFiles)
      const failed = result.failedCount > 0 ? `；${result.failedCount} 张图片上传失败` : ''
      setNotice(`${scope === 'admin' ? '回复已发送' : '追加回复已发送'}${failed}。`)
      cancelReply()
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '回复发送失败。')
    } finally { setSaving(false) }
  }

  const changeStatus = async (feedbackId: string, status: FeedbackStatus) => {
    setSaving(true)
    setError('')
    try { await updateFeedbackStatus(feedbackId, status); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '状态更新失败。') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="feedback-empty"><RefreshCw size={18}/><span>正在加载反馈…</span></div>
  if (records.length === 0) return <>{error && <div className="feedback-status error" role="alert">{error}</div>}<div className="feedback-empty"><Inbox size={20}/><span>{scope === 'admin' ? '暂时还没有反馈。' : '当前还没有你提交过的反馈。'}</span></div></>

  return <>
    {error && <div className="feedback-status error" role="alert">{error}</div>}
    {notice && <div className="feedback-status success" role="status"><CheckCircle2 size={18}/><span>{notice}</span></div>}
    <div className="feedback-history-list">
      {records.map(record => {
        const unreadReplies = record.replies.filter(reply => replyIsNew(reply, scope)).length
        const canAttachToReply = Boolean(record.user_id)
        return <article className={`feedback-history-card ${unreadReplies ? 'has-new-reply' : ''}`} key={record.id}>
          <div className="feedback-history-head">
            <div className="feedback-history-meta">
              <span className="feedback-type-badge">{typeLabels[record.feedback_type]}</span>
              <span className={`feedback-state-badge state-${record.status}`}>{statusLabels[record.status]}</span>
              {unreadReplies > 0 && <span className="feedback-new-reply-badge">{scope === 'mine' ? '新回复' : '新追问'} · {unreadReplies}</span>}
              {scope === 'admin' && <span className="feedback-admin-identity">{record.user_id ? '登录用户' : '游客'}</span>}
              {scope === 'admin' && record.depth_level && <span className="feedback-admin-depth">{depthLabels[record.depth_level] ?? record.depth_level} · {record.depth_score ?? 0}分</span>}
            </div>
            <time>{displayTime(record.created_at)}</time>
          </div>
          <p className="feedback-history-content">{record.content}</p>
          <AttachmentGrid attachments={record.attachments}/>

          {scope === 'admin' && <AdminDetails record={record}/>} 

          {record.replies.length > 0 && <div className="feedback-replies feedback-conversation">
            <div className="feedback-conversation-title"><strong><MessageCircle size={15}/>沟通记录</strong><span>{record.replies.length} 条</span></div>
            {record.replies.map(reply => {
              const developer = reply.author_type === 'admin'
              return <div className={`feedback-reply ${developer ? 'feedback-reply-developer' : 'feedback-reply-participant'}`} key={reply.id}>
                <div className="feedback-reply-head">
                  <strong>{replyLabel(reply, scope)}</strong>
                  <div>{replyIsNew(reply, scope) && <em>{scope === 'mine' ? '新回复' : '新追问'}</em>}<time>{displayTime(reply.created_at)}</time></div>
                </div>
                <p>{reply.content}</p>
                <AttachmentGrid attachments={reply.attachments}/>
              </div>
            })}
          </div>}

          <div className={scope === 'admin' ? 'feedback-admin-actions' : 'feedback-user-actions'}>
            {scope === 'admin' && <label>处理状态
              <select value={record.status} disabled={saving} onChange={event => void changeStatus(record.id, event.target.value as FeedbackStatus)}>
                {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>}

            {replyingId === record.id
              ? <div className="feedback-reply-editor">
                  <div className="feedback-reply-editor-heading">
                    <strong>{scope === 'admin' ? '回复用户' : '追加说明'}</strong>
                    <small>{replyText.length} / 4000</small>
                  </div>
                  <textarea value={replyText} maxLength={4000} rows={4} placeholder={scope === 'admin' ? '写给用户的回复…' : '继续补充情况、回答开发者问题，或说明问题是否仍然存在…'} onChange={event => setReplyText(event.target.value)}/>
                  {canAttachToReply
                    ? <label className="feedback-reply-upload">
                        <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => chooseReplyFiles(record, event.target.files)}/>
                        <ImagePlus size={16}/><span>添加图片</span><small>最多 3 张，每张 5MB</small>
                      </label>
                    : <p className="feedback-reply-guest-note">游客会话继续采用本机安全密钥识别，目前只支持文字追加；登录账号反馈可在回复中传图。</p>}
                  <SelectedReplyFiles files={replyFiles} onRemove={index => setReplyFiles(current => current.filter((_, currentIndex) => currentIndex !== index))}/>
                  {(scope === 'mine' && (record.status === 'resolved' || record.status === 'closed')) && <p className="feedback-reopen-note">发送后这条反馈会自动重新打开为“处理中”，方便开发者继续跟进。</p>}
                  <div><button className="ghost-button" type="button" disabled={saving} onClick={cancelReply}>取消</button><button className="primary-button" type="button" disabled={saving || !replyText.trim()} onClick={() => void sendReply(record)}>{saving ? '发送中…' : scope === 'admin' ? '发送回复' : '发送追加回复'}</button></div>
                </div>
              : <button className="ghost-button feedback-open-reply" type="button" onClick={() => beginReply(record.id)}><MessageCircle size={15}/>{scope === 'admin' ? '回复用户' : record.replies.length ? '继续回复' : '追加说明'}</button>}
          </div>
        </article>
      })}
    </div>
  </>
}

export function FeedbackPage() {
  const [view, setView] = useState<'submit' | 'mine' | 'admin'>('submit')
  const [type, setType] = useState<FeedbackType>('bug')
  const [content, setContent] = useState('')
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string }>()
  const [sessionReady, setSessionReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    void getFeedbackSessionContext({ refresh: true }).then(context => {
      setSignedIn(Boolean(context.session))
      setIsAdmin(context.isAdmin)
      setSessionReady(true)
    }).catch(() => setSessionReady(true))
  }, [])

  useEffect(() => {
    let disposed = false
    const refreshUnread = () => {
      void getUnreadFeedbackReplyCount().then(count => { if (!disposed) setUnreadCount(count) }).catch(() => undefined)
    }
    const onUnreadChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail
      if (typeof detail?.count === 'number') setUnreadCount(detail.count)
      else refreshUnread()
    }
    refreshUnread()
    window.addEventListener(FEEDBACK_UNREAD_EVENT, onUnreadChanged)
    return () => { disposed = true; window.removeEventListener(FEEDBACK_UNREAD_EVENT, onUnreadChanged) }
  }, [])

  const chooseScreenshots = (files: FileList | null) => {
    const next = Array.from(files ?? [])
    const error = validateFeedbackScreenshots(next)
    if (error) { setStatus({ kind: 'error', message: error }); return }
    if (next.length > 0 && !signedIn) { setStatus({ kind: 'error', message: '登录后才能上传截图。登录后再回到这里即可添加。' }); return }
    setScreenshots(next)
    setStatus(undefined)
  }

  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault()
    const trimmed = content.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setStatus(undefined)
    try {
      const result = await submitFeedback({ type, content: trimmed, screenshots })
      setContent('')
      setScreenshots([])
      setRefreshKey(value => value + 1)
      const extra = result.failedCount > 0 ? `反馈已提交；${result.failedCount} 张截图上传失败，可在“我的反馈”中确认。` : '已收到，感谢你的反馈。之后可以在“我的反馈”里查看回复，并继续和开发者沟通。'
      setStatus({ kind: 'success', message: extra })
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : '提交失败，请稍后重试。' })
    } finally { setSubmitting(false) }
  }

  return <div className="feedback-page">
    <section className="feedback-hero">
      <div>
        <span className="feedback-eyebrow">帮助我们改进</span>
        <h2>意见反馈</h2>
        <p>提交反馈和问题截图，在“我的反馈”中查看处理状态、接收开发者回复，并继续追加说明。</p>
      </div>
    </section>

    {unreadCount > 0 && <div className="feedback-unread-banner" role="status">
      <Bell size={19}/>
      <div><strong>你的反馈有新回复</strong><span>有 {unreadCount} 条开发者回复还没查看，进入“我的反馈”即可看到完整沟通记录。</span></div>
      <button className="primary-button" type="button" onClick={() => setView('mine')}>查看回复</button>
    </div>}

    <div className="feedback-tabs" role="tablist" aria-label="意见反馈">
      <button type="button" className={view === 'submit' ? 'active' : ''} onClick={() => setView('submit')}>提交反馈</button>
      <button type="button" className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>我的反馈{unreadCount > 0 && <em>{unreadCount > 99 ? '99+' : unreadCount}</em>}</button>
      {isAdmin && <button type="button" className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>反馈管理</button>}
    </div>

    {view === 'submit' && <form className="feedback-form" onSubmit={submit}>
      <fieldset className="feedback-type-fieldset">
        <legend>反馈类型</legend>
        <div className="feedback-type-grid">
          {feedbackOptions.map(option => {
            const Icon = option.icon
            const selected = type === option.type
            return <label className={`feedback-type-option ${selected ? 'selected' : ''}`} key={option.type}>
              <input type="radio" name="feedback-type" value={option.type} checked={selected} onChange={() => { setType(option.type); setStatus(undefined) }}/>
              <span className="feedback-type-icon"><Icon size={20}/></span>
              <span className="feedback-type-copy"><strong>{option.title}</strong><small>{option.description}</small></span>
              <span className="feedback-radio-dot" aria-hidden="true"/>
            </label>
          })}
        </div>
      </fieldset>

      <label className="feedback-content-field">
        <span className="feedback-field-heading"><strong>反馈内容</strong><small>{content.length} / 4000</small></span>
        <textarea value={content} onChange={event => { setContent(event.target.value); if (status) setStatus(undefined) }} placeholder={placeholders[type]} maxLength={4000} rows={9} required/>
      </label>

      <div className="feedback-screenshot-field">
        <div className="feedback-field-heading"><strong>问题截图 <span>（可选）</span></strong><small>最多 3 张，每张 5MB</small></div>
        <label className={`feedback-upload ${!signedIn && sessionReady ? 'disabled' : ''}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!signedIn && sessionReady} onChange={event => chooseScreenshots(event.target.files)}/>
          <Upload size={18}/><span>{signedIn ? '选择 PNG / JPG / WebP 截图' : '登录后可上传截图'}</span>
        </label>
        {screenshots.length > 0 && <div className="feedback-selected-files">
          {screenshots.map((file, index) => <div key={`${file.name}-${file.size}-${index}`}><span>{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setScreenshots(current => current.filter((_, currentIndex) => currentIndex !== index))}><X size={15}/></button></div>)}
        </div>}
      </div>

      {status && <div className={`feedback-status ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>{status.kind === 'success' && <CheckCircle2 size={18}/>}<span>{status.message}</span></div>}

      <div className="feedback-submit-row">
        <p>反馈仅用于改进产品；请不要填写密码、验证码等敏感信息。截图存放在私有空间。</p>
        <button className="primary-button" type="submit" disabled={submitting || !content.trim()}><CheckCircle2 size={16}/>{submitting ? '正在提交…' : '提交反馈'}</button>
      </div>
    </form>}

    {view === 'mine' && <section className="feedback-panel">
      <div className="feedback-panel-head"><div><h3>我的反馈</h3><p>{signedIn ? '显示你的账号反馈，以及这台浏览器在登录前提交的游客反馈；每条反馈都可以继续追加说明。' : '未登录也可以查看这台浏览器提交过的反馈、开发者回复并继续追加文字；清除浏览器数据或换设备后无法恢复本机游客记录。'}</p></div>{sessionReady && <button className="ghost-button" type="button" onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={15}/>刷新</button>}</div>
      {!sessionReady ? <div className="feedback-empty"><RefreshCw size={18}/><span>正在准备反馈记录…</span></div> : <FeedbackList scope="mine" refreshKey={refreshKey} onUnreadCountChange={setUnreadCount}/>} 
    </section>}

    {view === 'admin' && isAdmin && <section className="feedback-panel feedback-admin-panel">
      <div className="feedback-panel-head"><div><h3>反馈管理</h3><p>查看全部反馈、完整用户快照和沟通记录；开发者回复可附图片，用户追加追问后也会保留在同一会话里。</p></div><button className="ghost-button" type="button" onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={15}/>刷新</button></div>
      <FeedbackList scope="admin" refreshKey={refreshKey}/>
    </section>}
  </div>
}
