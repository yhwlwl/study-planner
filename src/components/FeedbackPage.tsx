import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Inbox, RefreshCw, Sparkles, Upload, X } from 'lucide-react'
import {
  getFeedbackSessionContext,
  listFeedback,
  replyToFeedback,
  submitFeedback,
  updateFeedbackStatus,
  validateFeedbackScreenshots,
  type FeedbackRecord,
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

function displayTime(value: string) {
  try { return new Date(value).toLocaleString('zh-CN', { hour12: false }) } catch { return value }
}

function FeedbackList({ scope, refreshKey }: { scope: 'mine' | 'admin'; refreshKey: number }) {
  const [records, setRecords] = useState<FeedbackRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [replyingId, setReplyingId] = useState<string>()
  const [replyText, setReplyText] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try { setRecords(await listFeedback(scope)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '反馈记录加载失败。') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [scope, refreshKey])

  const sendReply = async (feedbackId: string) => {
    if (!replyText.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await replyToFeedback(feedbackId, replyText)
      setReplyText('')
      setReplyingId(undefined)
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
  if (error) return <div className="feedback-status error" role="alert">{error}</div>
  if (records.length === 0) return <div className="feedback-empty"><Inbox size={20}/><span>{scope === 'admin' ? '暂时还没有反馈。' : '你还没有提交过反馈。'}</span></div>

  return <div className="feedback-history-list">
    {records.map(record => <article className="feedback-history-card" key={record.id}>
      <div className="feedback-history-head">
        <div className="feedback-history-meta">
          <span className="feedback-type-badge">{typeLabels[record.feedback_type]}</span>
          <span className={`feedback-state-badge state-${record.status}`}>{statusLabels[record.status]}</span>
        </div>
        <time>{displayTime(record.created_at)}</time>
      </div>
      <p className="feedback-history-content">{record.content}</p>

      {record.attachments.length > 0 && <div className="feedback-attachment-grid">
        {record.attachments.map(attachment => attachment.signed_url
          ? <a href={attachment.signed_url} target="_blank" rel="noreferrer" key={attachment.id} className="feedback-attachment">
              <img src={attachment.signed_url} alt={attachment.file_name}/>
              <span>{attachment.file_name}</span>
            </a>
          : <div className="feedback-attachment unavailable" key={attachment.id}><span>{attachment.file_name}</span></div>)}
      </div>}

      {record.replies.length > 0 && <div className="feedback-replies">
        <strong>开发者回复</strong>
        {record.replies.map(reply => <div className="feedback-reply" key={reply.id}>
          <p>{reply.content}</p><time>{displayTime(reply.created_at)}</time>
        </div>)}
      </div>}

      {scope === 'admin' && <div className="feedback-admin-actions">
        <label>处理状态
          <select value={record.status} disabled={saving} onChange={event => void changeStatus(record.id, event.target.value as FeedbackStatus)}>
            {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        {replyingId === record.id
          ? <div className="feedback-reply-editor">
              <textarea value={replyText} maxLength={4000} rows={4} placeholder="写给用户的回复…" onChange={event => setReplyText(event.target.value)}/>
              <div><button className="ghost-button" type="button" onClick={() => { setReplyingId(undefined); setReplyText('') }}>取消</button><button className="primary-button" type="button" disabled={saving || !replyText.trim()} onClick={() => void sendReply(record.id)}>{saving ? '发送中…' : '发送回复'}</button></div>
            </div>
          : <button className="ghost-button" type="button" onClick={() => { setReplyingId(record.id); setReplyText('') }}>回复用户</button>}
      </div>}
    </article>)}
  </div>
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

  useEffect(() => {
    void getFeedbackSessionContext({ refresh: true }).then(context => {
      setSignedIn(Boolean(context.session))
      setIsAdmin(context.isAdmin)
      setSessionReady(true)
    }).catch(() => setSessionReady(true))
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
      const extra = result.failedCount > 0 ? `反馈已提交；${result.failedCount} 张截图上传失败，可在“我的反馈”中确认。` : '已收到，感谢你的反馈。'
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
        <p>提交反馈、附上问题截图，并在“我的反馈”里查看处理状态和开发者回复。</p>
      </div>
    </section>

    <div className="feedback-tabs" role="tablist" aria-label="意见反馈">
      <button type="button" className={view === 'submit' ? 'active' : ''} onClick={() => setView('submit')}>提交反馈</button>
      <button type="button" className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>我的反馈</button>
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
      <div className="feedback-panel-head"><div><h3>我的反馈</h3><p>查看你提交过的反馈、处理状态、截图和开发者回复。</p></div>{signedIn && <button className="ghost-button" type="button" onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={15}/>刷新</button>}</div>
      {!sessionReady ? <div className="feedback-empty"><RefreshCw size={18}/><span>正在确认登录状态…</span></div> : signedIn ? <FeedbackList scope="mine" refreshKey={refreshKey}/> : <div className="feedback-empty"><Inbox size={20}/><span>登录后即可查看“我的反馈”和开发者回复。</span></div>}
    </section>}

    {view === 'admin' && isAdmin && <section className="feedback-panel">
      <div className="feedback-panel-head"><div><h3>反馈管理</h3><p>查看全部反馈、调整状态并回复用户。</p></div><button className="ghost-button" type="button" onClick={() => setRefreshKey(value => value + 1)}><RefreshCw size={15}/>刷新</button></div>
      <FeedbackList scope="admin" refreshKey={refreshKey}/>
    </section>}
  </div>
}
