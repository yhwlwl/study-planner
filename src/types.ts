/** Study Planner v0.8 领域模型。保留少量 v0.7 兼容字段，仅用于确定性迁移与旧界面渐进改造。 */
export const SCHEMA_VERSION = 10 as const

export type ISODate = string
export type Priority = 0 | 1 | 2 | 3 | 5
export type DayType = 'regular' | 'study' | 'travel' | 'custom'
export type TaskStatus = 'todo' | 'partial' | 'done'
export type Subject = string
export type PlanningMode = 'sprint' | 'balanced' | 'relaxed'
export type ThemePreference = 'system' | 'light' | 'dark'
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
export type AdjustmentResolutionMode = 'validate-and-commit' | 'recommended-preview' | 'optional-optimization' | 'exploratory-optimization'
export type AdjustmentOperationScope = 'requested-change-only' | 'directly-affected-items' | 'broader-future-plan'

export type ConflictCategory = 'absolute-blocker' | 'protected-intent' | 'waivable-rule' | 'structural-conflict' | 'warning'
export type ConflictResolutionAction =
  | 'accept-once'
  | 'system-find-another-date'
  | 'keep-original'
  | 'leave-unscheduled'
  | 'unlock-and-move'
  | 'change-goal'
  | 'change-capacity'
  | 'cancel-change'

export interface ConflictResolutionDecision {
  issueId: string
  action: ConflictResolutionAction
}

export interface PlanAdjustmentPolicy {
  mode: AdjustmentResolutionMode
  primaryPreference: SchedulingPreference
  alternativePreferences: SchedulingPreference[]
  allowKeepPrepared: boolean
  directPreviewLabel: string
  explanation: string
  defaultScope: AdjustmentOperationScope
}
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
  theme: ThemePreference
  notificationsEnabled: boolean
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
  /** 拆分任务保留用户最初录入的项目数量；quantity 仍表示实际生成的学习项数量。 */
  sourceQuantity?: number
  unitMinutes: number
  /** v0.7 兼容字段；不再作为可编辑目标日期来源。 */
  targetDate: string
  /** v0.7 兼容字段；不再作为可编辑目标日期来源。 */
  dueDate: string
  dailyMax?: number
  recurring?: boolean
  recurrenceStart?: string
  recurrenceEnd?: string
  /** 0-6 对应周日到周六；为空时表示日期范围内每天重复。 */
  recurrenceWeekdays?: number[]
  countInStats: boolean
  hidden?: boolean
  hiddenStandalone?: boolean
  flexibleDuration?: boolean
  allowSplit?: boolean
  /** 允许拆分时，每次学习的目标分钟数。 */
  splitSessionMinutes?: number
  /** 任务组级前置依赖，组内任务必须晚于这些任务组的已排任务。 */
  prerequisiteGroupIds?: string[]
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
  updatedAt?: string
  originalCreatedAt?: string
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
  /** 可拆分任务所属的原始项目序号。 */
  splitSourceIndex?: number
  splitPart?: number
  splitTotal?: number
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
  /** 目标间冲突时使用；期限更近仍优先，同期限再按优先级。 */
  priority: Priority
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
  | 'assignment-deletion'
  | 'bulk-move'
  | 'group-deletion'
  | 'goal-deletion'
  | 'time-entry-change'
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
  /** 保留 group:ID / activity:TYPE 等精确内部键，避免不同组共享例外。 */
  rawKey?: string
  label: string
  permanent: false
  /** 原规则值与本次临时放宽值，仅用于解释和审计。 */
  currentLimit?: number
  overrideLimit?: number
  accepted?: boolean
  /** 最小授权：记录本次例外实际涉及的任务，不把例外扩展为整日永久许可。 */
  affectedAssignmentIds?: string[]
}

export interface AcceptedConstraintException extends ConstraintException {
  id: string
  eventId: string
  accepted: true
  createdAt: string
}

