import { useEffect, useState } from 'react'
import { pendingSignupInfo, subscribePendingSignup } from '../lib/analytics'
import { resendSignupConfirmation } from '../lib/supabase'

export function EmailVerificationBanner() {
  const [pending, setPending] = useState(() => pendingSignupInfo())
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => subscribePendingSignup(() => setPending(pendingSignupInfo())), [])
  if (!pending?.email) return null

  const resend = async () => {
    try {
      setSending(true)
      setMessage('')
      await resendSignupConfirmation(pending.email)
      setMessage('验证邮件已重新发送。请检查收件箱、垃圾邮件和广告/订阅分类。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重新发送失败，请稍后再试。')
    } finally {
      setSending(false)
    }
  }

  return <aside className="email-verification-banner" role="status" aria-live="polite">
    <div>
      <strong>还差一步：必须验证邮箱</strong>
      <p>注册不会自动完成。请打开发送到 <b>{pending.email}</b> 的验证邮件并点击确认链接，验证后才能正常登录和使用云同步。</p>
      <small>如果几分钟内没看到，请检查垃圾邮件、广告/订阅分类，并确认邮箱地址没有输错。</small>
      {message && <p className="email-verification-message">{message}</p>}
    </div>
    <button className="secondary-button" disabled={sending} onClick={() => void resend()}>{sending ? '发送中……' : '重新发送验证邮件'}</button>
  </aside>
}
