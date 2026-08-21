import { z } from 'zod'
import type { AppState } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const timestamp = z.string().min(1)
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(5)])
const taskStatus = z.enum(['todo', 'partial', 'done'])

const durationSettingsSchema = z.object({
  enabled: z.boolean(), windowSize: z.number(), minimumSamples: z.number(), deviationThreshold: z.number(), outlierRule: z.literal('iqr'),
}).partial().strict()

const settingsSchema = z.object({
  planName: z.string(), startDate: z.string(), endDate: z.string(), coreTargetDate: z.string(), chemistryTargetDate: z.string(),
  bufferDays: z.number(), regularMinutes: z.number(), studyMinutes: z.number(), travelMinutes: z.number(), countWordsTime: z.boolean(),
  showWarnings: z.boolean(), optionalReview: z.boolean(), sidebarCollapsed: z.boolean(), theme: z.enum(['system', 'light', 'dark']),
  notificationsEnabled: z.boolean(), planningMode: z.enum(['sprint', 'balanced', 'relaxed']), freezeDays: z.number(),
  regularOverbookMinutes: z.number(), studyOverbookMinutes: z.number(), regularMaxTasks: z.number(), studyMaxTasks: z.number(),
  subjectShareLimit: z.number(), highLoadThreshold: z.number(), highLoadStreak: z.number(), keepOfflineOnLogout: z.boolean(),
  targetUtilization: z.number(), nearFullThreshold: z.number(), bufferUtilization: z.number(), localRepairRadius: z.number(),
  maxNewTasksPerDay: z.number(), maxLoadChangeRatio: z.number(), customSubjects: z.array(z.string()), duration: durationSettingsSchema,
  longTaskThresholdMinutes: z.number(), longTaskMaxPerDay: z.number(), longTaskMaxPerDayLight: z.number(),
  setupProgress: z.object({ currentStep: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(), availabilityConfirmed: z.boolean().optional() }).partial().strict().optional(),
}).partial().strict()

const dayConfigSchema = z.object({
  date: z.string(), type: z.enum(['regular', 'study', 'travel', 'custom']), customMinutes: z.number().optional(), note: z.string().optional(),
  userSet: z.boolean().optional(), isBufferDay: z.boolean().optional(), availableMinutes: z.number().optional(), bufferReason: z.string().optional(),
  bufferPreference: z.enum(['preserve', 'goal', 'spread']).optional(), bufferProtected: z.boolean().optional(),
}).partial({ date: true, type: true }).strict()

const taskGroupSchema = z.object({
  id: z.string(), subject: z.string(), title: z.string(), priority, quantity: z.number(), sourceQuantity: z.number().optional(), unitMinutes: z.number(),
  targetDate: z.string(), dueDate: z.string(), dailyMax: z.number().optional(), recurring: z.boolean().optional(), recurrenceStart: z.string().optional(),
  recurrenceEnd: z.string().optional(), recurrenceWeekdays: z.array(z.number()).optional(), countInStats: z.boolean(), hidden: z.boolean().optional(),
  hiddenStandalone: z.boolean().optional(), flexibleDuration: z.boolean().optional(), allowSplit: z.boolean().optional(), splitSessionMinutes: z.number().optional(),
  prerequisiteGroupIds: z.array(z.string()).optional(), memoryTask: z.boolean().optional(), activityType: z.string().optional(), highIntensity: z.boolean().optional(),
  notes: z.string().optional(), sourceLabel: z.string().optional(), status: z.enum(['active', 'completed', 'archived']).optional(),
  createdAt: z.string().optional(), updatedAt: z.string().optional(), completedAt: z.string().optional(),
}).partial({ id: true, subject: true, title: true, priority: true, quantity: true, unitMinutes: true, targetDate: true, dueDate: true, countInStats: true }).strict()

const timeEntrySchema = z.object({
  id: z.string(), minutes: z.number(), date: isoDate.optional(), createdAt: z.string(), source: z.enum(['timer', 'manual', 'finish', 'inferred']).optional(),
  countInStatistics: z.boolean().optional(), updatedAt: z.string().optional(), originalCreatedAt: z.string().optional(),
}).partial({ id: true, minutes: true, createdAt: true }).strict()

