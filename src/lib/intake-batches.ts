import type { IntakeBatch, IntakeBatchSource, IntakeTaskGroupDraft, TaskGroupDraft } from '../types'
import { uid } from './id'

/**
 * Lightweight intake mutations intentionally live outside the scheduler.
 * They can be benchmarked independently and must never create assignments,
 * plan events, conflict exceptions, or scheduling proposals.
 */
export function createIntakeBatchRecord(name: string | undefined, now: string, id = uid('intake')): IntakeBatch {
  return {
    id,
    name: name?.trim() || `任务录入 ${new Date(now).toLocaleDateString('zh-CN')}`,
    status: 'editing',
    source: 'manual',
    taskGroups: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function appendIntakeDraft(
  batch: IntakeBatch,
  draft: TaskGroupDraft,
  source: Exclude<IntakeBatchSource, 'mixed'>,
  now: string,
  id = uid('intake-item'),
): IntakeTaskGroupDraft {
  const item: IntakeTaskGroupDraft = {
    ...structuredClone(draft),
    id,
    title: draft.title.trim(),
    quantity: Math.max(1, Math.round(draft.quantity)),
    unitMinutes: Math.max(1, Math.round(draft.unitMinutes)),
    goalIds: Array.from(new Set(draft.goalIds)),
    recurrenceWeekdays: draft.recurrenceWeekdays ? Array.from(new Set(draft.recurrenceWeekdays)).sort() : undefined,
    prerequisiteGroupIds: draft.prerequisiteGroupIds ? Array.from(new Set(draft.prerequisiteGroupIds)) : undefined,
    source,
    createdAt: now,
    updatedAt: now,
  }
  batch.taskGroups.push(item)
  batch.status = 'editing'
  batch.source = batch.taskGroups.some(candidate => candidate.source !== source) ? 'mixed' : source
  batch.lastEditedItemId = id
  batch.updatedAt = now
  return item
}

