import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Inbox, Save, Sparkles } from 'lucide-react'
import { submitFeedback, type FeedbackType } from '../lib/supabase'
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

export function FeedbackPage() {
  const [type, setType] = useState<FeedbackType>('bug')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string }>()

  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault()
    const trimmed = content.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setStatus(undefined)
    try {
      await submitFeedback({ type, content: trimmed })
      setContent('')
      setStatus({ kind: 'success', message: '已收到，感谢你的反馈。' })
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : '提交失败，请稍后重试。' })
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="feedback-page">
    <section className="feedback-hero">
      <div>
        <span className="feedback-eyebrow">帮助我们改进</span>
        <h2>意见反馈</h2>
        <p>选择最接近的反馈类型并告诉我们具体情况。提交后会直接进入反馈列表，不会改动你的学习计划。</p>
      </div>
    </section>

    <form className="feedback-form" onSubmit={submit}>
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
        <textarea
          value={content}
          onChange={event => { setContent(event.target.value); if (status) setStatus(undefined) }}
          placeholder={placeholders[type]}
          maxLength={4000}
          rows={9}
          required
        />
      </label>

      {status && <div className={`feedback-status ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
        {status.kind === 'success' && <CheckCircle2 size={18}/>}<span>{status.message}</span>
      </div>}

      <div className="feedback-submit-row">
        <p>反馈仅用于改进产品；请不要填写密码、验证码等敏感信息。</p>
        <button className="primary-button" type="submit" disabled={submitting || !content.trim()}>
          <Save size={16}/>{submitting ? '正在提交…' : '提交反馈'}
        </button>
      </div>
    </form>
  </div>
}
