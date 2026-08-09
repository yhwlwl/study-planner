import { z } from 'zod'
import type { AppState, IntakeTaskGroupDraft, Priority, TaskGroupDraft } from '../types'
import { dateRange, shiftDate, todayISO } from './date'

export type IntakeImportField =
  | 'title' | 'subject' | 'quantity' | 'unitMinutes' | 'priority' | 'dailyMax' | 'notes'
  | 'goalTitle' | 'desiredDate' | 'latestDate' | 'preferredDate' | 'fixedDate'
  | 'recurring' | 'recurrenceStart' | 'recurrenceEnd' | 'recurrenceWeekdays'
  | 'allowSplit' | 'splitSessionMinutes' | 'prerequisiteGroupTitles' | 'countInStats' | 'highIntensity'

export interface IntakeImportIssue {
  row: number
  field?: string
  message: string
}

export interface IntakeImportTable {
  headers: string[]
  rows: unknown[][]
  mapping: Array<IntakeImportField | 'ignore'>
  hasHeader: boolean
}

export interface IntakeImportReviewRow {
  sourceRow: number
  draft: TaskGroupDraft
  issues: IntakeImportIssue[]
}

export interface IntakeImportResult {
  drafts: TaskGroupDraft[]
  issues: IntakeImportIssue[]
  skippedRows: number
  table?: IntakeImportTable
  reviewRows?: IntakeImportReviewRow[]
}

export const intakeImportFields: Array<{ value: IntakeImportField | 'ignore'; label: string }> = [
  { value: 'ignore', label: '忽略此列' }, { value: 'title', label: '任务组名称' }, { value: 'subject', label: '科目 / 分类' },
  { value: 'quantity', label: '数量' }, { value: 'unitMinutes', label: '单项分钟' }, { value: 'priority', label: '优先级' },
  { value: 'dailyMax', label: '每日上限' }, { value: 'goalTitle', label: '目标名称' }, { value: 'desiredDate', label: '期望完成日' },
  { value: 'latestDate', label: '最晚完成日' }, { value: 'preferredDate', label: '偏好排期日' }, { value: 'fixedDate', label: '固定排期日' },
  { value: 'recurring', label: '是否重复' }, { value: 'recurrenceStart', label: '重复开始' }, { value: 'recurrenceEnd', label: '重复结束' },
  { value: 'recurrenceWeekdays', label: '重复星期' }, { value: 'allowSplit', label: '允许拆分' }, { value: 'splitSessionMinutes', label: '每段分钟' },
  { value: 'prerequisiteGroupTitles', label: '前置任务组' }, { value: 'countInStats', label: '计入统计' }, { value: 'highIntensity', label: '高强度' },
  { value: 'notes', label: '备注' },
]

const priorityValues = new Set([0, 1, 2, 3, 5])
const fieldLabels: Partial<Record<IntakeImportField, string>> = Object.fromEntries(intakeImportFields.filter(item => item.value !== 'ignore').map(item => [item.value, item.label]))
const numberPattern = /-?\d+(?:\.\d+)?/

const normalizedRowSchema = z.object({
  title: z.string().trim().min(1, '任务组名称不能为空'),
  subject: z.string().trim().min(1).default('其他'),
  quantity: z.number().int().min(1).max(10000),
  unitMinutes: z.number().int().min(1).max(1440),
  priority: z.number().refine(value => priorityValues.has(value), '优先级只能是 0、1、2、3 或 5'),
  dailyMax: z.number().int().min(1).max(10000).optional(),
  notes: z.string().optional(), goalTitle: z.string().optional(),
  desiredDate: z.string().optional(), latestDate: z.string().optional(), preferredDate: z.string().optional(), fixedDate: z.string().optional(),
  recurring: z.boolean().default(false), recurrenceStart: z.string().optional(), recurrenceEnd: z.string().optional(),
  recurrenceWeekdays: z.array(z.number().int().min(0).max(6)).optional(),
  allowSplit: z.boolean().default(false), splitSessionMinutes: z.number().int().min(5).max(1440).optional(),
  prerequisiteGroupTitles: z.array(z.string()).optional(), countInStats: z.boolean().default(true), highIntensity: z.boolean().default(false),
})

