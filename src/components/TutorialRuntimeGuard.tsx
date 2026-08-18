import { useEffect, useRef } from 'react'
import { useApp } from '../AppContext'
import type { AppState } from '../types'
import {
  TUTORIAL_INTAKE_BATCH_ID,
  TUTORIAL_NAMESPACE,
  TUTORIAL_NEW_GOAL_ID,
  TUTORIAL_NEW_GOAL_TITLE,
  readTutorialSession,
  type TutorialStep,
} from '../lib/tutorial'

const GOAL_LINK_REPAIR_STEPS: TutorialStep[] = ['intake-schedule', 'intake-preview']

/**
 * 教程最后一次“加入目标”保存与教程 step 前进发生在同一个 React 事件中。
 * React 的 state updater 可能在 step 已经前进后才真正执行，此时教程写保护会拒绝
 * 那次仍标记为 tutorial-goal-link 的 mutation。这里仅在教程已经明确进入排期阶段时，
 * 把预置录入批次恢复为该阶段唯一合法的目标关联状态。
 */
export function repairTutorialGoalLinkRace(state: AppState, step?: TutorialStep): AppState | undefined {
  if (!step || !GOAL_LINK_REPAIR_STEPS.includes(step)) return undefined
  const batch = state.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)
  if (!batch) return undefined
  const pendingGroups = batch.taskGroups.filter(item => !item.appliedAt && item.kind !== 'single')
  if (!pendingGroups.length) return undefined

  const alreadyCanonical = pendingGroups.every(item => item.goalIds.length === 1 && item.goalIds[0] === TUTORIAL_NEW_GOAL_ID)
  if (alreadyCanonical) return undefined

  const next = structuredClone(state) as AppState
  const nextBatch = next.intakeBatches.find(item => item.id === TUTORIAL_INTAKE_BATCH_ID)
  if (!nextBatch) return undefined
  const now = new Date().toISOString()
  nextBatch.taskGroups = nextBatch.taskGroups.map(item => item.appliedAt || item.kind === 'single'
    ? item
    : { ...item, goalIds: [TUTORIAL_NEW_GOAL_ID], updatedAt: now })
  nextBatch.updatedAt = now
  next.updatedAt = now
  return next
}

function restoreGoalOptions() {
  document.querySelectorAll<HTMLElement>('[data-tutorial-goal-option-guard="1"]').forEach(label => {
    label.hidden = false
    label.removeAttribute('data-tutorial-goal-option-guard')
    const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (input) input.disabled = false
  })
  document.querySelectorAll('.tutorial-goal-only-note').forEach(node => node.remove())
}

function enforceOnlyTutorialGoal() {
  const session = readTutorialSession()
  if (session?.step !== 'goal-link') {
    restoreGoalOptions()
    return
  }

  const fields = document.querySelectorAll<HTMLElement>('[data-tutorial-target="tutorial-goal-link-field"]')
  fields.forEach(field => {
    const labels = Array.from(field.querySelectorAll<HTMLLabelElement>('label'))
    labels.forEach(label => {
      const allowed = label.textContent?.includes(TUTORIAL_NEW_GOAL_TITLE) === true
      if (allowed) return
      label.hidden = true
      label.dataset.tutorialGoalOptionGuard = '1'
      const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]')
      if (input) input.disabled = true
    })

    if (!field.querySelector('.tutorial-goal-only-note')) {
      const note = document.createElement('small')
      note.className = 'tutorial-goal-only-note'
      note.textContent = `教程中只需要关联刚创建的“${TUTORIAL_NEW_GOAL_TITLE}”目标。`
      const legend = field.querySelector('legend')
      if (legend?.nextSibling) field.insertBefore(note, legend.nextSibling)
      else field.appendChild(note)
    }
  })
}

type PendingScheduleRetry = {
  button: HTMLButtonElement
  wasDisabled: boolean
}

export function TutorialRuntimeGuard() {
  const { state, namespace, setDataSpace } = useApp()
  const stateRef = useRef(state)
  const repairInFlight = useRef(false)
  const pendingScheduleRetry = useRef<PendingScheduleRetry>()
  stateRef.current = state

  const ensureGoalLinkReady = () => {
    if (namespace !== TUTORIAL_NAMESPACE || repairInFlight.current) return
    const session = readTutorialSession()
    const repaired = repairTutorialGoalLinkRace(stateRef.current, session?.step)
    if (!repaired) return

    repairInFlight.current = true
    void setDataSpace(TUTORIAL_NAMESPACE, repaired, false)
      .finally(() => { repairInFlight.current = false })
  }

  useEffect(() => {
    ensureGoalLinkReady()
  }, [namespace, setDataSpace, state])

  useEffect(() => {
    if (namespace !== TUTORIAL_NAMESPACE) return

    // 不能只在 step 变化后“尽快修复”：用户仍可能在修复写入 React state 前点到
    // “生成排期预览”，从旧 state 生成一个永久缺少正式目标关联的 proposal。
    // 因此在 capture 阶段拦截这一次点击；修复真正进入 React state 后再自动重放。
    const guardScheduleClick = (event: MouseEvent) => {
      const source = event.target
      if (!(source instanceof Element)) return
      const button = source.closest<HTMLButtonElement>('[data-tutorial-action="schedule-intake"]')
      if (!button) return
      const session = readTutorialSession()
      if (session?.step !== 'intake-schedule') return
      const repaired = repairTutorialGoalLinkRace(stateRef.current, session.step)
      if (!repaired) return

      event.preventDefault()
      event.stopPropagation()
      if (!pendingScheduleRetry.current) {
        pendingScheduleRetry.current = { button, wasDisabled: button.disabled }
        button.disabled = true
        button.setAttribute('aria-busy', 'true')
        button.title = '正在同步刚才的目标关联…'
      }
      if (repairInFlight.current) return
      repairInFlight.current = true
      void setDataSpace(TUTORIAL_NAMESPACE, repaired, false)
        .finally(() => { repairInFlight.current = false })
    }

    document.addEventListener('click', guardScheduleClick, true)
    return () => document.removeEventListener('click', guardScheduleClick, true)
  }, [namespace, setDataSpace])

  useEffect(() => {
    const pending = pendingScheduleRetry.current
    if (!pending || namespace !== TUTORIAL_NAMESPACE) return
    const session = readTutorialSession()
    if (session?.step !== 'intake-schedule') return
    // 只有当 Context 已经重新渲染出 canonical state，才允许重放用户刚才的点击。
    // 这样 prepareIntakeBatch 读取到的一定是已经带目标关联的新 state。
    if (repairTutorialGoalLinkRace(state, session.step)) return

    pendingScheduleRetry.current = undefined
    pending.button.disabled = pending.wasDisabled
    pending.button.removeAttribute('aria-busy')
    pending.button.removeAttribute('title')
    const frame = window.requestAnimationFrame(() => {
      if (pending.button.isConnected) pending.button.click()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [namespace, state])

  useEffect(() => {
    if (namespace !== TUTORIAL_NAMESPACE) {
      restoreGoalOptions()
      return
    }

    let frame: number | undefined
    const schedule = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = undefined
        enforceOnlyTutorialGoal()
        ensureGoalLinkReady()
      })
    }

    schedule()
    // 不使用 MutationObserver / 轮询，只在真实交互和 React 状态变化后检查。
    document.addEventListener('click', schedule, true)
    document.addEventListener('focusin', schedule, true)
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      document.removeEventListener('click', schedule, true)
      document.removeEventListener('focusin', schedule, true)
      restoreGoalOptions()
    }
  }, [namespace, state.updatedAt])

  return null
}