const statusEventSchema = z.object({
  id: z.string(), date: isoDate, createdAt: timestamp, status: taskStatus, progress: z.number(), source: z.enum(['completion', 'partial', 'reopen', 'migration']),
}).strict()

const assignmentSchema = z.object({
  id: z.string(), groupId: z.string(), index: z.number(), title: z.string(), scheduledDate: z.string().optional(), estimatedMinutes: z.number(),
  actualMinutes: z.number(), progress: z.number(), status: taskStatus, locked: z.boolean(), completedAt: z.string().optional(), notes: z.string().optional(),
  timeEntries: z.array(timeEntrySchema), statusHistory: z.array(statusEventSchema).optional(),
  scheduleSource: z.enum(['system', 'manual', 'carryover', 'replan', 'import', 'recurring', 'migration', 'template']),
  intentStrength: z.enum(['normal', 'manual', 'locked']), previousDate: z.string().optional(), lastManualMoveAt: z.string().optional(),
  remainingMinutes: z.number().optional(), manuallyEstimated: z.boolean().optional(), titleCustomized: z.boolean().optional(), durationCustomized: z.boolean().optional(),
  standalone: z.boolean().optional(), createdAt: z.string().optional(), updatedAt: z.string().optional(), createdBy: z.enum(['user', 'template', 'import', 'system', 'migration']).optional(),
  splitSourceIndex: z.number().optional(), splitPart: z.number().optional(), splitTotal: z.number().optional(),
}).partial({ id: true, groupId: true, index: true, title: true, estimatedMinutes: true, actualMinutes: true, progress: true, status: true, locked: true, timeEntries: true, scheduleSource: true, intentStrength: true }).strict()

const goalConditionSchema = z.object({ id: z.string(), groupId: z.string(), mode: z.enum(['all', 'percentage', 'count']), value: z.number().optional() }).strict()
const goalSchema = z.object({
  id: z.string(), title: z.string(), description: z.string().optional(), priority, desiredDate: z.string().optional(), latestDate: z.string(),
  status: z.enum(['active', 'completed', 'archived']), completionConditions: z.array(goalConditionSchema), linkedTaskGroupIds: z.array(z.string()),
  linkedAssignmentIds: z.array(z.string()), migratedFromLegacy: z.boolean().optional(), createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().optional(),
}).partial({ id: true, title: true, priority: true, latestDate: true, status: true, completionConditions: true, linkedTaskGroupIds: true, linkedAssignmentIds: true, createdAt: true, updatedAt: true }).strict()

const calendarConstraintSchema = z.object({
  id: z.string(), startDate: z.string(), endDate: z.string(), kind: z.enum(['unavailable', 'reduced-capacity', 'special-capacity', 'protected-buffer', 'note']),
  capacityMinutes: z.number().optional(), protected: z.boolean(), reason: z.string().optional(), preference: z.enum(['preserve', 'goal', 'spread']).optional(),
  createdAt: z.string(), updatedAt: z.string(),
}).partial({ id: true, endDate: true, protected: true, createdAt: true, updatedAt: true }).strict()

const constraintExceptionSchema = z.object({
  id: z.string().optional(), eventId: z.string().optional(), date: z.string(), key: z.enum(['capacity', 'group-daily-max', 'activity-daily-max', 'long-task-max', 'high-intensity-max', 'date-protection', 'task-lock', 'past-freeze', 'active-timer', 'goal-latest']),
  rawKey: z.string().optional(), label: z.string(), permanent: z.literal(false), currentLimit: z.number().optional(), overrideLimit: z.number().optional(),
  accepted: z.boolean().optional(), affectedAssignmentIds: z.array(z.string()).optional(), createdAt: z.string().optional(),
}).strict()

