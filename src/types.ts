/** Study Planner v0.8 领域模型。保留少量 v0.7 兼容字段，仅用于确定性迁移与旧界面渐进改造。 */
export const SCHEMA_VERSION = 8 as const

export type ISODate = string
export type Priority = 0 | 1 | 2 | 3 | 5
export type DayType = 'regular' | 'study' | 'travel' | 'custom'
export type TaskStatus = 'todo' | 'partial' | 'done'
export type Subject = string
export type PlanningMode = 'sprint' | 'balanced' | 'relaxed'
export type ScheduleSource = 'system' | 'manual' | 'carryover' | 'replan' | 'import' | 'recurring' | 'migration' | 'template'
export type IntentStrength = 'normal' | 'manual' | 'locked'
export type ReplanMode = 'repair' | 'full'
export type ReplanStrategy = 'preserve' | 'balanced' | 'goal' | 'rest'
export type BufferPreference = 'preserve' | 'goal' | 'spread'
export type TaskActivityType =
  | 'normal'
  | 'classical-study'
  | 'classical-dictation'
  | 'recitation'
  | 'chem-preview'
  | 'math-paper'
  | 'recurring'
  | string

export type GoalStatus = 'active' | 'completed' | 'archived'
export type TaskGroupStatus = 'active' | 'completed' | 'archived'
export type GoalConditionMode = 'all' | 'percentage' | 'count'
export type SchedulingIntent = 'system' | 'prefer-date' | 'lock-date'
export type SchedulingAction = 'insert' | 'repair' | 'optimize' | 'rebuild'
export type SchedulingPreference = ReplanStrategy
export type ImpactLevel = 'small' | 'medium' | 'large'
export type CreationSource = 'user' | 'template' | 'import' | 'system' | 'migration'

export interface DurationSettings {
  enabled: boolean
  windowSize: number
  minimumSamples: number
  deviationThreshold: number
  outlierRule: 'iqr'
}

export interface AppSettings {
  planName: string
  startDate: string
  endDate: string
  /** v0.7 兼容字段；v0.8 界面不再编辑，迁移完成后由目标系统接管。 */
  coreTargetDate: string
  /** v0.7 兼容字段；v0.8 界面不再编辑，迁移完成后由目标系统接管。 */
  chemistryTargetDate: string
  /** v0.7 兼容字段；新的缓冲日由 CalendarConstraint 表达。 */
  bufferDays: number
  regularMinutes: number
  studyMinutes: number
  travelMinutes: number
  countWordsTime: boolean
  showWarnings: boolean
  optionalReview: boolean
  sidebarCollapsed: boolean
  planningMode: PlanningMode
  freezeDays: number
  regularOverbookMinutes: number
  studyOverbookMinutes: number
  regularMaxTasks: number
  studyMaxTasks: number
  subjectShareLimit: number
  highLoadThreshold: number
  highLoadStreak: number
  keepOfflineOnLogout: boolean
  targetUtilization: number
  nearFullThreshold: number
  bufferUtilization: number
  localRepairRadius: number
  maxNewTasksPerDay: number
  maxLoadChangeRatio: number
  customSubjects: string[]
  duration: DurationSettings
}

export interface DayConfig {
  date: string
  type: DayType
  customMinutes?: number
  note?: string
  userSet?: boolean
  isBufferDay?: boolean
  availableMinutes?: number
  bufferReason?: string
  bufferPreference?: BufferPreference
  bufferProtected?: boolean
}

export interface TaskGroup {
  id: string
  subject: Subject
  title: string
  priority: Priority
  /** 兼容缓存；规范化时始终按 Assignment 实际数量重算。 */
  quantity: number
  unitMinutes: number
  /** v0.7 兼容字段；不再作为可编辑目标日期来源。 */
  targetDate: string
  /** v0.7 兼容字段；不再作为可编辑目标日期来源。 */
  dueDate: string
  dailyMax?: number
  recurring?: boolean
  recurrenceStart?: string
  recurrenceEnd?: string
  countInStats: boolean
  hidden?: boolean
  hiddenStandalone?: boolean
  flexibleDuration?: boolean
  allowSplit?: boolean
  memoryTask?: boolean
  activityType?: TaskActivityType
  highIntensity?: boolean
  notes?: string
  sourceLabel?: string
  status?: TaskGroupStatus
  createdAt?: string
  updatedAt?: string
  completedAt?: string
}

