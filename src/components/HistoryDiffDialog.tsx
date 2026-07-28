import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Lock } from 'lucide-react'
import type { AppState, Assignment, ReplanHistoryEntry, Subject } from '../types'
import { dayTypeLabel, fmtDate, fmtWeekday, minutesText } from '../lib/date'
import { Modal } from './Modal'

type Row = { id: string; before?: Assignment; after?: Assignment; kind: 'same' | 'added' | 'removed' | 'modified' }

function parseState(raw?: string) {
  if (!raw) return undefined
  try { return JSON.parse(raw) as AppState } catch { return undefined }
}

function subjectFor(state: AppState, assignment?: Assignment): Subject {
  return state.taskGroups.find(group => group.id === assignment?.groupId)?.subject ?? '其他'
}

function rowsFor(before: AppState, after: AppState, date: string): Row[] {
  const oldItems = before.assignments.filter(item => item.scheduledDate === date)
  const newItems = after.assignments.filter(item => item.scheduledDate === date)
  const oldMap = new Map(oldItems.map(item => [item.id, item]))
  const newMap = new Map(newItems.map(item => [item.id, item]))
  const order = [...oldItems.map(item => item.id), ...newItems.map(item => item.id).filter(id => !oldMap.has(id))]
  return order.map(id => {
    const oldItem = oldMap.get(id)
    const newItem = newMap.get(id)
    if (oldItem && newItem) {
      const changed = oldItem.estimatedMinutes !== newItem.estimatedMinutes || oldItem.locked !== newItem.locked || oldItem.title !== newItem.title
      return { id, before: oldItem, after: newItem, kind: changed ? 'modified' : 'same' }
    }
    return oldItem ? { id, before: oldItem, kind: 'removed' } : { id, after: newItem, kind: 'added' }
  })
}

function ReadonlyTask({ state, assignment, kind }: { state: AppState; assignment?: Assignment; kind: Row['kind'] }) {
  if (!assignment) return <div className="diff-empty">—</div>
  const subject = subjectFor(state, assignment)
  const className = kind === 'added' ? 'diff-added' : kind === 'removed' ? 'diff-removed' : kind === 'modified' ? 'diff-modified' : ''
  return <div className={`diff-task ${className}`}>
    <div className="diff-task-main"><span className={`subject-dot subject-${subject}`}/><div><strong>{assignment.title}</strong><span>{subject} · {minutesText(assignment.estimatedMinutes)}</span></div></div>
    <div className="diff-task-meta">{kind === 'added' && <em>＋新增</em>}{kind === 'removed' && <em>－移除</em>}{kind === 'modified' && <em>≈ 变化</em>}{assignment.locked && <span><Lock size={12}/>锁定</span>}</div>
  </div>
}

export function HistoryDiffDialog({ entry, onClose }: { entry?: ReplanHistoryEntry; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string[]>([])
  const before = useMemo(() => parseState(entry?.snapshot), [entry?.snapshot])
  const after = useMemo(() => parseState(entry?.afterSnapshot), [entry?.afterSnapshot])
  const changedDates = useMemo(() => {
    if (!before || !after) return []
    const dates = new Set<string>([
      ...before.assignments.map(item => item.scheduledDate).filter(Boolean) as string[],
      ...after.assignments.map(item => item.scheduledDate).filter(Boolean) as string[],
      ...Object.keys(before.dayConfigs),
      ...Object.keys(after.dayConfigs)
    ])
    return [...dates].filter(date => {
      const tasksChanged = rowsFor(before, after, date).some(row => row.kind !== 'same')
      const oldDay = before.dayConfigs[date]
      const newDay = after.dayConfigs[date]
      const dayChanged = oldDay?.type !== newDay?.type || oldDay?.customMinutes !== newDay?.customMinutes
      return tasksChanged || dayChanged
    }).sort()
  }, [before, after])

  return <Modal open={Boolean(entry)} title={entry ? `${entry.label} · 历史差异` : '历史差异'} onClose={onClose} wide>
    {!before || !after ? <p className="muted-text">这条历史来自旧版本，只保存了重排前快照，无法展示完整前后对比。</p> : <>
      <div className="history-audit-summary">
        <span>策略：{entry?.audit?.strategy ?? '旧版未记录'}</span>
        <span>人工决策：{entry?.audit?.decisions.length ?? 0} 项</span>
        <span>日期类型调整：{entry?.audit?.dayTypes.length ?? 0} 天</span>
        <span>变化日期：{changedDates.length} 天</span>
      </div>
      <div className="history-diff-list">
        {changedDates.map(date => {
          const open = expanded.includes(date)
          const rows = rowsFor(before, after, date)
          return <section className="history-diff-date" key={date}>
            <header onClick={() => setExpanded(previous => open ? previous.filter(item => item !== date) : [...previous, date])}>
              <div><strong>{fmtDate(date)} · {fmtWeekday(date)}</strong>{before.dayConfigs[date]?.type !== after.dayConfigs[date]?.type && <small>{dayTypeLabel[before.dayConfigs[date]?.type ?? 'regular']} → {dayTypeLabel[after.dayConfigs[date]?.type ?? 'regular']}</small>}</div><span>{rows.filter(row => row.kind !== 'same').length} 项任务变化 {open ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}</span>
            </header>
            {open && <div className="day-diff-panel">
              <div className="day-diff-heading"><span>重排前</span><span>重排后</span></div>
              {rows.map(row => <article className={`day-diff-row diff-${row.kind}`} key={`${date}-${row.id}`}><div><ReadonlyTask state={before} assignment={row.before} kind={row.kind === 'removed' ? 'removed' : row.kind}/></div><div><ReadonlyTask state={after} assignment={row.after} kind={row.kind === 'added' ? 'added' : row.kind}/></div></article>)}
            </div>}
          </section>
        })}
      </div>
    </>}
  </Modal>
}
