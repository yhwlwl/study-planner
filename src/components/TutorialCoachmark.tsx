import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, RotateCcw, X } from 'lucide-react'
import type { TutorialStep } from '../lib/tutorial'
import '../tutorial-polish.css'

export interface TutorialCoachmarkConfig {
  target?: string
  text: string
  eyebrow?: string
  headline?: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}

const tutorialCopyOverrides: Partial<Record<TutorialStep, string>> = {
  'repair-entry': '当前计划有 3 个问题：今天超载、任务逾期、目标有无法完成风险。点“3 个问题需处理”，打开重排中心，查看这 3 个问题分别影响了什么。',
  'repair-action': '点“修复当前问题”，系统会只针对这些已经发生的问题计算修复方案；已完成和锁定任务不会被移动。',
  'repair-calendar': '高亮日期就是刚才实际改动的位置。已完成和锁定内容没有被打乱。',
  'goal-existing': '点“查看”，打开目标详情，查看截止日期、当前进度、预计完成和关联任务；看完点“关闭”，教程会继续到录入。',
  'intake-entry': '点“自然语言 / 粘贴清单”，打开自然语言录入框，教程示例文本会自动填入。',
  'intake-source': '点“解析并预览”，系统会把文本拆成可检查的任务、数量、时长和期限。',
  'intake-parse': '确认识别结果后，点“加入当前批次”，这些任务会进入待排期区，但还不会进入日历。',
  'intake-schedule': '点“生成排期预览”，系统会根据容量、期限和现有计划计算安排；此时仍不会修改日历。',
  'intake-preview': '点“应用预览中的改动”，确认后新任务才会进入正式计划，并自动打开月历展示落点。',
  'intake-calendar': '新任务已经进入正式计划。高亮日期就是这次新增或调整的位置。',
  'execute-complete': '点高亮任务并选择“完成”，记录 52 分钟实际用时；保存后这次执行会进入复盘和统计。',
  'execute-partial': '点第二个高亮任务并选择“部分完成”，记录 12 分钟、50%；保存后复盘会把它识别为部分完成。',
  'review-entry': '点“结束今天并复盘”，打开今天的真实执行汇总，查看完成、部分完成和未完成任务。',
  'review-carry': '选好顺延日期后，点“完成复盘，并按当前方案顺延”，系统会生成顺延预览，不会直接移动任务。',
  'review-preview': '点“应用预览中的改动”，未完成任务会按预览顺延，并自动打开月历展示新日期。',
  'review-calendar': '未完成任务已经接到后面的日期，今天的执行记录仍然保留。',
  stats: '点“查看连续记录和学习热力图”，展开实际学习时间、连续记录和近期趋势。',
  'stats-detail': '这里记录的是实际执行结果：学了多久、完成多少、计划和实际差多少。',
  'future-entry': '点“计划有变化”，重新打开重排中心；这次不是修复故障，而是主动调整未来节奏。',
  'future-action': '选择一个偏好后，点“生成重新安排预览”，系统会按这个取舍重新计算未来任务；当前计划不会立刻改变。',
  'future-preview': '点“应用预览中的改动”，确认后未来安排才会生效，并自动打开月历展示结果。',
  'future-calendar': '主动重排已经生效。这次不是救火，而是主动重新规划后面的节奏。',
  complete: '你已经走完：发现问题 → 修复 → 录入 → 排期 → 执行 → 复盘 → 再调整。',
}

function proposalMovesTarget() {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('.proposal-summary-grid button'))
  return buttons.find(element => element.textContent?.includes('移动任务') && element.getBoundingClientRect().width > 0)
}