const headerAliases: Record<IntakeImportField, string[]> = {
  title: ['任务组', '任务组名称', '名称', '标题', '任务', 'title', 'name'], subject: ['科目', '分类', 'subject', 'category'],
  quantity: ['数量', '次数', '份数', '套数', 'quantity', 'count'], unitMinutes: ['预计时长', '单项时长', '单项分钟', '分钟', '每项分钟', 'unitminutes', 'duration', 'minutes'],
  priority: ['优先级', 'priority'], dailyMax: ['每日上限', '每天最多', 'dailymax'], notes: ['备注', '说明', 'notes'],
  goalTitle: ['目标', '目标名称', 'goal', 'goalname'], desiredDate: ['期望日期', '期望完成日', '目标日期', '希望完成', 'desireddate', 'targetdate'],
  latestDate: ['最晚日期', '最晚完成日', '截止日期', '期限', 'duedate', 'latestdate', 'deadline'], preferredDate: ['偏好日期', '偏好排期日', '优先日期', '最好安排', 'preferreddate'],
  fixedDate: ['固定日期', '必须日期', '锁定日期', 'fixeddate', 'lockeddate'], recurring: ['重复', '每日重复', 'recurring'],
  recurrenceStart: ['重复开始', '开始日期', 'recurrencestart'], recurrenceEnd: ['重复结束', '结束日期', 'recurrenceend'],
  recurrenceWeekdays: ['重复星期', '星期', '每周几', 'weekdays'], allowSplit: ['允许拆分', '可拆分', 'allowsplit'],
  splitSessionMinutes: ['拆分时长', '每段分钟', '单次时长', 'splitsessionminutes'], prerequisiteGroupTitles: ['前置任务组', '前置任务', '依赖', 'prerequisites'],
  countInStats: ['计入统计', '统计', 'countinstats'], highIntensity: ['高强度', 'highintensity'],
}

function normalizedHeader(value: unknown) { return String(value ?? '').trim().toLowerCase().replace(/[\s_\-/（）()]/g, '') }
function headerKey(value: unknown): IntakeImportField | undefined {
  const normalized = normalizedHeader(value)
  return (Object.entries(headerAliases) as Array<[IntakeImportField, string[]]>).find(([, aliases]) => aliases.some(alias => normalizedHeader(alias) === normalized))?.[0]
}
function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  const matched = String(value ?? '').match(numberPattern)
  return matched ? Math.round(Number(matched[0])) : fallback
}
function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim()
  if (/^(0|false|no|n|否|禁用|不允许|不计入)$/i.test(text)) return false
  if (/^(1|true|yes|y|是|启用|允许|每天|每日|计入)$/i.test(text)) return true
  return fallback
}
function dateValue(value: unknown): string | undefined {
  if (!value) return undefined
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const rawText = String(value).trim()
  if (rawText === '今天') return todayISO()
  if (rawText === '明天') return shiftDate(todayISO(), 1)
  if (rawText === '后天') return shiftDate(todayISO(), 2)
  const text = rawText.replace(/[./年]/g, '-').replace('月', '-').replace('日', '')
  const full = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (full) {
    const normalized = `${full[1]}-${String(full[2]).padStart(2, '0')}-${String(full[3]).padStart(2, '0')}`
    return Number.isNaN(Date.parse(`${normalized}T12:00:00`)) ? undefined : normalized
  }
  const short = text.match(/^(\d{1,2})-(\d{1,2})$/)
  if (!short) return undefined
  const normalized = `${new Date().getFullYear()}-${String(short[1]).padStart(2, '0')}-${String(short[2]).padStart(2, '0')}`
  return Number.isNaN(Date.parse(`${normalized}T12:00:00`)) ? undefined : normalized
}
function weekdaysValue(value: unknown): number[] | undefined {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  const names: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
  const values = text.split(/[、,，;；|/\s]+/).flatMap(token => {
    const clean = token.replace(/^(周|星期)/, '')
    if (names[clean] !== undefined) return [names[clean]]
    const numeric = Number(clean)
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 6 ? [numeric] : []
  })
  return values.length ? Array.from(new Set(values)).sort() : undefined
}
function listValue(value: unknown): string[] | undefined {
  const values = String(value ?? '').split(/[、,，;；|\n]+/).map(item => item.trim()).filter(Boolean)
  return values.length ? Array.from(new Set(values)) : undefined
}

