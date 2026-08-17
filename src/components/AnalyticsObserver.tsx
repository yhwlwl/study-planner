import { useEffect, useRef } from 'react'
import { useApp } from '../AppContext'
import { recordAnalyticsEvent, recordAnalyticsEventOnce, recordAppPageView } from '../lib/analytics'
import { isTutorialNamespace } from '../lib/tutorial'
import type { AppState } from '../types'

type StateSnapshot = {
  namespace: string
  intakeBatchIds: Set<string>
  scheduledCount: number
  assignmentStatus: Map<string, AppState['assignments'][number]['status']>
  assignmentDates: Map<string, string | undefined>
  reviewFingerprints: Set<string>
  changeEventIds: Set<string>
  acceptedExceptionCount: number
}

function snapshot(namespace: string, state: AppState): StateSnapshot {
  return {
    namespace,
    intakeBatchIds: new Set(state.intakeBatches.map(item => item.id)),
    scheduledCount: state.assignments.filter(item => Boolean(item.scheduledDate)).length,
    assignmentStatus: new Map(state.assignments.map(item => [item.id, item.status])),
    assignmentDates: new Map(state.assignments.map(item => [item.id, item.scheduledDate])),
    reviewFingerprints: new Set(state.reviewRecords.map(item => JSON.stringify(item))),
    changeEventIds: new Set(state.changeEvents.map(item => item.id)),
    acceptedExceptionCount: state.acceptedConstraintExceptions.length,
  }
}

const PAGE_BY_HEADING: Record<string, string> = {
  今日: 'today',
  月历: 'calendar',
  任务: 'tasks',
  录入: 'intake',
  目标: 'goals',
  统计: 'stats',
  导出: 'export',
  使用教程: 'guide',
  设置: 'settings',
}

/**
 * 把分析接入点与大型 App/AppContext 文件解耦，降低功能分支未来 cherry-pick/rebase 的冲突面。
 * 这里只观察已经发生的实时状态转换；首次挂载和 namespace 切换都只建立基线，不回填历史事件。
 */
export function AnalyticsObserver() {
  const { state, namespace, ready } = useApp()
  const previousRef = useRef<StateSnapshot>()

  useEffect(() => {
    if (!ready || isTutorialNamespace(namespace)) { previousRef.current = undefined; return }
    const current = snapshot(namespace, state)
    const previous = previousRef.current
    previousRef.current = current
    if (!previous || previous.namespace !== namespace) return

    const newIntakeBatchCount = [...current.intakeBatchIds].filter(id => !previous.intakeBatchIds.has(id)).length
    if (newIntakeBatchCount > 0) {
      void recordAnalyticsEventOnce('intake_started', { metadata: { newBatchCount: newIntakeBatchCount } })
    }

    if (previous.scheduledCount === 0 && current.scheduledCount > 0) {
      void recordAnalyticsEventOnce('first_plan_applied', { metadata: { scheduledTaskCount: current.scheduledCount } })
    }

    const newlyCompleted = [...current.assignmentStatus].filter(([id, status]) => status === 'done' && previous.assignmentStatus.get(id) !== 'done')
    if (newlyCompleted.length > 0) {
      void recordAnalyticsEventOnce('first_task_completed', { metadata: { completedInTransition: newlyCompleted.length } })
    }

    const newReviews = [...current.reviewFingerprints].filter(fingerprint => !previous.reviewFingerprints.has(fingerprint))
    if (newReviews.length > 0) {
      void recordAnalyticsEvent('review_completed', { metadata: { reviewCount: newReviews.length } })
    }

    const newRepairEvents = state.changeEvents.filter(event => !previous.changeEventIds.has(event.id) && event.action === 'repair' && event.type !== 'restore')
    if (newRepairEvents.length > 0) {
      const movedTaskCount = [...current.assignmentDates].filter(([id, date]) => previous.assignmentDates.has(id) && previous.assignmentDates.get(id) !== date).length
      const acceptedExceptionCount = Math.max(0, current.acceptedExceptionCount - previous.acceptedExceptionCount)
      if (movedTaskCount > 0 || acceptedExceptionCount > 0) {
        for (const event of newRepairEvents) {
          void recordAnalyticsEvent('schedule_repair_applied', {
            metadata: { eventType: event.type, movedTaskCount, acceptedExceptionCount, changeEventId: event.id },
          })
        }
      }
    }
  }, [namespace, ready, state])

  useEffect(() => {
    let lastPage = ''
    let parsePending = false
    let parseResetTimer: number | undefined
    let scanFrame: number | undefined

    const scanPage = () => {
      if (isTutorialNamespace(namespace)) return
      scanFrame = undefined
      const timerPage = document.querySelector('.focus-timer-page')
      const heading = document.querySelector('.page-heading h1')?.textContent?.trim() ?? ''
      const page = timerPage ? 'timer' : PAGE_BY_HEADING[heading]
      if (page && page !== lastPage) {
        lastPage = page
        void recordAppPageView(page)
      }

      if (parsePending && document.querySelector('.intake-import-preview')) {
        parsePending = false
        if (parseResetTimer) window.clearTimeout(parseResetTimer)
        parseResetTimer = undefined
        void recordAnalyticsEvent('natural_language_parsed')
      }
    }

    const scheduleScan = () => {
      if (scanFrame !== undefined) return
      scanFrame = window.requestAnimationFrame(scanPage)
    }

    const onClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest('button')
      if (!button || button.textContent?.trim() !== '解析并预览') return
      parsePending = true
      if (parseResetTimer) window.clearTimeout(parseResetTimer)
      parseResetTimer = window.setTimeout(() => { parsePending = false; parseResetTimer = undefined }, 10_000)
      scheduleScan()
    }

    const observer = new MutationObserver(scheduleScan)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    document.addEventListener('click', onClick, true)
    scheduleScan()

    return () => {
      observer.disconnect()
      document.removeEventListener('click', onClick, true)
      if (scanFrame !== undefined) window.cancelAnimationFrame(scanFrame)
      if (parseResetTimer) window.clearTimeout(parseResetTimer)
    }
  }, [namespace])

  return null
}