function findTarget(target?: string) {
  if (!target) return undefined
  for (const name of target.split('|').map(item => item.trim()).filter(Boolean)) {
    if (name === 'proposal-moves') {
      const proposalTarget = proposalMovesTarget()
      if (proposalTarget) return proposalTarget
      continue
    }
    const matches = Array.from(document.querySelectorAll<HTMLElement>(`[data-tutorial-target="${name}"]`))
    const visible = matches.find(element => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    if (visible) return visible
  }
  return undefined
}

function isProposalMovesTarget(element?: HTMLElement) {
  return Boolean(element?.closest('.proposal-summary-grid') && element.textContent?.includes('移动任务'))
}

function renderEmphasized(text: string): ReactNode[] {
  return text.split(/([“”「」][^“”「」]+[“”「」])/g).filter(Boolean).map((part, index) => {
    if (/^[“「].+[”」]$/.test(part)) return <strong className="tutorial-inline-emphasis" key={`${part}-${index}`}>{part}</strong>
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

function visibleViewport() {
  const viewport = window.visualViewport
  return {
    top: viewport?.offsetTop ?? 0,
    height: viewport?.height ?? window.innerHeight,
  }
}

type PortalPlacement = {
  targetKey: string
  host: HTMLElement
}

export function TutorialCoachmark({ step, config, onRestart, onExit }: {
  step: TutorialStep
  config?: TutorialCoachmarkConfig
  onRestart: () => void
  onExit: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [portalPlacement, setPortalPlacement] = useState<PortalPlacement | null>(null)
  const [repairMovesInspected, setRepairMovesInspected] = useState(false)

  useEffect(() => {
    setCollapsed(false)
    setRepairMovesInspected(false)
  }, [step])

  const effectiveConfig = useMemo(() => {
    if (!config) return undefined
    if (step === 'repair-preview') {
      return {
        ...config,
        target: repairMovesInspected ? 'proposal-primary' : 'proposal-moves|proposal-primary',
        text: repairMovesInspected
          ? '任务变化已经展开。点“应用预览中的改动”，确认后系统才会修改计划，并自动打开月历展示结果。'
          : '先看哪些任务会移动。点“移动任务”，展开每项任务调整前后的日期和移动原因。',
      }
    }
    return { ...config, text: tutorialCopyOverrides[step] ?? config.text }
  }, [config, repairMovesInspected, step])

  useEffect(() => {
    let target: HTMLElement | undefined
    let cancelled = false
    let removeInteractionListener: (() => void) | undefined
    let mutationObserver: MutationObserver | undefined
    let locateFrame: number | undefined
    const timers: number[] = []
    const targetKey = effectiveConfig?.target ?? ''

    if (!targetKey) setPortalPlacement(null)

    const locate = () => {
      if (cancelled) return
      const found = findTarget(effectiveConfig?.target)
      if (!found) {
        target?.classList.remove('tutorial-highlight')
        target = undefined
        removeInteractionListener?.()
        removeInteractionListener = undefined
        setPortalPlacement(current => current?.targetKey === targetKey ? null : current)
        return
      }
      if (target && target !== found) target.classList.remove('tutorial-highlight')
      target = found
      if (!collapsed) found.classList.add('tutorial-highlight')

      removeInteractionListener?.()
      removeInteractionListener = undefined
      if (step === 'repair-preview' && !repairMovesInspected && isProposalMovesTarget(found)) {
        const handleInspect = () => setRepairMovesInspected(true)
        found.addEventListener('click', handleInspect, { once: true })
        removeInteractionListener = () => found.removeEventListener('click', handleInspect)
      }

      const modalCard = found.closest<HTMLElement>('.modal-card')
      const modalSlot = modalCard?.querySelector<HTMLElement>('.tutorial-modal-coachmark-slot') ?? null
      setPortalPlacement(current => {
        if (!modalSlot || !modalSlot.isConnected) return current?.targetKey === targetKey ? null : current
        if (current?.targetKey === targetKey && current.host === modalSlot) return current
        return { targetKey, host: modalSlot }
      })

      if (collapsed) return
      const rect = found.getBoundingClientRect()
      const viewport = visibleViewport()
      const safeTop = viewport.top + 72
      const safeBottom = viewport.top + viewport.height - 24
      if (rect.top < safeTop || rect.bottom > safeBottom) {
        found.scrollIntoView({ behavior: 'smooth', block: modalCard ? 'nearest' : 'center', inline: 'nearest' })
      }
    }

    const scheduleLocate = () => {
      if (cancelled) return
      if (locateFrame !== undefined) window.cancelAnimationFrame(locateFrame)
      locateFrame = window.requestAnimationFrame(() => {
        locateFrame = undefined
        locate()
      })
    }

    locate()
    for (const delay of [80, 220, 520, 900]) timers.push(window.setTimeout(locate, delay))

    // 同一个教程步骤里也可能打开/关闭真实业务弹窗。目标节点因此会在不切换 step 的情况下
    // 从页面按钮变成弹窗字段。持续观察 DOM，让高亮和提示自动跟随当前实际可操作控件。
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(scheduleLocate)
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-tutorial-target', 'hidden', 'aria-hidden', 'open'],
      })
    }
    window.addEventListener('resize', scheduleLocate)
    window.visualViewport?.addEventListener('resize', scheduleLocate)

    return () => {
      cancelled = true
      timers.forEach(window.clearTimeout)
      if (locateFrame !== undefined) window.cancelAnimationFrame(locateFrame)
      mutationObserver?.disconnect()
      window.removeEventListener('resize', scheduleLocate)
      window.visualViewport?.removeEventListener('resize', scheduleLocate)
      removeInteractionListener?.()
      target?.classList.remove('tutorial-highlight')
    }
  }, [step, effectiveConfig?.target, collapsed, repairMovesInspected])

  if (!effectiveConfig) return null

  const content = collapsed ? (
    <div className="tutorial-coachmark-collapsed">
      <button className="primary-button" onClick={() => setCollapsed(false)}>重新打开提示</button>
      <button className="text-button" onClick={onExit}>退出教程</button>
    </div>
  ) : (
    <div className="tutorial-coachmark" role="status" aria-live="polite">
      <div className="tutorial-coachmark-head">
        <span>{effectiveConfig.eyebrow ?? '互动教程'}</span>
        <div>
          <button className="tutorial-icon-button" onClick={onRestart} title="从头开始" aria-label="从头开始"><RotateCcw size={14}/></button>
          <button className="tutorial-icon-button" onClick={() => setCollapsed(true)} title="收起提示" aria-label="收起提示"><X size={15}/></button>
        </div>
      </div>
      <div className="tutorial-coachmark-copy">
        {effectiveConfig.headline && <strong className="tutorial-coachmark-title">{effectiveConfig.headline}</strong>}
        <p>{renderEmphasized(effectiveConfig.text)}</p>
      </div>
      {(effectiveConfig.secondaryLabel || effectiveConfig.actionLabel) && <div className="tutorial-coachmark-actions">
        {effectiveConfig.secondaryLabel && <button className="secondary-button" onClick={effectiveConfig.onSecondary}>{effectiveConfig.secondaryLabel}</button>}
        {effectiveConfig.actionLabel && <button className="primary-button" onClick={effectiveConfig.onAction}>{effectiveConfig.actionLabel}</button>}
      </div>}
      <div className="tutorial-coachmark-footer">
        <button className="tutorial-exit-button" onClick={onExit}><LogOut size={13}/>退出教程</button>
      </div>
    </div>
  )

  const activePortalHost = portalPlacement
    && portalPlacement.targetKey === (effectiveConfig.target ?? '')
    && portalPlacement.host.isConnected
      ? portalPlacement.host
      : null

  return activePortalHost ? createPortal(content, activePortalHost) : content
}
