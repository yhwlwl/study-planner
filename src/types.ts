export type Priority = 0 | 1 | 2 | 3 | 5
export type DayType = 'regular' | 'study' | 'travel' | 'custom'
export type TaskStatus = 'todo' | 'partial' | 'done'
export type Subject = '语文' | '数学' | '英语' | '物理' | '化学' | '生物' | '其他'

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
}

export interface DayConfig {
  date: string
  type: DayType
  customMinutes?: number
  note?: string
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
}

export interface TimerState {
  assignmentId?: string
  startedAt?: number
  accumulatedSeconds: number
  running: boolean
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
  conflictBackups?: AppState[]
}

export interface ReplanMove {
  assignmentId: string
  from?: string
  to?: string
}

export interface ReplanResult {
  nextState: AppState
  moves: ReplanMove[]
  warnings: string[]
}
