export type Priority = 0 | 1 | 2 | 3 | 5
export type DayType = 'regular' | 'study' | 'travel' | 'custom'
export type TaskStatus = 'todo' | 'partial' | 'done'
export type Subject = '语文' | '数学' | '英语' | '物理' | '化学' | '生物' | '其他'
export type PlanningMode = 'sprint' | 'balanced' | 'relaxed'
export type ScheduleSource = 'system' | 'manual' | 'carryover' | 'replan' | 'import' | 'recurring'
export type IntentStrength = 'normal' | 'manual' | 'locked'
export type ReplanMode = 'repair' | 'full'
export type ReplanStrategy = 'preserve' | 'balanced' | 'goal'

export interface AppSettings {
  planName: string
  startDate: string
  endDate: string
  coreTargetDate: string
  chemistryTargetDate: string
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
}

export interface DayConfig {
  date: string
  type: DayType
  customMinutes?: number
  note?: string
  userSet?: boolean
}

export interface TaskGroup {
  id: string
  subject: Subject
  title: string
  priority: Priority
  quantity: number
  unitMinutes: number
  targetDate: string
  dueDate: string
  dailyMax?: number
  recurring?: boolean
  recurrenceStart?: string
  recurrenceEnd?: string
  countInStats: boolean
  hidden?: boolean
  flexibleDuration?: boolean
  allowSplit?: boolean
  memoryTask?: boolean
  notes?: string
  sourceLabel?: string
}

export interface TimeEntry {
  id: string
  minutes: number
  createdAt: string
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
}

export interface TimerState {
  assignmentId?: string
  startedAt?: number
  accumulatedSeconds: number
  running: boolean
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
}

export interface ReplanAudit {
  strategy: ReplanStrategy
  decisions: ReplanAuditDecision[]
  dayTypes: ReplanAuditDayType[]
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

export interface AppState {
  version: number
  updatedAt: string
  settings: AppSettings
  dayConfigs: Record<string, DayConfig>
  taskGroups: TaskGroup[]
  assignments: Assignment[]
  timer: TimerState
  lastCloudSyncAt?: string
  conflictBackups?: string[]
  replanHistory: ReplanHistoryEntry[]
  templateKind?: 'summer' | 'demo' | 'blank'
}

export interface ReplanRequest {
  mode: ReplanMode
  fromDate: string
  strategy?: ReplanStrategy
  freezeDays?: number
}

export interface ReplanAlternative {
  date: string
  label: string
  impact: string
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
  summary: ReplanSummary
}

export interface ReplanBundle {
  request: ReplanRequest
  issues: string[]
  scenarios: ReplanResult[]
}