function emptyImportedDraft(mapped: Record<string, unknown>): TaskGroupDraft {
  const recurring = booleanValue(mapped.recurring)
  const allowSplit = !recurring && booleanValue(mapped.allowSplit)
  return {
    title: String(mapped.title ?? '').trim(), subject: String(mapped.subject ?? '其他').trim() || '其他',
    priority: numberValue(mapped.priority, 3) as Priority, unitMinutes: numberValue(mapped.unitMinutes, 30),
    activityType: recurring ? 'recurring' : 'normal', dailyMax: mapped.dailyMax === undefined || mapped.dailyMax === '' ? undefined : numberValue(mapped.dailyMax, 1),
    highIntensity: booleanValue(mapped.highIntensity), countInStats: booleanValue(mapped.countInStats, !recurring), quantity: numberValue(mapped.quantity, 1),
    notes: mapped.notes === undefined ? undefined : String(mapped.notes).trim() || undefined, goalIds: [],
    goalTitle: mapped.goalTitle === undefined ? undefined : String(mapped.goalTitle).trim() || undefined,
    desiredDate: dateValue(mapped.desiredDate), latestDate: dateValue(mapped.latestDate), preferredDate: dateValue(mapped.preferredDate), fixedDate: dateValue(mapped.fixedDate),
    recurring, recurrenceStart: dateValue(mapped.recurrenceStart), recurrenceEnd: dateValue(mapped.recurrenceEnd), recurrenceWeekdays: weekdaysValue(mapped.recurrenceWeekdays),
    allowSplit, splitSessionMinutes: allowSplit && mapped.splitSessionMinutes !== undefined && mapped.splitSessionMinutes !== '' ? numberValue(mapped.splitSessionMinutes, 30) : undefined,
    prerequisiteGroupIds: [], prerequisiteGroupTitles: listValue(mapped.prerequisiteGroupTitles),
  }
}

export function validateImportedDraft(draft: TaskGroupDraft, row: number): IntakeImportIssue[] {
  const candidate = normalizedRowSchema.safeParse(draft)
  const issues: IntakeImportIssue[] = candidate.success ? [] : candidate.error.issues.map(issue => ({ row, field: fieldLabels[issue.path[0] as IntakeImportField] ?? String(issue.path[0] ?? ''), message: issue.message }))
  if (draft.desiredDate && draft.latestDate && draft.desiredDate > draft.latestDate) issues.push({ row, field: '目标日期', message: '期望完成日不能晚于最晚完成日。' })
  if (draft.preferredDate && draft.fixedDate) issues.push({ row, field: '排期日期', message: '偏好排期日和固定排期日只能填写一个。' })
  if (draft.recurring && (!draft.recurrenceStart || !draft.recurrenceEnd)) issues.push({ row, field: '重复日期', message: '重复任务需要开始日期和结束日期。' })
  if (draft.recurring && draft.recurrenceStart && draft.recurrenceEnd && draft.recurrenceStart > draft.recurrenceEnd) issues.push({ row, field: '重复日期', message: '重复开始不能晚于重复结束。' })
  if (draft.allowSplit && draft.splitSessionMinutes && draft.splitSessionMinutes >= draft.unitMinutes) issues.push({ row, field: '每段分钟', message: '每段分钟必须小于单项分钟。' })
  return issues
}

function parseMappedRow(mapped: Record<string, unknown>, row: number): IntakeImportReviewRow {
  const draft = emptyImportedDraft(mapped)
  const issues = validateImportedDraft(draft, row)
  const dateFields: Array<[IntakeImportField, string]> = [['desiredDate', '期望完成日'], ['latestDate', '最晚完成日'], ['preferredDate', '偏好排期日'], ['fixedDate', '固定排期日'], ['recurrenceStart', '重复开始'], ['recurrenceEnd', '重复结束']]
  for (const [field, label] of dateFields) if (mapped[field] && !dateValue(mapped[field])) issues.push({ row, field: label, message: '请使用 YYYY-MM-DD、M月D日或“今天/明天”。' })
  for (const field of ['quantity', 'unitMinutes', 'priority', 'dailyMax', 'splitSessionMinutes'] as IntakeImportField[]) {
    const raw = mapped[field]
    if (raw !== undefined && raw !== '' && typeof raw !== 'number' && !numberPattern.test(String(raw))) issues.push({ row, field: fieldLabels[field], message: '请输入数字。' })
  }
  return { sourceRow: row, draft, issues }
}

export function rebuildImportResult(result: IntakeImportResult, reviewRows: IntakeImportReviewRow[]): IntakeImportResult {
  const issues = reviewRows.flatMap(item => item.issues)
  return { ...result, reviewRows, drafts: reviewRows.filter(item => !item.issues.length).map(item => item.draft), issues, skippedRows: reviewRows.filter(item => item.issues.length).length }
}

