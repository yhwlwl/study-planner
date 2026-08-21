import type {
  AppState,
  ConflictCategory,
  ConflictResolutionAction,
  ConflictResolutionDecision,
  ConstraintException,
  ConstraintExceptionResolutionDecision,
  PlanChangeEvent,
  ProposalIssue,
  SchedulingProposal,
} from '../types'
import { cloneActiveState, hydratePortableState } from './state'

export interface ConflictProfile {
  category: ConflictCategory
  label: string
  description: string
  allowedResolutions: ConflictResolutionAction[]
}

const waivableTypes = new Set<ProposalIssue['type']>([
  'capacity',
  'group-daily-max',
  'activity-daily-max',
  'long-task-max',
  'high-intensity-max',
  'date-protection',
])

const absoluteTypes = new Set<ProposalIssue['type']>(['active-timer', 'past-freeze'])

export function isTodayIncomingIssue(issue?: Pick<ProposalIssue, 'rawConstraintKey'>) {
  return issue?.rawConstraintKey === 'today-closed' || issue?.rawConstraintKey === 'today-extra'
}

// 纯“未安排/计划影响”类问题（type: 'unscheduled' 且无 rawConstraintKey）不是需要用户逐项决策的
// 硬冲突：应用后这些任务自然保持为未安排，与没有硬冲突时的体验一致（问题照常展示但不阻塞）。
// 只有带 rawConstraintKey 的真实硬约束冲突（容量、日期保护、目标、锁定、计时、今天接收规则等）
// 才要求逐项决定。
export function isBlockingDecisionIssue(issue: ProposalIssue): boolean {
  return issue.type !== 'unscheduled' || Boolean(issue.rawConstraintKey)
}

function normalizedTodayIncomingKey(rawKey: string) {
  return rawKey === 'today-closed' || rawKey === 'today-extra' ? 'today-extra' : rawKey
}

export function conflictProfile(issue: ProposalIssue): ConflictProfile {
  if (issue.conflictCategory && issue.allowedResolutions?.length) {
    const todayIncoming = isTodayIncomingIssue(issue)
    return {
      category: issue.conflictCategory,
      label: todayIncoming ? '今天接收规则' : categoryLabel(issue.conflictCategory),
      description: todayIncoming
        ? '只对当前列出的任务放宽“未来任务不自动进入今天”的规则，不修改永久设置。'
        : categoryDescription(issue.conflictCategory),
      allowedResolutions: issue.allowedResolutions,
    }
  }

  const raw = issue.rawConstraintKey ?? ''
  if (absoluteTypes.has(issue.type) || issue.title.includes('已完成任务')) {
    return {
      category: 'absolute-blocker',
      label: '不能直接豁免',
      description: '这类限制用于保护真实执行和历史记录，必须保留原状态或取消相关改动。',
      allowedResolutions: ['keep-original', 'cancel-change'],
    }
  }
  if (issue.type === 'task-lock') {
    return {
      category: 'protected-intent',
      label: '用户保护冲突',
      description: '任务锁定不能被系统静默绕过；可以保留原安排，或明确解除锁定后重新计算。',
      allowedResolutions: ['keep-original', 'unlock-and-move', 'cancel-change'],
    }
  }
  if (issue.type === 'date-protection') {
    return {
      category: 'protected-intent',
      label: '日期保护冲突',
      description: '可以只对本次方案授权使用该日期，也可以要求系统避开。',
      allowedResolutions: ['accept-once', 'system-find-another-date', 'keep-original'],
    }
  }
  if (issue.type === 'goal-risk' || raw === 'goal-latest') {
    return {
      category: 'structural-conflict',
      label: '目标或结构冲突',
      description: '不能只用一个勾选框忽略目标定义；可以继续寻找日期、保留未安排，或返回修改目标。',
      allowedResolutions: ['system-find-another-date', 'leave-unscheduled', 'change-goal', 'cancel-change'],
    }
  }
  if (raw === 'today-closed' || raw === 'today-extra') {
    return {
      category: 'waivable-rule',
      label: '今天接收规则',
      description: '只对当前列出的任务放宽“未来任务不自动进入今天”的规则，不修改永久设置。',
      allowedResolutions: ['accept-once', 'system-find-another-date', 'keep-original', 'change-capacity'],
    }
  }
  if (issue.type === 'unscheduled') {
    return {
      category: 'structural-conflict',
      label: '仍有任务未安排',
      description: '可以继续寻找合法日期，也可以明确保留为未安排任务。',
      allowedResolutions: ['system-find-another-date', 'leave-unscheduled', 'cancel-change'],
    }
  }
  if (raw === 'travel-day' || raw === 'buffer-high-intensity' || raw === 'buffer-long-task' || raw === 'plan-range') {
    return {
      category: 'structural-conflict',
      label: '需要改变日期或可用性',
      description: '这类冲突不能用普通上限例外安全绕过，应让系统换日、保留原安排或返回修改可用时间。',
      allowedResolutions: ['system-find-another-date', 'keep-original', 'change-capacity', 'cancel-change'],
    }
  }
  if (waivableTypes.has(issue.type)) {
    return {
      category: 'waivable-rule',
      label: '可一次性放宽',
      description: '可以只对本次方案按最小范围授权，也可以坚持原规则并让系统重新安排。',
      allowedResolutions: ['accept-once', 'system-find-another-date', 'leave-unscheduled'],
    }
  }
  return {
    category: 'warning',
    label: '需要确认的影响',
    description: '这项影响不会被静默忽略；可保留原安排或让系统重新寻找方案。',
    allowedResolutions: ['keep-original', 'system-find-another-date', 'cancel-change'],
  }
}

