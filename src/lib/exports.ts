import type { AppState, Assignment, TaskGroup } from '../types'
import { dateRange, dayTypeLabel, fmtWeekday, getCapacity, getDayConfig, shiftDate } from './date'
import { aggregateDaily } from './stats'

export interface ExportRange {
  start: string
  end: string
}

const taskStatusLabel: Record<Assignment['status'], string> = {
  todo: '未完成',
  partial: '部分完成',
  done: '已完成',
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(rows: unknown[][]) {
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function activeGroupMap(state: AppState) {
  return new Map(state.taskGroups.filter(group => !group.hidden).map(group => [group.id, group]))
}

function assignmentsInRange(state: AppState, range: ExportRange) {
  const groups = activeGroupMap(state)
  return state.assignments
    .filter(item => item.scheduledDate && item.scheduledDate >= range.start && item.scheduledDate <= range.end && groups.has(item.groupId))
    .sort((a, b) => (a.scheduledDate ?? '').localeCompare(b.scheduledDate ?? '') || a.title.localeCompare(b.title))
}

export function buildCalendarCsv(state: AppState, range: ExportRange) {
  const groups = activeGroupMap(state)
  const byDate = new Map<string, Assignment[]>()
  for (const assignment of assignmentsInRange(state, range)) {
    const date = assignment.scheduledDate!
    byDate.set(date, [...(byDate.get(date) ?? []), assignment])
  }
  const rows: unknown[][] = [[
    '日期', '星期', '日期类型', '容量分钟', '当日计划分钟', '任务数',
    '科目', '任务组', '任务', '预计分钟', '进度', '状态', '是否锁定', '备注',
  ]]
  for (const date of dateRange(range.start, range.end)) {
    const assignments = byDate.get(date) ?? []
    const plannedMinutes = assignments.reduce((sum, item) => sum + item.estimatedMinutes, 0)
    const config = getDayConfig(state, date)
    if (!assignments.length) {
      rows.push([date, fmtWeekday(date), dayTypeLabel[config.type], getCapacity(state, date), 0, 0, '', '', '', '', '', '', '', config.note ?? ''])
      continue
    }
    for (const assignment of assignments) {
      const group = groups.get(assignment.groupId)
      rows.push([
        date,
        fmtWeekday(date),
        dayTypeLabel[config.type],
        getCapacity(state, date),
        plannedMinutes,
        assignments.length,
        group?.subject ?? '其他',
        group?.title ?? '',
        assignment.title,
        assignment.estimatedMinutes,
        `${Math.round(assignment.progress)}%`,
        taskStatusLabel[assignment.status],
        assignment.locked ? '是' : '否',
        assignment.notes ?? group?.notes ?? '',
      ])
    }
  }
  return toCsv(rows)
}

function icsEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function icsDate(value: string) {
  return value.replace(/-/g, '')
}

function foldIcsLine(line: string) {
  const parts: string[] = []
  let remaining = line
  while (remaining.length > 74) {
    parts.push(remaining.slice(0, 74))
    remaining = ` ${remaining.slice(74)}`
  }
  parts.push(remaining)
  return parts.join('\r\n')
}

export function buildCalendarIcs(state: AppState, range: ExportRange, generatedAt = new Date()) {
  const groups = activeGroupMap(state)
  const stamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Study Planner//Calendar Export//ZH-CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(state.settings.planName)}`,
  ]
  for (const assignment of assignmentsInRange(state, range)) {
    const group = groups.get(assignment.groupId)
    const date = assignment.scheduledDate!
    const description = [
      `任务组：${group?.title ?? '未分组'}`,
      `科目：${group?.subject ?? '其他'}`,
      `预计：${assignment.estimatedMinutes} 分钟`,
      `状态：${taskStatusLabel[assignment.status]}`,
      assignment.notes || group?.notes ? `备注：${assignment.notes ?? group?.notes}` : '',
    ].filter(Boolean).join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsEscape(assignment.id)}@study-planner`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(date)}`,
      `DTEND;VALUE=DATE:${icsDate(shiftDate(date, 1))}`,
      `SUMMARY:${icsEscape(assignment.title)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `CATEGORIES:${icsEscape(group?.subject ?? '其他')}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

export function buildStatisticsCsv(state: AppState, range: ExportRange) {
  const groups = activeGroupMap(state)
  const rows = aggregateDaily(state.assignments, groups, state.settings.countWordsTime, range.start, range.end, state.dailyPlanBaselines)
  return toCsv([
    ['日期', '星期', '原计划分钟', '实际分钟', '计划外实际分钟', '计时器分钟', '手动记录分钟', '计划任务数', '完成任务数', '部分完成数', '任务完成率', '工作量完成率', '逾期任务数', '专注次数', '7日实际均值'],
    ...rows.map(row => [
      row.date,
      fmtWeekday(row.date),
      row.planned,
      row.actual,
      row.extraActual,
      row.timerActual,
      row.manualActual,
      row.plannedTasks,
      row.doneTasks,
      row.partialTasks,
      `${Math.round(row.taskCompletion * 10) / 10}%`,
      `${Math.round(row.workloadCompletion * 10) / 10}%`,
      row.lateTasks,
      row.focusSessions,
      row.movingAverage,
    ]),
  ])
}

function entryDate(value?: string) {
  const date = value?.slice(0, 10)
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined
}

function sourceLabel(source?: string) {
  return source === 'timer' ? '计时器' : source === 'finish' ? '完成时记录' : source === 'inferred' ? '推断记录' : source === 'manual' ? '手动补录' : '旧数据折算'
}

export function buildTimeLedgerCsv(state: AppState, range: ExportRange) {
  const groups = activeGroupMap(state)
  const rows: unknown[][] = [['归属日期', '任务', '任务组', '科目', '分钟', '来源', '创建时间', '修改时间', '记录ID']]
  for (const assignment of state.assignments) {
    const group = groups.get(assignment.groupId)
    if (!group) continue
    let recorded = 0
    for (const entry of assignment.timeEntries ?? []) {
      const date = entryDate(entry.createdAt)
      const minutes = Math.max(0, Number(entry.minutes) || 0)
      recorded += minutes
      if (!date || date < range.start || date > range.end || minutes <= 0) continue
      rows.push([date, assignment.title, group.title, group.subject, minutes, sourceLabel(entry.source), entry.originalCreatedAt ?? entry.createdAt, entry.updatedAt ?? '', entry.id])
    }
    const residual = Math.max(0, assignment.actualMinutes - recorded)
    const residualDate = entryDate(assignment.completedAt) ?? assignment.scheduledDate
    if (residual > 0 && residualDate && residualDate >= range.start && residualDate <= range.end) {
      rows.push([residualDate, assignment.title, group.title, group.subject, residual, sourceLabel(), assignment.completedAt ?? '', '', 'legacy-residual'])
    }
  }
  rows.splice(1, rows.length - 1, ...rows.slice(1).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))))
  return toCsv(rows)
}