const reviewRecordSchema = z.object({
  id: z.string(), date: z.string(), createdAt: z.string(), completedCount: z.number(), totalCount: z.number(), plannedMinutes: z.number(), actualMinutes: z.number(),
  inferredMinutes: z.number().optional(), plannedAssignmentIds: z.array(z.string()).optional(), executedAssignmentIds: z.array(z.string()).optional(),
  completedAssignmentIds: z.array(z.string()).optional(), unfinishedAssignmentIds: z.array(z.string()), durationSuggestionGroupIds: z.array(z.string()),
}).strict()

const planEventSchema = z.object({
  id: z.string(), type: z.enum(['new-task-insertion', 'task-group-size-increase', 'goal-tightening', 'goal-relaxation', 'availability-change', 'execution-difference', 'load-preference-change', 'future-replanning', 'rule-change', 'assignment-deletion', 'bulk-move', 'group-deletion', 'goal-deletion', 'time-entry-change', 'restore', 'migration']),
  action: z.enum(['insert', 'repair', 'optimize', 'rebuild']), title: z.string(), description: z.string(), affectedGoalIds: z.array(z.string()),
  affectedGroupIds: z.array(z.string()), affectedAssignmentIds: z.array(z.string()), affectedDates: z.array(z.string()), createdAt: z.string(), metadata: z.record(z.string(), z.unknown()).optional(),
}).strict()

const intakeTaskSchema = z.object({
  id: z.string(), kind: z.enum(['single', 'group']).optional(), title: z.string(), subject: z.string(), priority, unitMinutes: z.number(), activityType: z.string(), dailyMax: z.number().optional(),
  highIntensity: z.boolean(), countInStats: z.boolean(), quantity: z.number(), notes: z.string().optional(), goalIds: z.array(z.string()), goalTitle: z.string().optional(),
  desiredDate: z.string().optional(), latestDate: z.string().optional(), preferredDate: z.string().optional(), fixedDate: z.string().optional(), recurring: z.boolean().optional(),
  recurrenceStart: z.string().optional(), recurrenceEnd: z.string().optional(), recurrenceWeekdays: z.array(z.number()).optional(), allowSplit: z.boolean().optional(),
  splitSessionMinutes: z.number().optional(), prerequisiteGroupIds: z.array(z.string()).optional(), prerequisiteGroupTitles: z.array(z.string()).optional(),
  numberingChoice: z.enum(['preserve', 'number-all']).optional(), createdAt: z.string(), updatedAt: z.string(), source: z.enum(['manual', 'paste', 'csv', 'xlsx']),
  appliedAt: z.string().optional(), appliedGroupId: z.string().optional(), appliedAssignmentId: z.string().optional(),
}).partial({ id: true, title: true, subject: true, priority: true, unitMinutes: true, activityType: true, highIntensity: true, countInStats: true, quantity: true, goalIds: true, createdAt: true, updatedAt: true, source: true }).strict()

const intakeBatchSchema = z.object({
  id: z.string(), name: z.string(), status: z.enum(['editing', 'pending', 'calculating', 'applied', 'archived']), source: z.enum(['manual', 'paste', 'csv', 'xlsx', 'mixed']),
  taskGroups: z.array(intakeTaskSchema), createdAt: z.string(), updatedAt: z.string(), lastEditedItemId: z.string().optional(),
  formDraft: z.object({
    title: z.string().optional(), subject: z.string().optional(), priority, unitMinutes: z.number().optional(), activityType: z.string().optional(),
    dailyMax: z.number().optional(), highIntensity: z.boolean().optional(), countInStats: z.boolean().optional(), quantity: z.number().optional(),
    notes: z.string().optional(), goalIds: z.array(z.string()).optional(), goalTitle: z.string().optional(), desiredDate: z.string().optional(), latestDate: z.string().optional(),
    preferredDate: z.string().optional(), fixedDate: z.string().optional(), recurring: z.boolean().optional(), recurrenceStart: z.string().optional(), recurrenceEnd: z.string().optional(),
    recurrenceWeekdays: z.array(z.number()).optional(), allowSplit: z.boolean().optional(), splitSessionMinutes: z.number().optional(), prerequisiteGroupIds: z.array(z.string()).optional(),
  }).partial().strict().optional(), archivedAt: z.string().optional(),
}).partial({ id: true, name: true, status: true, source: true, taskGroups: true, createdAt: true, updatedAt: true }).strict()

