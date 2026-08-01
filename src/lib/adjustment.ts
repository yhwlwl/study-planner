import type { PlanAdjustmentPolicy, PlanChangeEvent, SchedulingPreference } from '../types'

const allPreferences: SchedulingPreference[] = ['preserve', 'balanced', 'goal', 'rest']

function alternatives(primary: SchedulingPreference, preferred?: unknown, ordered: SchedulingPreference[] = []): SchedulingPreference[] {
  const metadata = Array.isArray(preferred)
    ? preferred.filter((item): item is SchedulingPreference => allPreferences.includes(item as SchedulingPreference))
    : []
  return Array.from(new Set([...ordered, ...metadata, ...allPreferences])).filter(item => item !== primary)
}

/**
 * 场景协调策略：先判断用户意图是否已经完整，再决定是精确校验、推荐预览还是探索式优化。
 * 底层仍只保留一套调度引擎；这里负责避免所有业务变化都被粗暴送进“四方案重排”。
 */
export function adjustmentPolicyForEvent(event: PlanChangeEvent): PlanAdjustmentPolicy {
  const metadata = event.metadata ?? {}
  const preferred = metadata.preferredPreferences
  const direct = (label: string, explanation: string, primary: SchedulingPreference = 'preserve'): PlanAdjustmentPolicy => ({
    mode: 'validate-and-commit', primaryPreference: primary,
    alternativePreferences: alternatives(primary, preferred), allowKeepPrepared: true,
    directPreviewLabel: label, explanation,
  })
  const recommended = (label: string, explanation: string, primary: SchedulingPreference = 'preserve'): PlanAdjustmentPolicy => ({
    mode: 'recommended-preview', primaryPreference: primary,
    alternativePreferences: alternatives(primary, preferred), allowKeepPrepared: false,
    directPreviewLabel: label, explanation,
  })
  const optional = (label: string, explanation: string, primary: SchedulingPreference = 'preserve', ordered: SchedulingPreference[] = []): PlanAdjustmentPolicy => ({
    mode: 'optional-optimization', primaryPreference: primary,
    alternativePreferences: alternatives(primary, preferred, ordered), allowKeepPrepared: true,
    directPreviewLabel: label, explanation,
  })
  const exploratory = (label: string, explanation: string, primary: SchedulingPreference, ordered: SchedulingPreference[] = []): PlanAdjustmentPolicy => ({
    mode: 'exploratory-optimization', primaryPreference: primary,
    alternativePreferences: alternatives(primary, preferred, ordered), allowKeepPrepared: false,
    directPreviewLabel: label, explanation,
  })

  if (event.type === 'execution-difference' && metadata.requestedCarryDates) {
    return direct('按你在复盘中的选择执行', '先逐项校验用户已经选定的日期；合法项不会再交给系统重新决定。')
  }
  if (event.type === 'bulk-move') {
    return direct('按你指定的批量移动执行', '先校验用户指定的目标日期；只有冲突项才需要系统提供替代方案。')
  }
  if (event.type === 'rule-change' && metadata.currentEstimate != null) {
    return direct('更新预计时长并保持日期', '先检查新预计是否让现有日期产生硬冲突；没有冲突时不重排。')
  }
  if (event.type === 'goal-relaxation' || event.type === 'goal-deletion') {
    return optional('保存目标变化并保持当前排期', '约束已经放宽，默认不把任务推迟；用户可主动比较减负或重新分配方案。', 'preserve', ['rest', 'balanced', 'goal'])
  }
  if (event.type === 'availability-change' && metadata.pureRelaxation === true) {
    return optional('保存新的可用时间并保持当前排期', '新增容量不会自动把任务提前；用户可主动利用空间减轻未来负载。', 'preserve', ['rest', 'balanced', 'goal'])
  }
  if (event.type === 'load-preference-change') {
    const primary = (metadata.preferredPreference as SchedulingPreference | undefined) ?? 'rest'
    return exploratory('生成减负推荐', '用户表达的是体验目标，系统先按所选减负结果生成推荐，再提供其他取舍。', primary, primary === 'rest' ? ['balanced', 'preserve', 'goal'] : ['rest', 'preserve', 'goal'])
  }
  if (event.type === 'future-replanning') {
    const primary = (metadata.preferredPreference as SchedulingPreference | undefined) ?? 'balanced'
    return exploratory('重新组织剩余计划', '这是主动的未来优化，先给一个推荐结果，再允许比较其他实质不同方案。', primary)
  }
  if (event.type === 'new-task-insertion' || event.type === 'task-group-size-increase') {
    return recommended('推荐插入方案', '先尝试零移动，再以最低扰动安置新任务；用户也可查看其他方案或保留为未安排。')
  }
  if (event.type === 'goal-tightening') {
    return recommended('推荐目标调整方案', '只优先处理满足新目标条件所需的任务，并保留手动安排。', 'goal')
  }
  if (event.type === 'availability-change') {
    return recommended('推荐日期调整方案', '先搬出容量下降或不可用范围内的任务，并平衡变化前后日期。')
  }
  if (event.type === 'rule-change') {
    return recommended('推荐最小修复方案', '规则变化后只修复新增冲突，不主动重写整个未来计划。')
  }
  if (event.type === 'execution-difference') {
    return recommended('推荐冲突修复方案', '只处理当前检测到的问题；不会要求用户先理解内部算法模式。')
  }
  return recommended('推荐计划调整', '先展示一个符合当前场景的推荐，再由用户决定是否比较其他方案。')
}

export function eventWithPreferences(event: PlanChangeEvent, preferences: SchedulingPreference[]): PlanChangeEvent {
  return { ...event, metadata: { ...(event.metadata ?? {}), preferredPreferences: preferences } }
}