export function categoryLabel(category: ConflictCategory) {
  return category === 'absolute-blocker' ? '绝对阻断'
    : category === 'protected-intent' ? '用户保护'
      : category === 'waivable-rule' ? '可一次性例外'
        : category === 'structural-conflict' ? '目标或结构'
          : '提醒'
}

function categoryDescription(category: ConflictCategory) {
  return category === 'absolute-blocker' ? '保护执行历史，不能直接豁免。'
    : category === 'protected-intent' ? '必须由用户明确决定是否解除或本次授权。'
      : category === 'waivable-rule' ? '可逐项接受一次性例外，且不会修改永久规则。'
        : category === 'structural-conflict' ? '需要换日、留空或修改目标/容量。'
          : '可以继续，但应理解影响。'
}

export function resolutionLabel(action: ConflictResolutionAction, issue?: ProposalIssue) {
  if (isTodayIncomingIssue(issue)) {
    const todayLabels: Partial<Record<ConflictResolutionAction, string>> = {
      'accept-once': '允许这些任务今天加入',
      'system-find-another-date': '让系统为这些任务找其他日期',
      'keep-original': '保留这些任务原来的日期',
      'change-capacity': '调整今天的可用时间',
    }
    return todayLabels[action] ?? action
  }
  const labels: Record<ConflictResolutionAction, string> = {
    'accept-once': '接受本次例外',
    'system-find-another-date': '让系统仅为这些任务换日',
    'keep-original': '恢复这些任务原来的日期',
    'leave-unscheduled': '暂不安排这些任务',
    'unlock-and-move': '解除锁定后重新计算',
    'change-goal': '修改相关目标',
    'change-capacity': '修改相关日期的可用时间',
    'cancel-change': '放弃本次对这些任务的调整',
  }
  return labels[action]
}

export function exceptionFromIssue(issue: ProposalIssue): ConstraintException | undefined {
  const profile = conflictProfile(issue)
  const rawKey = normalizedTodayIncomingKey(issue.rawConstraintKey ?? rawKeyFromIssue(issue))
  const todayIncoming = rawKey === 'today-extra'
  const protectedDate = issue.type === 'date-protection' || rawKey === 'date-protection' || rawKey === 'protected-buffer' || rawKey === 'source-date-protection'
  if (profile.category !== 'waivable-rule' && !protectedDate) return undefined
  if (!issue.date) return undefined
  const current = numericValue(issue.currentValue)
  const allowed = numericValue(issue.allowedValue)
  if (!protectedDate && (current == null || allowed == null || current <= allowed)) return undefined
  return {
    date: issue.date,
    key: issue.type === 'group-daily-max' ? 'group-daily-max'
      : issue.type === 'activity-daily-max' ? 'activity-daily-max'
        : issue.type === 'long-task-max' ? 'long-task-max'
          : issue.type === 'high-intensity-max' ? 'high-intensity-max'
            : issue.type === 'date-protection' ? 'date-protection'
              : 'capacity',
    rawKey,
    label: todayIncoming
      ? `${issue.title}：仅本次允许列出的任务进入今天，不修改今天的默认设置`
      : protectedDate
      ? `${issue.title}：仅本次允许涉及任务使用该日期`
      : `${issue.title}：本次由 ${Math.round(allowed ?? 0)} 放宽到 ${Math.round(issue.suggestedLimit ?? current ?? 0)}`,
    permanent: false,
    currentLimit: protectedDate ? undefined : allowed,
    overrideLimit: protectedDate || todayIncoming ? undefined : issue.suggestedLimit ?? current,
    affectedAssignmentIds: [...issue.assignmentIds],
  }
}