export function remapIntakeTable(table: IntakeImportTable, mapping: Array<IntakeImportField | 'ignore'>): IntakeImportResult {
  const mappedTable = { ...table, mapping }
  const reviewRows = table.rows.map((row, index) => {
    const mapped: Record<string, unknown> = {}
    mapping.forEach((field, column) => { if (field !== 'ignore') mapped[field] = row[column] })
    return parseMappedRow(mapped, index + (table.hasHeader ? 2 : 1))
  })
  return rebuildImportResult({ drafts: [], issues: [], skippedRows: 0, table: mappedTable, reviewRows }, reviewRows)
}

export function parseTableRows(rows: unknown[][]): IntakeImportResult {
  const nonEmpty = rows.filter(row => row.some(cell => String(cell ?? '').trim()))
  if (!nonEmpty.length) return { drafts: [], issues: [{ row: 1, message: '没有识别到可导入内容。' }], skippedRows: 0 }
  const autoMapping = nonEmpty[0].map(headerKey)
  const hasHeader = autoMapping.includes('title')
  const dataRows = hasHeader ? nonEmpty.slice(1) : nonEmpty
  const defaultFields: IntakeImportField[] = ['title', 'subject', 'quantity', 'unitMinutes', 'priority', 'dailyMax', 'notes']
  const table: IntakeImportTable = {
    headers: hasHeader ? nonEmpty[0].map(cell => String(cell ?? '').trim() || '未命名列') : nonEmpty[0].map((_, index) => `第 ${index + 1} 列`),
    rows: dataRows,
    mapping: hasHeader ? autoMapping.map(item => item ?? 'ignore') : nonEmpty[0].map((_, index) => defaultFields[index] ?? 'ignore'),
    hasHeader,
  }
  return remapIntakeTable(table, table.mapping)
}

export function parseCsvText(text: string): unknown[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (!quoted && (char === ',' || char === '\t')) { row.push(cell); cell = ''; continue }
    if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && text[index + 1] === '\n') index += 1; row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ''; continue }
    cell += char
  }
  row.push(cell); if (row.some(value => value.trim())) rows.push(row)
  return rows
}

function freeformDraft(line: string): TaskGroupDraft | undefined {
  const clean = line.replace(/^[-*•\d.、)）\s]+/, '').trim(); if (!clean) return undefined
  const minutes = numberValue(clean.match(/(?:每(?:套|项|次)?|单次)?\s*(\d+)\s*分钟/)?.[1], 30)
  const quantityMatch = clean.match(/(\d+)\s*(?:项|次|份|套|个|篇|章|节|张|组)/); const quantity = quantityMatch ? numberValue(quantityMatch[1], 1) : 1
  const recurring = /每天|每日|天天/.test(clean); const dateToken = '(?:今天|明天|后天|\\d{4}[./年-]\\d{1,2}[./月-]\\d{1,2}日?|\\d{1,2}[./月-]\\d{1,2}日?)'
  const latestDateText = clean.match(new RegExp(`(?:最晚|截止|期限|到)?\\s*(${dateToken})(?:前|之前)`))?.[1] ?? clean.match(new RegExp(`(?:最晚|截止|期限|到)\\s*(${dateToken})`))?.[1]
  const desiredDateText = clean.match(new RegExp(`(?:期望|希望|目标)\\s*(${dateToken})`))?.[1]
  const preferredDateText = clean.match(new RegExp(`(?:偏好|优先|最好)\\s*(?:安排在)?\\s*(${dateToken})`))?.[1]
  const fixedDateText = clean.match(new RegExp(`(?:固定|必须|锁定)\\s*(?:安排在)?\\s*(${dateToken})`))?.[1]
  const desiredDate = dateValue(desiredDateText); const latestDate = dateValue(latestDateText); const preferredDate = dateValue(preferredDateText); const fixedDate = dateValue(fixedDateText)
  const subject = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'].find(item => clean.includes(item)) ?? '其他'
  const title = clean.replace(/(?:每(?:套|项|次)?|单次)?\s*\d+\s*分钟/g, '').replace(/\d+\s*(?:项|次|份|套|个|篇|章|节|张|组)/g, '')
    .replace(/(?:最晚|截止|期限|持续|期望|希望|目标|偏好|优先|最好|固定|必须|锁定|安排在|到)?\s*(?:\d{4}[./年-])?\d{1,2}[./月-]\d{1,2}日?(?:前|之前)?/g, '')
    .replace(/(?:最晚|截止|期限|持续|期望|希望|目标|偏好|优先|最好|固定|必须|锁定|安排在|到)?\s*(?:今天|明天|后天)(?:前|之前)?/g, '')
    .replace(/每天|每日|天天/g, '').replace(/[，,；;]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!title) return undefined
  return { title, subject, priority: 3, unitMinutes: minutes, activityType: recurring ? 'recurring' : 'normal', highIntensity: false, countInStats: !recurring, quantity, goalIds: [], recurring, desiredDate, latestDate: latestDate ?? desiredDate, preferredDate, fixedDate, allowSplit: false, prerequisiteGroupIds: [] }
}