function html(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
}

export function buildPrintableReportHtml(state: AppState, range: ExportRange) {
  const groups = activeGroupMap(state)
  const daily = aggregateDaily(state.assignments, groups, state.settings.countWordsTime, range.start, range.end, state.dailyPlanBaselines)
  const assignments = assignmentsInRange(state, range)
  const planned = daily.reduce((sum, row) => sum + row.planned, 0)
  const actual = daily.reduce((sum, row) => sum + row.actual, 0)
  const completed = assignments.filter(item => item.status === 'done').length
  const generatedAt = new Date().toLocaleString('zh-CN')
  const dailyRows = daily.map(row => `<tr><td>${html(row.date)}</td><td>${html(fmtWeekday(row.date))}</td><td>${row.planned}</td><td>${row.actual}</td><td>${Math.round(row.taskCompletion)}%</td><td>${row.lateTasks}</td></tr>`).join('')
  const taskRows = assignments.map(item => {
    const group = groups.get(item.groupId)
    return `<tr><td>${html(item.scheduledDate)}</td><td>${html(item.title)}</td><td>${html(group?.subject ?? '其他')}</td><td>${item.estimatedMinutes}</td><td>${html(taskStatusLabel[item.status])}</td></tr>`
  }).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(state.settings.planName)} 学习报告</title><style>
  :root{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#172033;background:#fff}*{box-sizing:border-box}body{margin:0 auto;max-width:1040px;padding:36px}header{border-bottom:2px solid #2563eb;padding-bottom:18px;margin-bottom:24px}h1{font-size:28px;margin:0 0 8px}p{color:#667085;margin:4px 0}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.summary div{border:1px solid #dfe5ee;border-radius:12px;padding:14px}.summary span{display:block;color:#667085;font-size:12px}.summary strong{display:block;font-size:20px;margin-top:5px}h2{font-size:18px;margin:28px 0 10px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e4e9f0;padding:9px 8px;text-align:left}th{background:#f4f7fb;color:#526176}.privacy{margin-top:24px;padding:12px;border-radius:10px;background:#f4f7fb;font-size:11px}@media print{body{padding:0}.no-print{display:none}thead{display:table-header-group}.summary div{break-inside:avoid}}@media(max-width:700px){body{padding:20px}.summary{grid-template-columns:1fr 1fr}.table-wrap{overflow:auto}}
  </style></head><body><header><h1>${html(state.settings.planName)} 学习报告</h1><p>${html(range.start)} 至 ${html(range.end)}</p><p>生成时间：${html(generatedAt)}</p></header><section class="summary"><div><span>原计划</span><strong>${planned} 分钟</strong></div><div><span>已发生实际</span><strong>${actual} 分钟</strong></div><div><span>范围内任务</span><strong>${assignments.length} 项</strong></div><div><span>当前已完成</span><strong>${completed} 项</strong></div></section><h2>每日统计</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>星期</th><th>原计划</th><th>实际</th><th>完成率</th><th>逾期</th></tr></thead><tbody>${dailyRows}</tbody></table></div><h2>月历任务</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>任务</th><th>科目</th><th>预计分钟</th><th>状态</th></tr></thead><tbody>${taskRows || '<tr><td colspan="5">这个范围没有已排期任务。</td></tr>'}</tbody></table></div><p class="privacy">报告可能包含个人任务、目标和学习记录。分享前请先检查内容。</p></body></html>`
}

export function exportRangeSummary(state: AppState, range: ExportRange) {
  const groups = activeGroupMap(state)
  const daily = aggregateDaily(state.assignments, groups, state.settings.countWordsTime, range.start, range.end, state.dailyPlanBaselines)
  const assignments = assignmentsInRange(state, range)
  return {
    days: dateRange(range.start, range.end).length,
    assignments: assignments.length,
    plannedMinutes: daily.reduce((sum, row) => sum + row.planned, 0),
    actualMinutes: daily.reduce((sum, row) => sum + row.actual, 0),
    timeEntries: state.assignments.reduce((sum, assignment) => sum + (assignment.timeEntries ?? []).filter(entry => {
      const date = entryDate(entry.createdAt)
      return Boolean(date && date >= range.start && date <= range.end)
    }).length, 0),
  }
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeExportName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || 'study-planner'
}