export interface ConstraintExceptionResolutionDecision {
  exception: ConstraintException
  action: 'accept-once' | 'system-find-another-date'
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
  /** 保留调度器原始约束键，支持逐项例外与重新计算。 */
  rawConstraintKey?: string
  suggestedLimit?: number
  conflictCategory?: ConflictCategory
  allowedResolutions?: ConflictResolutionAction[]
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
  beforeCapacity?: number
  afterCapacity?: number
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


export interface ProposalFieldChange {
  label: string
  before?: string
  after?: string
}

export interface ProposalStructuralChange {
  entityType: 'assignment' | 'task-group' | 'goal' | 'calendar-constraint' | 'settings'
  entityId: string
  title: string
  changeType: 'added' | 'removed' | 'updated'
  fields: ProposalFieldChange[]
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


export interface ProposalIssueDelta {
  /** 操作前已经存在的硬约束事实数量。 */
  preExistingCount: number
  /** 本次操作后仍存在，但没有新增或恶化的既有问题。 */
  remainingPreExistingCount: number
  /** 本次操作直接解决的既有问题。 */
  resolvedPreExistingCount: number
  /** 本次操作让超额程度下降、但尚未完全解决的既有问题。 */
  improvedPreExistingCount: number
  /** 本次操作新产生或恶化的问题；只有这些属于本次必须处理的范围。 */
  newOrWorsenedCount: number
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
  /** 非日期类的完整前后变化，例如任务换组、预计时长、任务组规则、目标和日期约束。 */
  structuralChanges: ProposalStructuralChange[]
  exceptions: ConstraintException[]
  excludedDates: RejectedDateReason[]
  metrics: ProposalMetrics
  issueDelta?: ProposalIssueDelta
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
  /** 重大方案的可解释审计元数据；旧版本可为空。 */
  preference?: SchedulingPreference
  proposalTitle?: string
  proposalDescription?: string
  exceptionSummaries?: string[]
  manualOverrideCount?: number
}

export interface ReviewRecord {
  id: string
  date: ISODate
  createdAt: string
  completedCount: number
  totalCount: number
  plannedMinutes: number
  actualMinutes: number
  inferredMinutes?: number
  /** 保存当日复盘快照，避免任务后来重开或改期后重写历史。 */
  plannedAssignmentIds?: string[]
  executedAssignmentIds?: string[]
  completedAssignmentIds?: string[]
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
  /** 已完成目标的真实达成日期，按满足条件所需任务的最晚完成日计算。 */
  actualCompletionDate?: ISODate
  desiredRisk: boolean
  latestRisk: boolean
  /** 已完成目标用于历史评价；未完成时为空。 */
  desiredMet?: boolean
  latestMet?: boolean
  conditionDetails: Array<{
    conditionId: string
    groupId: string
    mode: GoalConditionMode
    required: number
    completed: number
    countedAssignmentIds: string[]
  }>
}


export interface ReviewDaySnapshot {
  date: ISODate
  /** 当日原计划任务。 */
  plannedAssignmentIds: string[]
  /** 当日有真实计时、手动用时或完成记录的任务。 */
  executedAssignmentIds: string[]
  /** 复盘中展示的任务并集，自动去重。 */
  assignmentIds: string[]
  completedAssignmentIds: string[]
  unfinishedAssignmentIds: string[]
  recurringUnfinishedAssignmentIds: string[]
  plannedMinutes: number
  actualMinutes: number
  inferredMinutes: number
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
  /** 独立任务使用自己的类别与优先级；加入任务组时忽略这两个字段。 */
  subject?: Subject
  priority?: Priority
  estimatedMinutes: number
  schedulingIntent: SchedulingIntent
  date?: ISODate
  locked: boolean
  notes?: string
  /** 当一项任务组首次扩展为多项时，明确选择是否统一编号。 */
  numberingChoice?: 'preserve' | 'number-all'
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
  /** 录入阶段可直接声明目标；正式应用时会转换为 Goal，而不是写回任务组日期。 */
  goalTitle?: string
  desiredDate?: ISODate
  latestDate?: ISODate
  /** 尽量安排在此日，但容量或硬约束不允许时可由方案调整。 */
  preferredDate?: ISODate
  /** 必须安排在此日，生成后为锁定任务。 */
  fixedDate?: ISODate
  recurring?: boolean
  recurrenceStart?: ISODate
  recurrenceEnd?: ISODate
  recurrenceWeekdays?: number[]
  allowSplit?: boolean
  splitSessionMinutes?: number
  prerequisiteGroupIds?: string[]
  /** 导入时可用任务组名称声明依赖，应用批次时再解析为 ID。 */
  prerequisiteGroupTitles?: string[]
  /** 编辑单项组扩展为多项时，明确保护原名或统一编号。 */
  numberingChoice?: 'preserve' | 'number-all'
}

export type IntakeBatchStatus = 'editing' | 'pending' | 'calculating' | 'applied' | 'archived'
export type IntakeBatchSource = 'manual' | 'paste' | 'csv' | 'xlsx' | 'mixed'
export type IntakeItemKind = 'single' | 'group'

export interface IntakeTaskGroupDraft extends TaskGroupDraft {
  /** 旧批次没有该字段时按任务组处理。 */
  kind?: IntakeItemKind
  id: string
  createdAt: string
  updatedAt: string
  source: Exclude<IntakeBatchSource, 'mixed'>
  appliedAt?: string
  appliedGroupId?: string
  appliedAssignmentId?: string
}

export interface IntakeBatch {
  id: string
  name: string
  status: IntakeBatchStatus
  source: IntakeBatchSource
  taskGroups: IntakeTaskGroupDraft[]
  createdAt: string
  updatedAt: string
  lastEditedItemId?: string
  archivedAt?: string
}

export interface DailyPlanBaselineAssignment {
  assignmentId: string
  groupId: string
  title: string
  estimatedMinutes: number
}

export interface DailyPlanBaseline {
  id: string
  date: ISODate
  capturedAt: string
  assignments: DailyPlanBaselineAssignment[]
}

export interface GoalDraft {
  title: string
  description?: string
  priority: Priority
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
  acceptedConstraintExceptions: AcceptedConstraintException[]
  timer: TimerState
  reviewRecords: ReviewRecord[]
  changeEvents: PlanChangeEvent[]
  intakeBatches: IntakeBatch[]
  dailyPlanBaselines: DailyPlanBaseline[]
  guestModified: boolean
  lastCloudSyncAt?: string
  templateKind?: 'summer' | 'demo' | 'blank' | 'tutorial'
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
  /** 例外可精确到任务；未填写时仅表示既有状态的兼容上限。 */
  affectedAssignmentIds?: string[]
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
  /** 本次完整重排是否允许把未来任务纳入今天的候选窗口。 */
  includeToday?: boolean
  todayExtraMinutes?: number
  /** 用户逐项允许的未来任务进入今天的任务 ID；仅对本轮计算生效。 */
  allowTodayIncomingAssignments?: string[]
  allowBufferUseDates?: string[]
  /** 受保护日期的一次性授权可精确到任务，避免整日放开。 */
  allowProtectedDateAssignments?: Array<{ date: ISODate; assignmentIds: string[] }>
  limitOverrides?: ReplanLimitOverride[]
  localRadius?: number
  affectedAssignmentIds?: string[]
  /** 一次减负操作的可执行负载条件；只在本次方案计算中生效。 */
  loadConstraints?: {
    startDate: ISODate
    endDate: ISODate
    maxMinutesPerDay?: number
    lightDaysPerWeek?: number
    maxHighLoadStreak?: number
    maxLongHighPerDay?: number
  }
  event?: PlanChangeEvent
  /** summary 只生成方案摘要；full 额外计算逐项解释和替代日期。 */
  explanationLevel?: 'summary' | 'full'
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