export interface TimeEntry {
  id: string
  minutes: number
  createdAt: string
  source?: 'timer' | 'manual' | 'finish' | 'inferred'
  countInStatistics?: boolean
}

export interface Assignment {
  id: string
  groupId: string
  index: number
  title: string
  scheduledDate?: string
  estimatedMinutes: number
  actualMinutes: number
  progress: number
  status: TaskStatus
  locked: boolean
  completedAt?: string
  notes?: string
  timeEntries: TimeEntry[]
  scheduleSource: ScheduleSource
  intentStrength: IntentStrength
  previousDate?: string
  lastManualMoveAt?: string
  remainingMinutes?: number
  manuallyEstimated?: boolean
  titleCustomized?: boolean
  durationCustomized?: boolean
  standalone?: boolean
  createdAt?: string
  updatedAt?: string
  createdBy?: CreationSource
}

export interface TimerState {
  assignmentId?: string
  startedAt?: number
  accumulatedSeconds: number
  running: boolean
}

export interface GoalCondition {
  id: string
  groupId: string
  mode: GoalConditionMode
  value?: number
}

export interface Goal {
  id: string
  title: string
  description?: string
  desiredDate?: ISODate
  latestDate: ISODate
  status: GoalStatus
  completionConditions: GoalCondition[]
  linkedTaskGroupIds: string[]
  linkedAssignmentIds: string[]
  migratedFromLegacy?: boolean
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type CalendarConstraintKind = 'unavailable' | 'reduced-capacity' | 'special-capacity' | 'protected-buffer' | 'note'

export interface CalendarConstraint {
  id: string
  startDate: ISODate
  endDate: ISODate
  kind: CalendarConstraintKind
  capacityMinutes?: number
  protected: boolean
  reason?: string
  preference?: BufferPreference
  createdAt: string
  updatedAt: string
}

export type PlanChangeEventType =
  | 'new-task-insertion'
  | 'task-group-size-increase'
  | 'goal-tightening'
  | 'goal-relaxation'
  | 'availability-change'
  | 'execution-difference'
  | 'load-preference-change'
  | 'future-replanning'
  | 'rule-change'
  | 'group-deletion'
  | 'goal-deletion'
  | 'restore'
  | 'migration'

export interface PlanChangeEvent {
  id: string
  type: PlanChangeEventType
  action: SchedulingAction
  title: string
  description: string
  affectedGoalIds: string[]
  affectedGroupIds: string[]
  affectedAssignmentIds: string[]
  affectedDates: ISODate[]
  createdAt: string
  metadata?: Record<string, unknown>
}

export type ConstraintKey =
  | 'capacity'
  | 'group-daily-max'
  | 'activity-daily-max'
  | 'long-task-max'
  | 'high-intensity-max'
  | 'date-protection'
  | 'task-lock'
  | 'past-freeze'
  | 'active-timer'
  | 'goal-latest'

export interface ConstraintException {
  date: ISODate
  key: ConstraintKey
  label: string
  permanent: false
  accepted?: boolean
}

export interface ProposalIssue {
  id: string
  type: ConstraintKey | 'goal-risk' | 'unscheduled' | 'duration-drift' | 'sequence'
  title: string
  detail: string
  date?: ISODate
  groupId?: string
  goalId?: string
  currentValue?: string
  allowedValue?: string
  assignmentIds: string[]
  consequence: string
  resolution: string
}

export interface RejectedDateReason {
  date: ISODate
  reasons: string[]
}

export interface TaskMovement {
  assignmentId: string
  fromDate?: ISODate
  toDate?: ISODate
  reason: string
  beforeLoad: number
  afterLoad: number
  goalImpact: string
  manualIntentImpact: 'none' | 'preserved' | 'moved-manual' | 'locked-blocked'
  rejectedAlternatives: RejectedDateReason[]
}

export interface DateLoadChange {
  date: ISODate
  beforeMinutes: number
  afterMinutes: number
  beforeTaskIds: string[]
  afterTaskIds: string[]
}

export interface GoalImpact {
  goalId: string
  beforeProgress: number
  afterProgress: number
  beforeExpectedCompletion?: ISODate
  afterExpectedCompletion?: ISODate
  desiredRiskBefore: boolean
  desiredRiskAfter: boolean
  latestRiskBefore: boolean
  latestRiskAfter: boolean
  summary: string
}

export interface ProposalMetrics {
  newTaskCount: number
  movedTaskCount: number
  affectedDateCount: number
  issueCount: number
  manualTaskMoveCount: number
  protectedDateUseCount: number
  beforeAverageLoad: number
  afterAverageLoad: number
  beforeMaxLoad: number
  afterMaxLoad: number
  originalDateRetention: number
  stabilityScore: number
  impactLevel: ImpactLevel
}

export interface SchedulingProposal {
  id: string
  eventId: string
  title: string
  description: string
  action: SchedulingAction
  preference: SchedulingPreference
  generatedAt: string
  stateBefore: AppStatePortable
  stateAfter: AppStatePortable
  issues: ProposalIssue[]
  movements: TaskMovement[]
  dateChanges: DateLoadChange[]
  goalImpacts: GoalImpact[]
  exceptions: ConstraintException[]
  excludedDates: RejectedDateReason[]
  metrics: ProposalMetrics
  distinctSignature: string
  infeasible: boolean
  infeasibleReason?: string
}

export interface PlanVersionSummary {
  goalCount: number
  groupCount: number
  assignmentCount: number
  completedCount: number
  scheduledMinutes: number
  movedTaskCount: number
  affectedDateCount: number
}

export interface PlanVersion {
  id: string
  timestamp: string
  reason: string
  eventType: PlanChangeEventType
  affectedGoalIds: string[]
  affectedGroupIds: string[]
  affectedAssignmentIds: string[]
  affectedDates: ISODate[]
  summary: PlanVersionSummary
  beforeState: string
  afterState: string
  schemaVersion: number
  localOnly: true
}

export interface ReviewRecord {
  id: string
  date: ISODate
  createdAt: string
  completedCount: number
  totalCount: number
  plannedMinutes: number
  actualMinutes: number
  unfinishedAssignmentIds: string[]
  durationSuggestionGroupIds: string[]
}

export interface DurationSuggestion {
  groupId: string
  currentEstimate: number
  suggestedEstimate: number
  recentAverage: number
  sampleCount: number
  deviationRatio: number
  eligibleAssignmentIds: string[]
  samples: Array<{ assignmentId: string; actualMinutes: number; estimatedMinutes: number; completionDate?: ISODate }>
}

export interface GoalProgress {
  goalId: string
  progress: number
  completed: boolean
  requiredCount: number
  completedCount: number
  remainingAssignmentIds: string[]
  countedAssignmentIds: string[]
  estimatedRemainingMinutes: number
  expectedCompletion?: ISODate
  desiredRisk: boolean
  latestRisk: boolean
  conditionDetails: Array<{
    conditionId: string
    groupId: string
    mode: GoalConditionMode
    required: number
    completed: number
    countedAssignmentIds: string[]
  }>
}

export interface PlacementResult {
  valid: boolean
  issues: ProposalIssue[]
  rejectedReasons: string[]
  projectedMinutes: number
  capacityMinutes: number
  projectedGroupCount: number
  groupLimit?: number
}

export interface NewTaskDraft {
  title: string
  groupId?: string
  standalone: boolean
  estimatedMinutes: number
  schedulingIntent: SchedulingIntent
  date?: ISODate
  locked: boolean
  notes?: string
}

export interface TaskGroupDraft {
  title: string
  subject: Subject
  priority: Priority
  unitMinutes: number
  activityType: TaskActivityType
  dailyMax?: number
  highIntensity: boolean
  countInStats: boolean
  quantity: number
  notes?: string
  goalIds: string[]
}

export interface GoalDraft {
  title: string
  description?: string
  desiredDate?: ISODate
  latestDate: ISODate
  completionConditions: GoalCondition[]
  linkedTaskGroupIds: string[]
  linkedAssignmentIds: string[]
}

export interface CreateResult {
  state: AppState
  event: PlanChangeEvent
  createdAssignmentIds: string[]
  createdGroupIds: string[]
}

export interface AppStatePortable {
  schemaVersion: number
  version: number
  updatedAt: string
  settings: AppSettings
  dayConfigs: Record<string, DayConfig>
  taskGroups: TaskGroup[]
  assignments: Assignment[]
  goals: Goal[]
  calendarConstraints: CalendarConstraint[]
  timer: TimerState
  reviewRecords: ReviewRecord[]
  changeEvents: PlanChangeEvent[]
  guestModified: boolean
  lastCloudSyncAt?: string
  templateKind?: 'summer' | 'demo' | 'blank'
}

export interface ReplanAuditDecision {
  assignmentId: string
  mode: 'accept' | 'keep' | 'custom'
  date?: string
  lock?: boolean
  previewFixed?: boolean
}

export interface ReplanAuditDayType {
  date: string
  type: DayType
  customMinutes?: number
  isBufferDay?: boolean
  availableMinutes?: number
  bufferReason?: string
  bufferPreference?: BufferPreference
}

export interface ReplanLimitOverride {
  date: string
  key: string
  limit: number
}

export interface ReplanAudit {
  strategy: ReplanStrategy
  decisions: ReplanAuditDecision[]
  dayTypes: ReplanAuditDayType[]
  limitOverrides?: ReplanLimitOverride[]
  todayExtraMinutes?: number
  allowBufferUseDates?: string[]
}

export interface ReplanHistoryEntry {
  id: string
  createdAt: string
  label: string
  mode: ReplanMode
  moveCount: number
  snapshot: string
  afterSnapshot?: string
  audit?: ReplanAudit
}

export interface AppState extends AppStatePortable {
  conflictBackups: string[]
  replanHistory: ReplanHistoryEntry[]
  planVersions: PlanVersion[]
}

export interface SequenceRenumberChange {
  assignmentId: string
  scheduledDate?: string
  fromIndex: number
  toIndex: number
  fromTitle: string
  toTitle: string
}

export interface SequenceRenumberGroup {
  groupId: string
  groupTitle: string
  assignmentCount: number
  changes: SequenceRenumberChange[]
}

export interface SequenceRenumberSuggestion {
  source: 'manual' | 'automatic' | 'mixed'
  groups: SequenceRenumberGroup[]
}

export interface ReplanRequest {
  mode: ReplanMode
  fromDate: string
  strategy?: ReplanStrategy
  freezeDays?: number
  todayExtraMinutes?: number
  allowBufferUseDates?: string[]
  limitOverrides?: ReplanLimitOverride[]
  localRadius?: number
  affectedAssignmentIds?: string[]
  event?: PlanChangeEvent
}

export interface ReplanAlternative {
  date: string
  label: string
  impact: string
}

export interface ReplanRejectedAlternative {
  date: string
  reasons: string[]
}

export interface ReplanMove {
  assignmentId: string
  title: string
  subject: Subject
  from?: string
  to?: string
  reason: string
  impact: string
  alternatives: ReplanAlternative[]
  rejectedAlternatives?: ReplanRejectedAlternative[]
  wasManual: boolean
  hardRequired: boolean
}

export interface DayTypeSuggestion {
  date: string
  from: DayType
  to: DayType
  reason: string
  capacityGain: number
}

export interface LoadChange {
  date: string
  beforeMinutes: number
  afterMinutes: number
  capacity: number
}

export interface ReplanConstraintConflict {
  date: string
  key: string
  label: string
  current: number
  limit: number
  suggestedLimit: number
  affectedAssignmentIds: string[]
  options: string[]
}

export interface ReplanDisturbance {
  changedDays: number
  movedTasks: number
  originalDateRetentionRate: number
  averageLoadDelta: number
  maximumLoadDelta: number
  preservedDailyBundles: number
}

export interface ReplanSummary {
  moved: number
  preservedManual: number
  locked: number
  unresolved: number
  coreBefore?: string
  coreAfter?: string
  chemistryBefore?: string
  chemistryAfter?: string
  allBefore?: string
  allAfter?: string
  bufferDays?: number
  changedDays?: number
  originalRetentionRate?: number
}

export interface ReplanResult {
  id: string
  strategy: ReplanStrategy
  title: string
  description: string
  request: ReplanRequest
  nextState: AppState
  moves: ReplanMove[]
  warnings: string[]
  consequences: string[]
  dayTypeSuggestions: DayTypeSuggestion[]
  loadChanges: LoadChange[]
  constraintConflicts: ReplanConstraintConflict[]
  disturbance: ReplanDisturbance
  summary: ReplanSummary
}

export interface ReplanBundle {
  request: ReplanRequest
  issues: string[]
  todaySnapshot?: {
    date: string
    actualMinutes: number
    inferredMinutes: number
    completedCount: number
    remainingCapacity: number
    allowedIncomingMinutes: number
    message: string
  }
  scenarios: ReplanResult[]
}