function rawKeyFromIssue(issue: ProposalIssue) {
  if (issue.rawConstraintKey === 'today-closed' || issue.rawConstraintKey === 'today-extra') return 'today-extra'
  if (issue.type === 'group-daily-max' && issue.groupId) return `group:${issue.groupId}`
  if (issue.type === 'long-task-max') return 'long'
  if (issue.type === 'high-intensity-max') return 'high-intensity'
  if (issue.type === 'date-protection') return 'date-protection'
  return issue.type === 'capacity' ? 'capacity' : String(issue.type)
}

function numericValue(value?: string) {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * 合并同一日期、同一规则的最小授权。多个任务分别接受同一项例外时，
 * 只扩大到这些任务的并集；数值上限取用户明确接受的最大值。
 */
export function mergeConstraintExceptions(items: ConstraintException[]): ConstraintException[] {
  const merged = new Map<string, ConstraintException>()
  for (const item of items) {
    const key = `${item.date}:${item.rawKey ?? item.key}`
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, { ...item, affectedAssignmentIds: item.affectedAssignmentIds ? [...new Set(item.affectedAssignmentIds)] : undefined })
      continue
    }
    const affected = [...new Set([...(previous.affectedAssignmentIds ?? []), ...(item.affectedAssignmentIds ?? [])])]
    merged.set(key, {
      ...previous,
      ...item,
      currentLimit: previous.currentLimit == null ? item.currentLimit
        : item.currentLimit == null ? previous.currentLimit
          : Math.min(previous.currentLimit, item.currentLimit),
      overrideLimit: previous.overrideLimit == null ? item.overrideLimit
        : item.overrideLimit == null ? previous.overrideLimit
          : Math.max(previous.overrideLimit, item.overrideLimit),
      affectedAssignmentIds: affected.length ? affected : undefined,
    })
  }
  return [...merged.values()]
}

function affectedIdsForException(proposal: SchedulingProposal, exception: ConstraintException) {
  if (exception.affectedAssignmentIds?.length) return [...new Set(exception.affectedAssignmentIds)]
  const raw = exception.rawKey ?? exception.key
  const fromSource = raw === 'source-date-protection'
  const movementIds = proposal.movements
    .filter(move => fromSource ? move.fromDate === exception.date : move.toDate === exception.date)
    .map(move => move.assignmentId)
  if (movementIds.length) return [...new Set(movementIds)]
  return proposal.stateAfter.assignments
    .filter(item => item.scheduledDate === exception.date && item.status !== 'done')
    .map(item => item.id)
}

export interface ConflictDecisionApplication {
  preparedState: AppState
  event: PlanChangeEvent
  acceptedExceptions: ConstraintException[]
  externalAction?: 'change-goal' | 'change-capacity'
}

/**
 * 把逐项决定转换为新的计算输入。这里不直接提交计划：所有决定都会回到调度器，
 * 再生成一轮完整预览。合法项通过 fixedAssignmentIds 保持固定。
 */