export function parsePastedText(text: string): IntakeImportResult {
  const rows = parseCsvText(text); if (rows.some(row => row.length > 1)) return parseTableRows(rows)
  const reviewRows = text.split(/\r?\n/).flatMap((line, index) => { const draft = freeformDraft(line); return draft ? [{ sourceRow: index + 1, draft, issues: validateImportedDraft(draft, index + 1) }] : [] })
  if (!reviewRows.length) return { drafts: [], issues: [{ row: 1, message: '没有识别到任务。可以每行写一个任务，或粘贴带表头的表格。' }], skippedRows: text.split(/\r?\n/).filter(Boolean).length }
  return rebuildImportResult({ drafts: [], issues: [], skippedRows: 0, reviewRows }, reviewRows)
}

export async function readIntakeFile(file: File): Promise<IntakeImportResult> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return parseTableRows(parseCsvText(await file.text()))
  if (lower.endsWith('.xlsx')) { const module = await import('read-excel-file/browser'); return parseTableRows(await module.readSheet(file) as unknown[][]) }
  return { drafts: [], issues: [{ row: 1, message: '仅支持 TXT、CSV、TSV 或 XLSX 任务清单。' }], skippedRows: 0 }
}

export function buildIntakeCsvTemplate() {
  const rows = [
    ['任务组名称','科目','数量','单项分钟','优先级','每日上限','目标名称','期望完成日','最晚完成日','偏好排期日','固定排期日','重复','重复开始','重复结束','重复星期','允许拆分','每段分钟','前置任务组','计入统计','高强度','备注'],
    ['数学套卷','数学','4','90','5','1','阶段测验准备','2026-08-20','2026-08-24','','','否','','','','是','45','','是','是','每套可以拆成两段'],
    ['英语早读','英语','1','25','3','','','','','','','是','2026-08-10','2026-08-31','一,三,五','否','','','否','否','重复任务通常不计入正式计划统计'],
    ['模拟考试','综合','1','120','5','','','','','',todayISO(),'否','','','','否','','数学套卷','是','是','固定日期会锁定排期'],
  ]
  return `\uFEFF${rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')}`
}

export function intakeDraftIssues(draft: TaskGroupDraft, state: AppState): string[] {
  const issues = validateImportedDraft(draft, 0).map(item => item.message)
  if (draft.goalIds.some(id => !state.goals.some(goal => goal.id === id))) issues.push('关联目标已不存在')
  if ((draft.prerequisiteGroupIds ?? []).some(id => !state.taskGroups.some(group => group.id === id))) issues.push('前置任务组已不存在')
  return Array.from(new Set(issues))
}

export function intakeDraftSignature(draft: Pick<TaskGroupDraft, 'title' | 'subject' | 'unitMinutes' | 'quantity'>) { return `${draft.subject.trim().toLowerCase()}|${draft.title.trim().toLowerCase()}|${Math.round(draft.unitMinutes)}|${Math.round(draft.quantity)}` }

export function splitSessionCount(draft: Pick<TaskGroupDraft, 'quantity' | 'unitMinutes' | 'allowSplit' | 'splitSessionMinutes'>) {
  return draft.allowSplit && draft.splitSessionMinutes && draft.splitSessionMinutes < draft.unitMinutes ? draft.quantity * Math.ceil(draft.unitMinutes / draft.splitSessionMinutes) : draft.quantity
}

export function intakeSummary(items: IntakeTaskGroupDraft[]) {
  const pending = items.filter(item => !item.appliedAt)
  return {
    groupCount: pending.length,
    assignmentCount: pending.reduce((sum, item) => sum + (item.recurring ? 0 : splitSessionCount(item)), 0),
    minutes: pending.reduce((sum, item) => {
      if (!item.recurring) return sum + item.quantity * item.unitMinutes
      if (!item.recurrenceStart || !item.recurrenceEnd) return sum
      return sum + dateRange(item.recurrenceStart, item.recurrenceEnd).filter(date => !item.recurrenceWeekdays?.length || item.recurrenceWeekdays.includes(new Date(`${date}T12:00:00`).getDay())).length * item.unitMinutes
    }, 0),
  }
}
