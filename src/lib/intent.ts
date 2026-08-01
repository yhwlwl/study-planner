import type { AppStatePortable, PlanChangeEvent } from '../types'

/**
 * v0.8 仅预留自然语言意图解析边界，不提供 AI 功能。
 * 未来解析器只能返回变化事件草稿，不能直接修改计划或应用排期方案。
 */
export type PlanChangeEventDraft = Omit<PlanChangeEvent, 'id' | 'createdAt'>

export interface PlanIntentParser {
  parseUserIntent(input: string, context: AppStatePortable): Promise<PlanChangeEventDraft>
}
