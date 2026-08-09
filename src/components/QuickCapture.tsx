import { useState } from 'react'
import { ArrowUpRight, Inbox } from 'lucide-react'
import { useApp } from '../AppContext'
import { parsePastedText } from '../lib/intake'

/**
 * A lightweight inbox: capturing text must never invoke the scheduler. Users can
 * clarify the parsed draft and decide when to generate a plan in the intake page.
 */
export function QuickCapture({ onOpenIntake, className = '' }: { onOpenIntake: () => void; className?: string }) {
  const { state, createIntakeBatch, addIntakeTaskGroup } = useApp()
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const parsed = parsePastedText(text)
    if (!parsed.drafts.length) {
      setMessage(parsed.issues[0]?.message ?? '没有识别到任务。')
      return
    }
    const existing = [...state.intakeBatches].reverse().find(batch =>
      (batch.status === 'editing' || batch.status === 'pending') && batch.taskGroups.some(item => !item.appliedAt),
    )
    const batchId = existing?.id ?? createIntakeBatch('快速收件箱')
    parsed.drafts.forEach(draft => addIntakeTaskGroup(batchId, draft, 'paste'))
    setText('')
    setMessage(`已收进“${existing?.name ?? '快速收件箱'}”，不会立即改动正式计划。`)
  }

  return <section className={`quick-capture ${className}`.trim()} aria-label="快速记录待安排任务">
    <div className="quick-capture-copy"><Inbox size={18}/><span><strong>先记下来，稍后再安排</strong><small>支持“化学错题 10组 每组30分钟 明天前”这样的写法。</small></span></div>
    <form onSubmit={submit}>
      <input aria-label="快速记录任务" value={text} onChange={event => { setText(event.target.value); setMessage('') }} placeholder="输入一个任务，按 Enter 收进待安排…"/>
      <button className="primary-button" type="submit" disabled={!text.trim()}><span>收进来</span><ArrowUpRight size={16}/></button>
    </form>
    <div className="quick-capture-foot"><span className={message ? 'visible' : ''} aria-live="polite">{message || '录入阶段不运行完整排期'}</span><button className="text-button" type="button" onClick={onOpenIntake}>打开录入工作区</button></div>
  </section>
}