const baselineSchema = z.object({
  id: z.string(), date: z.string(), capturedAt: z.string(), assignments: z.array(z.object({
    assignmentId: z.string(), groupId: z.string(), title: z.string(), estimatedMinutes: z.number(), statusAtCapture: taskStatus.optional(), progressAtCapture: z.number().optional(),
  }).strict()),
}).partial({ id: true, capturedAt: true }).strict()

// Local-only history payloads are validated structurally and their JSON snapshots are
// parsed separately at restore time. This keeps the active state schema bounded.
const replanHistorySchema = z.object({
  id: z.string(), createdAt: z.string(), label: z.string(), mode: z.enum(['repair', 'full']), moveCount: z.number(), snapshot: z.string(), afterSnapshot: z.string().optional(), audit: z.unknown().optional(),
}).strict()
const planVersionSchema = z.object({
  id: z.string(), timestamp: z.string(), reason: z.string(), eventType: z.string(), affectedGoalIds: z.array(z.string()), affectedGroupIds: z.array(z.string()),
  affectedAssignmentIds: z.array(z.string()), affectedDates: z.array(z.string()), summary: z.unknown(), beforeState: z.string(), afterState: z.string(),
  schemaVersion: z.number(), localOnly: z.literal(true), preference: z.string().optional(), proposalTitle: z.string().optional(), proposalDescription: z.string().optional(),
  exceptionSummaries: z.array(z.string()).optional(), manualOverrideCount: z.number().optional(),
}).strict()

/** Version-tolerant ingress schema. Missing legacy fields are migrated after validation. */
export const appStateIngressSchema = z.object({
  schemaVersion: z.number().optional(), version: z.number().optional(), dataRevision: z.number().optional(), updatedAt: z.string().optional(), settings: settingsSchema.optional(),
  dayConfigs: z.record(z.string(), dayConfigSchema).optional(), taskGroups: z.array(taskGroupSchema), assignments: z.array(assignmentSchema).optional(), goals: z.array(goalSchema).optional(),
  calendarConstraints: z.array(calendarConstraintSchema).optional(), acceptedConstraintExceptions: z.array(constraintExceptionSchema).optional(),
  timer: z.object({ assignmentId: z.string().optional(), startedAt: z.number().optional(), accumulatedSeconds: z.number(), running: z.boolean() }).partial({ accumulatedSeconds: true, running: true }).strict().optional(),
  reviewRecords: z.array(reviewRecordSchema).optional(), changeEvents: z.array(planEventSchema).optional(), intakeBatches: z.array(intakeBatchSchema).optional(),
  dailyPlanBaselines: z.array(baselineSchema).optional(), guestModified: z.boolean().optional(), lastCloudSyncAt: z.string().optional(), templateKind: z.enum(['summer', 'demo', 'blank']).optional(),
  conflictBackups: z.array(z.string()).optional(), replanHistory: z.array(replanHistorySchema).optional(), planVersions: z.array(planVersionSchema).optional(),
}).strict().superRefine((value, context) => {
  if (value.version === undefined && value.schemaVersion === undefined) context.addIssue({ code: 'custom', message: '缺少数据版本号' })
})

export type StateInputSource = 'indexeddb' | 'json' | 'cloud' | 'snapshot'

export interface StateValidationResult {
  success: boolean
  data?: AppState
  source: StateInputSource
  issues: string[]
  rawBackup: string
}

function stableBackup(raw: unknown) {
  try { return JSON.stringify(raw, null, 2) } catch { return String(raw) }
}

export function validateStateInput(raw: unknown, source: StateInputSource): StateValidationResult {
  const parsed = appStateIngressSchema.safeParse(raw)
  if (!parsed.success) return {
    success: false,
    source,
    rawBackup: stableBackup(raw),
    issues: parsed.error.issues.slice(0, 20).map(issue => `${issue.path.join('.') || '根节点'}：${issue.message}`),
  }
  return { success: true, source, data: parsed.data as AppState, issues: [], rawBackup: stableBackup(raw) }
}