export function applyConflictDecisions(
  baseline: AppState,
  _prepared: AppState,
  proposal: SchedulingProposal,
  event: PlanChangeEvent,
  decisions: ConflictResolutionDecision[],
  exceptionDecisions: ConstraintExceptionResolutionDecision[] = [],
): ConflictDecisionApplication {
  // 从用户当前选中的候选继续，而不是退回候选生成前的草稿。
  // 这样被用户认可的合法移动和逐项微调会保留；被拒绝的例外任务才重新释放。
  const next = cloneActiveState(hydratePortableState(proposal.stateAfter))
  const baselineById = new Map(baseline.assignments.map(item => [item.id, item]))
  const issueById = new Map(proposal.issues.map(item => [item.id, item]))
  const acceptedExceptions: ConstraintException[] = []
  const fixedIds = new Set<string>(Array.isArray(event.metadata?.fixedAssignmentIds) ? event.metadata?.fixedAssignmentIds.filter((item): item is string => typeof item === 'string') : [])
  const leaveUnscheduledIds = new Set<string>()
  let externalAction: ConflictDecisionApplication['externalAction']
  const releaseRequestedIds = new Set<string>([
    ...decisions.filter(item => item.action === 'system-find-another-date' || item.action === 'leave-unscheduled').flatMap(item => issueById.get(item.issueId)?.assignmentIds ?? []),
    ...exceptionDecisions.filter(item => item.action === 'system-find-another-date').flatMap(item => affectedIdsForException(proposal, item.exception)),
  ])

  const releaseForRecalculation = (assignmentId: string) => {
    const item = next.assignments.find(candidate => candidate.id === assignmentId)
    if (!item || item.status === 'done' || baseline.timer.assignmentId === assignmentId) return
    item.previousDate = item.scheduledDate
    item.scheduledDate = undefined
    item.locked = false
    item.intentStrength = 'normal'
    item.scheduleSource = 'system'
    item.updatedAt = new Date().toISOString()
    fixedIds.delete(assignmentId)
  }

  for (const exceptionDecision of exceptionDecisions) {
    const scopedException = {
      ...exceptionDecision.exception,
      affectedAssignmentIds: affectedIdsForException(proposal, exceptionDecision.exception),
    }
    if (exceptionDecision.action === 'accept-once') {
      acceptedExceptions.push(scopedException)
      for (const assignmentId of scopedException.affectedAssignmentIds ?? []) if (!releaseRequestedIds.has(assignmentId)) fixedIds.add(assignmentId)
    } else {
      for (const assignmentId of scopedException.affectedAssignmentIds ?? []) releaseForRecalculation(assignmentId)
    }
  }

  for (const decision of decisions) {
    const issue = issueById.get(decision.issueId)
    if (!issue) continue
    if (decision.action === 'accept-once') {
      const exception = exceptionFromIssue(issue)
      if (exception) {
        acceptedExceptions.push(exception)
        for (const assignmentId of exception.affectedAssignmentIds ?? []) if (!releaseRequestedIds.has(assignmentId)) fixedIds.add(assignmentId)
      }
      continue
    }
    if (decision.action === 'change-goal') { externalAction = 'change-goal'; continue }
    if (decision.action === 'change-capacity') { externalAction = 'change-capacity'; continue }

    for (const assignmentId of issue.assignmentIds) {
      const item = next.assignments.find(candidate => candidate.id === assignmentId)
      const original = baselineById.get(assignmentId)
      if (!item) continue
      if (decision.action === 'keep-original' || decision.action === 'cancel-change') {
        if (original) {
          item.scheduledDate = original.scheduledDate
          item.previousDate = original.previousDate
          item.locked = original.locked
          item.intentStrength = original.intentStrength
          item.scheduleSource = original.scheduleSource
          item.lastManualMoveAt = original.lastManualMoveAt
          item.updatedAt = new Date().toISOString()
        }
        fixedIds.add(assignmentId)
      } else if (decision.action === 'system-find-another-date') {
        releaseForRecalculation(assignmentId)
      } else if (decision.action === 'leave-unscheduled') {
        if (item.status !== 'done' && baseline.timer.assignmentId !== assignmentId) {
          item.previousDate = item.scheduledDate
          item.scheduledDate = undefined
          item.locked = false
          item.intentStrength = 'normal'
          item.scheduleSource = 'system'
          item.updatedAt = new Date().toISOString()
          fixedIds.add(assignmentId)
          leaveUnscheduledIds.add(assignmentId)
        }
      } else if (decision.action === 'unlock-and-move') {
        item.locked = false
        item.intentStrength = 'normal'
        item.scheduleSource = 'system'
        item.updatedAt = new Date().toISOString()
        fixedIds.delete(assignmentId)
      }
    }
  }

  const mergedAcceptedExceptions = mergeConstraintExceptions(acceptedExceptions)
  const exceptionAssignmentIds = exceptionDecisions.flatMap(item => affectedIdsForException(proposal, item.exception))
  const nextEvent: PlanChangeEvent = {
    ...event,
    affectedAssignmentIds: Array.from(new Set([
      ...event.affectedAssignmentIds,
      ...proposal.movements.map(item => item.assignmentId),
      ...proposal.issues.flatMap(issue => issue.assignmentIds),
      ...exceptionAssignmentIds,
    ])),
    metadata: {
      ...(event.metadata ?? {}),
      fixedAssignmentIds: [...fixedIds],
      leaveUnscheduledIds: [...leaveUnscheduledIds],
      conflictDecisionCount: decisions.length,
      acceptedExceptionCount: mergedAcceptedExceptions.length,
      conflictDecisionRevision: Number(event.metadata?.conflictDecisionRevision ?? 0) + 1,
    },
  }
  next.changeEvents = Array.from(new Map([...next.changeEvents, nextEvent].map(item => [item.id, item])).values()).slice(-100)
  next.updatedAt = new Date().toISOString()
  return { preparedState: next, event: nextEvent, acceptedExceptions: mergedAcceptedExceptions, externalAction }
}
