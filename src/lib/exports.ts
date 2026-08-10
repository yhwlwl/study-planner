import type { AppState, Assignment, TaskGroup } from '../types'
import { dateRange, dayTypeLabel, fmtDate, fmtWeekday, getCapacity, getDayConfig, minutesText, shiftDate, todayISO } from './date'
import { aggregateDaily } from './stats'
import { allGoalProgress } from './goals'
import { allDurationSuggestions } from './planner'

export interface ExportRange {
  start: string
  end: string
}

export interface StatisticsReportSections {
  overview: boolean
  daily: boolean
  completion: boolean
  focus: boolean
  subjects: boolean
  accuracy: boolean
  insights: boolean
  heatmap: boolean
  goals: boolean
  quality: boolean
  details: boolean
  ledger: boolean
}

export const defaultStatisticsReportSections: StatisticsReportSections = {
  overview: true,
  daily: true,
  completion: true,
  focus: true,
  subjects: true,
  accuracy: true,
  insights: true,
  heatmap: true,
  goals: true,
  quality: true,
  details: true,
  ledger: true,
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

const subjectSvgColors: Record<string, string> = {
  语文: '#8b5cf6', 数学: '#2563eb', 英语: '#f59e0b', 物理: '#0891b2',
  化学: '#16a34a', 生物: '#db2777', 其他: '#64748b'
}

function xml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!))
}

function shortText(value: unknown, maxLength: number) {
  const text = String(value ?? '')
  return Array.from(text).length > maxLength ? `${Array.from(text).slice(0, maxLength).join('')}…` : text
}

export function monthExportRange(month: string): ExportRange {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  const now = new Date()
  const year = Number(match?.[1] ?? now.getFullYear())
  const monthNumber = Number(match?.[2] ?? now.getMonth() + 1)
  const safeMonth = Math.max(1, Math.min(12, monthNumber))
  const lastDay = new Date(Date.UTC(year, safeMonth, 0)).getUTCDate()
  const prefix = `${String(year).padStart(4, '0')}-${String(safeMonth).padStart(2, '0')}`
  return { start: `${prefix}-01`, end: `${prefix}-${String(lastDay).padStart(2, '0')}` }
}

/**
 * Build the same month view users see in the app as a standalone SVG.
 * It is deliberately dependency-free so PNG export stays local and works
 * offline on both desktop and mobile browsers.
 */
export function buildCalendarSvg(state: AppState, month: string, options: { showAllTasks?: boolean } = {}) {
  const range = monthExportRange(month)
  const groups = activeGroupMap(state)
  const assignments = assignmentsInRange(state, range)
  const byDate = new Map<string, Assignment[]>()
  for (const assignment of assignments) {
    const date = assignment.scheduledDate!
    byDate.set(date, [...(byDate.get(date) ?? []), assignment])
  }
  const year = Number(range.start.slice(0, 4))
  const monthNumber = Number(range.start.slice(5, 7))
  const daysInMonth = Number(range.end.slice(8, 10))
  const leadingBlanks = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
  const rowCount = Math.ceil((leadingBlanks + daysInMonth) / 7)
  const width = 1600
  const margin = 32
  const headerHeight = 112
  const weekdayHeight = 42
  const showAllTasks = options.showAllTasks ?? true
  const rowHeights = Array.from({ length: rowCount }, (_, row) => {
    if (!showAllTasks) return 176
    const maxTasks = Math.max(0, ...Array.from({ length: 7 }, (_, column) => {
      const dayNumber = row * 7 + column - leadingBlanks + 1
      if (dayNumber < 1 || dayNumber > daysInMonth) return 0
      const date = `${range.start.slice(0, 8)}${String(dayNumber).padStart(2, '0')}`
      return byDate.get(date)?.length ?? 0
    }))
    return Math.max(176, 88 + maxTasks * 25 + 32)
  })
  const rowOffsets = rowHeights.reduce<number[]>((offsets, height, index) => {
    offsets.push((offsets[index - 1] ?? 0) + height)
    return offsets
  }, [])
  const gridWidth = width - margin * 2
  const cellWidth = gridWidth / 7
  const height = margin + headerHeight + weekdayHeight + (rowOffsets[rowOffsets.length - 1] ?? 0) + margin
  const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const cells: string[] = []

  for (let index = 0; index < rowCount * 7; index += 1) {
    const dayNumber = index - leadingBlanks + 1
    const row = Math.floor(index / 7)
    const column = index % 7
    const x = margin + column * cellWidth
    const y = margin + headerHeight + weekdayHeight + (rowOffsets[row - 1] ?? 0)
    const cellHeight = rowHeights[row]
    const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth
    const date = inMonth ? `${range.start.slice(0, 8)}${String(dayNumber).padStart(2, '0')}` : ''
    const tasks = date ? byDate.get(date) ?? [] : []
    const config = date && date >= state.settings.startDate && date <= state.settings.endDate ? getDayConfig(state, date) : undefined
    const capacity = config ? getCapacity(state, date) : 0
    const load = tasks.reduce((sum, task) => sum + Math.max(0, task.estimatedMinutes), 0)
    const ratio = capacity > 0 ? load / capacity : 0
    const fill = !inMonth ? '#f8fafc' : config?.type === 'travel' ? '#f7f7f7' : config?.isBufferDay ? '#fffaf0' : '#ffffff'
    const border = ratio > 1 ? '#ef4444' : ratio > .8 ? '#f59e0b' : '#dfe6ef'
    cells.push(`<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${fill}" stroke="${border}" stroke-width="${ratio > .8 ? 2 : 1}"/>`)
    if (!inMonth) continue
    cells.push(`<text x="${x + 15}" y="${y + 28}" font-size="20" font-weight="750" fill="#172033">${dayNumber}</text>`)
    const typeLabel = config?.isBufferDay ? `缓冲 · ${minutesText(config.availableMinutes ?? capacity)}` : config ? dayTypeLabel[config.type] : '计划外'
    cells.push(`<text x="${x + cellWidth - 15}" y="${y + 26}" text-anchor="end" font-size="11" fill="#718096">${xml(typeLabel)}</text>`)
    if (capacity > 0) {
      const barWidth = Math.max(0, cellWidth - 30)
      const visibleWidth = Math.min(barWidth, barWidth * ratio)
      const barColor = ratio > 1 ? '#ef4444' : ratio > .8 ? '#f59e0b' : '#2563eb'
      cells.push(`<rect x="${x + 15}" y="${y + 42}" width="${barWidth}" height="5" rx="2.5" fill="#edf1f5"/><rect x="${x + 15}" y="${y + 42}" width="${visibleWidth}" height="5" rx="2.5" fill="${barColor}"/>`)
      cells.push(`<text x="${x + 15}" y="${y + 65}" font-size="11" fill="#718096">计划 ${xml(minutesText(load))} / ${xml(minutesText(capacity))}</text>`)
    } else {
      cells.push(`<text x="${x + 15}" y="${y + 65}" font-size="11" fill="#9aa6b6">没有可用容量</text>`)
    }
    const visibleTasks = showAllTasks ? tasks : tasks.slice(0, 6)
    visibleTasks.forEach((task, taskIndex) => {
      const group = groups.get(task.groupId)
      const taskY = y + 88 + taskIndex * 25
      const color = subjectSvgColors[group?.subject ?? '其他'] ?? subjectSvgColors.其他
      const opacity = task.status === 'done' ? '.52' : '1'
      cells.push(`<circle cx="${x + 18}" cy="${taskY - 4}" r="4" fill="${color}" opacity="${opacity}"/><text x="${x + 29}" y="${taskY}" font-size="12" fill="#26344b" opacity="${opacity}">${xml(shortText(task.title, 25))}</text><text x="${x + cellWidth - 15}" y="${taskY}" text-anchor="end" font-size="10" fill="#8491a4" opacity="${opacity}">${task.estimatedMinutes}分</text>`)
    })
    if (!showAllTasks && tasks.length > visibleTasks.length) cells.push(`<text x="${x + 15}" y="${y + cellHeight - 14}" font-size="10" fill="#2563eb">+${tasks.length - visibleTasks.length} 项，详见明细</text>`)
  }

  const weekdays = weekdayLabels.map((label, index) => {
    const x = margin + index * cellWidth + cellWidth / 2
    return `<text x="${x}" y="${margin + headerHeight + 27}" text-anchor="middle" font-size="13" font-weight="700" fill="#68758a">${label}</text>`
  }).join('')
  const legend = Object.entries(subjectSvgColors).map(([subject, color], index) => {
    const x = margin + index * 105
    return `<circle cx="${x}" cy="${margin + 91}" r="5" fill="${color}"/><text x="${x + 10}" y="${margin + 95}" font-size="11" fill="#68758a">${xml(subject)}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(year)}年${monthNumber}月学习月历"><rect width="100%" height="100%" fill="#ffffff"/><text x="${margin}" y="${margin + 34}" font-size="30" font-weight="800" fill="#172033">${year}年${monthNumber}月学习月历</text><text x="${margin}" y="${margin + 62}" font-size="13" fill="#68758a">${xml(state.settings.planName)} · 计划安排与每日容量</text>${legend}<rect x="${margin}" y="${margin + headerHeight}" width="${gridWidth}" height="${weekdayHeight}" fill="#f8fafc" stroke="#dfe6ef"/>${weekdays}${cells}</svg>`
}

function downloadBlobFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadSvgAsPng(filename: string, svg: string) {
  return new Promise<boolean>((resolve, reject) => {
    const match = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg)
    const width = Number(match?.[1] ?? 1600)
    const height = Number(match?.[2] ?? 1200)
    const scale = 2
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width * scale
        canvas.height = height * scale
        const context = canvas.getContext('2d')
        if (!context) throw new Error('当前浏览器不支持图片导出。')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          if (!blob) {
            reject(new Error('图片生成失败。'))
            return
          }
          downloadBlobFile(filename, blob)
          resolve(true)
        }, 'image/png')
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片生成失败。'))
    }
    image.src = url
  })
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

interface ExportSubjectSummary {
  subject: string
  planned: number
  actual: number
  total: number
  done: number
  completedEquivalent: number
  accuracy?: number
  sampleSize: number
  groups: Array<{
    id: string
    title: string
    planned: number
    actual: number
    total: number
    done: number
    accuracy?: number
    sampleSize: number
  }>
}

function progressForExport(assignment?: Assignment) {
  if (!assignment) return 0
  if (assignment.status === 'done') return 1
  if (assignment.status === 'partial') return Math.max(0, Math.min(1, assignment.progress / 100))
  return 0
}

function isCountedForExport(group: TaskGroup | undefined, countWordsTime: boolean) {
  return Boolean(group && !group.hidden && (group.countInStats || countWordsTime))
}

function subjectSummaryForExport(state: AppState, range: ExportRange) {
  const groups = activeGroupMap(state)
  const assignmentById = new Map(state.assignments.map(assignment => [assignment.id, assignment]))
  const capturedDates = new Set(state.dailyPlanBaselines.filter(item => item.date >= range.start && item.date <= range.end).map(item => item.date))
  const bySubject = new Map<string, ExportSubjectSummary>()
  const ensure = (subject: string) => {
    const current = bySubject.get(subject)
    if (current) return current
    const created: ExportSubjectSummary = { subject, planned: 0, actual: 0, total: 0, done: 0, completedEquivalent: 0, sampleSize: 0, groups: [] }
    bySubject.set(subject, created)
    return created
  }
  const ensureGroup = (summary: ExportSubjectSummary, group: TaskGroup) => {
    const current = summary.groups.find(item => item.id === group.id)
    if (current) return current
    const created = { id: group.id, title: group.title, planned: 0, actual: 0, total: 0, done: 0, sampleSize: 0 }
    summary.groups.push(created)
    return created
  }

  // 任务数和完成数沿用统计页口径：展示当前科目下的全部任务，
  // 但计划分钟和实际分钟仍只统计被纳入统计的任务组。
  for (const assignment of state.assignments) {
    const group = groups.get(assignment.groupId)
    if (!group) continue
    const summary = ensure(group.subject)
    const groupSummary = ensureGroup(summary, group)
    summary.total += 1
    summary.done += assignment.status === 'done' ? 1 : 0
    summary.completedEquivalent += progressForExport(assignment)
    groupSummary.total += 1
    groupSummary.done += assignment.status === 'done' ? 1 : 0
  }

  const plannedItems: Array<{ assignment?: Assignment; groupId: string; date: string; minutes: number }> = []
  for (const baseline of state.dailyPlanBaselines) {
    if (!capturedDates.has(baseline.date)) continue
    for (const item of baseline.assignments) plannedItems.push({ assignment: assignmentById.get(item.assignmentId), groupId: item.groupId, date: baseline.date, minutes: item.estimatedMinutes })
  }
  for (const assignment of state.assignments) {
    if (!assignment.scheduledDate || assignment.scheduledDate < range.start || assignment.scheduledDate > range.end || capturedDates.has(assignment.scheduledDate)) continue
    plannedItems.push({ assignment, groupId: assignment.groupId, date: assignment.scheduledDate, minutes: assignment.estimatedMinutes })
  }
  for (const item of plannedItems) {
    const group = groups.get(item.groupId)
    if (!isCountedForExport(group, state.settings.countWordsTime)) continue
    const summary = ensure(group!.subject)
    const groupSummary = ensureGroup(summary, group!)
    summary.planned += Math.max(0, item.minutes)
    groupSummary.planned += Math.max(0, item.minutes)
  }
  for (const assignment of state.assignments) {
    const group = groups.get(assignment.groupId)
    if (!isCountedForExport(group, state.settings.countWordsTime)) continue
    let recorded = 0
    for (const entry of assignment.timeEntries ?? []) {
      const date = entryDate(entry.createdAt)
      const minutes = Math.max(0, Number(entry.minutes) || 0)
      recorded += minutes
      if (date && date >= range.start && date <= range.end) {
        ensure(group!.subject).actual += minutes
        ensureGroup(ensure(group!.subject), group!).actual += minutes
      }
    }
    const residual = Math.max(0, assignment.actualMinutes - recorded)
    const residualDate = entryDate(assignment.completedAt) ?? assignment.scheduledDate
    if (residual > 0 && residualDate && residualDate >= range.start && residualDate <= range.end) {
      ensure(group!.subject).actual += residual
      ensureGroup(ensure(group!.subject), group!).actual += residual
    }
  }

  for (const summary of bySubject.values()) {
    const subjectItems = state.assignments.filter(assignment => groups.get(assignment.groupId)?.subject === summary.subject)
    const completed = subjectItems.filter(assignment => {
      const group = groups.get(assignment.groupId)
      return Boolean(group && isCountedForExport(group, state.settings.countWordsTime) && assignment.status === 'done' && assignment.actualMinutes > 0)
    })
    const estimated = completed.reduce((sum, assignment) => sum + Math.max(0, assignment.estimatedMinutes), 0)
    const actual = completed.reduce((sum, assignment) => sum + Math.max(0, assignment.actualMinutes), 0)
    summary.sampleSize = completed.length
    summary.accuracy = completed.length >= 3 && estimated > 0 ? (actual - estimated) / estimated * 100 : undefined
    for (const groupSummary of summary.groups) {
      const groupItems = subjectItems.filter(assignment => assignment.groupId === groupSummary.id)
      const groupCompleted = groupItems.filter(assignment => assignment.status === 'done' && assignment.actualMinutes > 0)
      const groupEstimated = groupCompleted.reduce((sum, assignment) => sum + Math.max(0, assignment.estimatedMinutes), 0)
      const groupActual = groupCompleted.reduce((sum, assignment) => sum + Math.max(0, assignment.actualMinutes), 0)
      groupSummary.sampleSize = groupCompleted.length
      groupSummary.accuracy = groupCompleted.length >= 3 && groupEstimated > 0 ? (groupActual - groupEstimated) / groupEstimated * 100 : undefined
    }
    summary.groups.sort((a, b) => b.actual - a.actual || b.planned - a.planned || a.title.localeCompare(b.title))
  }
  return [...bySubject.values()].filter(item => item.total > 0 || item.planned > 0 || item.actual > 0).sort((a, b) => b.actual - a.actual || b.planned - a.planned || a.subject.localeCompare(b.subject))
}

function dailyChartSvg(rows: ReturnType<typeof aggregateDaily>) {
  const width = 1000
  const height = 310
  const left = 58
  const right = 20
  const top = 28
  const bottom = 54
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const max = Math.max(60, ...rows.flatMap(row => [row.planned, row.actual, row.movingAverage]))
  const slot = chartWidth / Math.max(rows.length, 1)
  const barWidth = Math.max(2, Math.min(18, slot * .58))
  const y = (value: number) => top + chartHeight - (value / max) * chartHeight
  const bars = rows.map((row, index) => {
    const x = left + index * slot + (slot - barWidth) / 2
    const actualY = y(row.actual)
    return `<rect x="${x.toFixed(1)}" y="${actualY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, top + chartHeight - actualY).toFixed(1)}" rx="3" fill="#2563eb"/><line x1="${(x - 2).toFixed(1)}" x2="${(x + barWidth + 2).toFixed(1)}" y1="${y(row.planned).toFixed(1)}" y2="${y(row.planned).toFixed(1)}" stroke="#94a3b8" stroke-width="2"/>`
  }).join('')
  const movingPoints = rows.map((row, index) => `${(left + index * slot + slot / 2).toFixed(1)},${y(row.movingAverage).toFixed(1)}`).join(' ')
  const labels = rows.map((row, index) => {
    const step = Math.max(1, Math.ceil(rows.length / 10))
    if (index % step !== 0 && index !== rows.length - 1) return ''
    return `<text x="${(left + index * slot + slot / 2).toFixed(1)}" y="${height - 24}" text-anchor="middle" font-size="10" fill="#718096">${xml(row.shortLabel)}</text>`
  }).join('')
  const guides = [0, .5, 1].map(ratio => {
    const value = Math.round(max * ratio)
    const yy = y(value)
    return `<line x1="${left}" x2="${width - right}" y1="${yy}" y2="${yy}" stroke="#e7edf4"/><text x="${left - 9}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#8a97aa">${value}分</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="每日计划与实际学习趋势">${guides}${bars}<polyline points="${movingPoints}" fill="none" stroke="#8b5cf6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${labels}<g transform="translate(${left},10)"><rect width="10" height="10" rx="2" fill="#2563eb"/><text x="16" y="9" font-size="10" fill="#68758a">实际</text><line x1="66" x2="78" y1="5" y2="5" stroke="#94a3b8" stroke-width="2"/><text x="84" y="9" font-size="10" fill="#68758a">计划</text><line x1="137" x2="149" y1="5" y2="5" stroke="#8b5cf6" stroke-width="2.5"/><text x="155" y="9" font-size="10" fill="#68758a">7日均值</text></g></svg>`
}

function subjectChartSvg(rows: ExportSubjectSummary[]) {
  const width = 1000
  const rowHeight = 38
  const height = Math.max(120, rows.length * rowHeight + 42)
  const left = 90
  const right = 90
  const chartWidth = width - left - right
  const max = Math.max(60, ...rows.flatMap(row => [row.planned, row.actual]))
  const bars = rows.map((row, index) => {
    const y = 27 + index * rowHeight
    const color = subjectSvgColors[row.subject] ?? subjectSvgColors.其他
    const plannedWidth = chartWidth * row.planned / max
    const actualWidth = chartWidth * row.actual / max
    return `<text x="${left - 12}" y="${y + 14}" text-anchor="end" font-size="12" fill="#26344b">${xml(row.subject)}</text><rect x="${left}" y="${y}" width="${plannedWidth.toFixed(1)}" height="10" rx="5" fill="#dbe3ee"/><rect x="${left}" y="${y + 14}" width="${actualWidth.toFixed(1)}" height="10" rx="5" fill="${color}"/><text x="${width - right + 10}" y="${y + 23}" font-size="10" fill="#68758a">${xml(minutesText(row.actual))}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="各科计划与实际投入">${bars}<g transform="translate(${left},${height - 16})"><rect width="10" height="10" rx="3" fill="#dbe3ee"/><text x="16" y="9" font-size="10" fill="#68758a">计划</text><rect x="62" width="10" height="10" rx="3" fill="#2563eb"/><text x="78" y="9" font-size="10" fill="#68758a">实际</text></g></svg>`
}

function buildLegacyStatisticsReportHtml(state: AppState, range: ExportRange) {
  const groups = activeGroupMap(state)
  const daily = aggregateDaily(state.assignments, groups, state.settings.countWordsTime, range.start, range.end, state.dailyPlanBaselines)
  const subjects = subjectSummaryForExport(state, range)
  const assignments = assignmentsInRange(state, range)
  const planned = daily.reduce((sum, row) => sum + row.planned, 0)
  const actual = daily.reduce((sum, row) => sum + row.actual, 0)
  const extra = daily.reduce((sum, row) => sum + row.extraActual, 0)
  const focusSessions = daily.reduce((sum, row) => sum + row.focusSessions, 0)
  const activeDays = daily.filter(row => row.actual > 0).length
  const average = activeDays ? Math.round(actual / activeDays) : 0
  const taskCount = daily.reduce((sum, row) => sum + row.plannedTasks, 0)
  const completion = taskCount ? Math.round(daily.reduce((sum, row) => sum + row.completedEquivalent, 0) / taskCount * 100) : 0
  const generatedAt = new Date().toLocaleString('zh-CN')
  const dailyRows = daily.map(row => `<tr><td>${html(row.date)}</td><td>${html(fmtWeekday(row.date))}</td><td>${row.planned}</td><td>${row.actual}</td><td>${row.extraActual}</td><td>${Math.round(row.taskCompletion)}%</td><td>${row.lateTasks}</td><td>${row.focusSessions}</td></tr>`).join('')
  const subjectRows = subjects.map(row => `<tr><td>${html(row.subject)}</td><td>${row.planned}</td><td>${row.actual}</td><td>${row.total}</td><td>${row.done}</td><td>${row.total ? Math.round(row.completedEquivalent / row.total * 100) : 0}%</td></tr>`).join('')
  const taskRows = assignments.map(item => {
    const group = groups.get(item.groupId)
    return `<tr><td>${html(item.scheduledDate)}</td><td>${html(item.title)}</td><td>${html(group?.subject ?? '其他')}</td><td>${item.estimatedMinutes}</td><td>${item.actualMinutes}</td><td>${html(taskStatusLabel[item.status])}</td></tr>`
  }).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(state.settings.planName)} 学习统计报告</title><style>
  :root{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#172033;background:#fff}*{box-sizing:border-box}body{margin:0 auto;max-width:1080px;padding:34px}header{border-bottom:2px solid #2563eb;padding-bottom:18px;margin-bottom:24px}h1{font-size:28px;margin:0 0 8px;letter-spacing:-.03em}h2{font-size:18px;margin:28px 0 11px}h3{font-size:14px;margin:0 0 8px}p{color:#667085;margin:4px 0;line-height:1.6}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.summary div{border:1px solid #dfe5ee;border-radius:13px;padding:14px;background:#fbfcfe}.summary span{display:block;color:#667085;font-size:11px}.summary strong{display:block;font-size:21px;margin-top:6px}.chart{border:1px solid #e1e8f1;border-radius:14px;padding:12px 14px;background:#fff}.chart svg{width:100%;height:auto;display:block}.two-column{display:grid;grid-template-columns:1fr 1fr;gap:14px}.table-wrap{overflow:hidden;border:1px solid #e1e8f1;border-radius:12px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border-bottom:1px solid #e6ebf1;padding:8px 7px;text-align:left}th{background:#f5f8fc;color:#526176;font-weight:700}tbody tr:last-child td{border-bottom:0}.privacy{margin-top:24px;padding:12px;border-radius:10px;background:#f4f7fb;font-size:10px}.muted{color:#7a8799;font-size:11px}@media print{body{padding:0;max-width:none}thead{display:table-header-group}.summary div,.chart,.two-column>section{break-inside:avoid}h2{break-after:avoid}}@media(max-width:700px){body{padding:20px}.summary{grid-template-columns:1fr 1fr}.two-column{grid-template-columns:1fr}.table-wrap{overflow:auto}table{min-width:620px}}
  </style></head><body><header><h1>${html(state.settings.planName)} 学习统计报告</h1><p>${html(range.start)} 至 ${html(range.end)} · 生成于 ${html(generatedAt)}</p><p class="muted">实际学习按实际发生日期归属；计划外学习单独标记，不会混入原计划完成率。</p></header><section class="summary"><div><span>已发生实际</span><strong>${minutesText(actual)}</strong></div><div><span>原计划</span><strong>${minutesText(planned)}</strong></div><div><span>实际学习天数 · 日均</span><strong>${activeDays} 天 · ${minutesText(average)}</strong></div><div><span>完成率 · 有效专注</span><strong>${completion}% · ${focusSessions} 次</strong></div></section><h2>每日学习趋势</h2><div class="chart">${dailyChartSvg(daily)}</div><section class="two-column"><section><h2>各科投入</h2><div class="chart">${subjects.length ? subjectChartSvg(subjects) : '<p class="muted">范围内还没有可统计的科目数据。</p>'}</div></section><section><h2>统计口径</h2><div class="chart"><p>已发生实际：${minutesText(actual)}；其中计划外 ${minutesText(extra)}。</p><p>任务完成率同时参考任务数量与当前进度，工作量完成率按预计分钟加权。</p><p>有效专注：计时器产生且不少于 1 分钟的记录。</p></div></section></section><h2>每日明细</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>星期</th><th>原计划</th><th>实际</th><th>计划外</th><th>任务完成</th><th>逾期</th><th>专注次数</th></tr></thead><tbody>${dailyRows}</tbody></table></div><h2>科目明细</h2><div class="table-wrap"><table><thead><tr><th>科目</th><th>计划分钟</th><th>实际分钟</th><th>任务数</th><th>已完成</th><th>完成率</th></tr></thead><tbody>${subjectRows || '<tr><td colspan="6">没有可统计的科目数据。</td></tr>'}</tbody></table></div><h2>任务明细</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>任务</th><th>科目</th><th>预计</th><th>实际累计</th><th>状态</th></tr></thead><tbody>${taskRows || '<tr><td colspan="6">这个范围没有已排期任务。</td></tr>'}</tbody></table></div><p class="privacy">报告可能包含个人任务、目标和学习时间。分享前请先检查内容。你可以在打印窗口选择“另存为 PDF”。</p></body></html>`
}

function completionChartSvg(rows: ReturnType<typeof aggregateDaily>) {
  const width = 1000
  const height = 300
  const left = 58
  const right = 20
  const top = 30
  const bottom = 48
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const slot = chartWidth / Math.max(rows.length - 1, 1)
  const x = (index: number) => left + (rows.length <= 1 ? chartWidth / 2 : index * slot)
  const y = (value: number) => top + chartHeight - Math.max(0, Math.min(100, value)) / 100 * chartHeight
  const line = (key: 'taskCompletion' | 'workloadCompletion') => rows.map((row, index) => `${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`).join(' ')
  const guides = [0, 50, 100].map(value => `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#e7edf4"/><text x="${left - 9}" y="${y(value) + 4}" text-anchor="end" font-size="10" fill="#8a97aa">${value}%</text>`).join('')
  const labels = rows.map((row, index) => {
    const step = Math.max(1, Math.ceil(rows.length / 10))
    if (index % step !== 0 && index !== rows.length - 1) return ''
    return `<text x="${x(index)}" y="${height - 18}" text-anchor="middle" font-size="10" fill="#718096">${xml(row.shortLabel)}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="每日任务完成率与工作量完成率">${guides}<polyline points="${line('taskCompletion')}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${line('workloadCompletion')}" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${labels}<g transform="translate(${left},10)"><line x1="0" x2="14" y1="5" y2="5" stroke="#2563eb" stroke-width="2.5"/><text x="20" y="9" font-size="10" fill="#68758a">任务数完成率</text><line x1="105" x2="119" y1="5" y2="5" stroke="#16a34a" stroke-width="2.5"/><text x="125" y="9" font-size="10" fill="#68758a">工作量完成率</text></g></svg>`
}

function focusChartSvg(rows: ReturnType<typeof aggregateDaily>) {
  const width = 1000
  const height = 300
  const left = 58
  const right = 42
  const top = 30
  const bottom = 48
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const max = Math.max(30, ...rows.flatMap(row => [row.timerActual, row.focusSessions]))
  const slot = chartWidth / Math.max(rows.length, 1)
  const barWidth = Math.max(2, Math.min(18, slot * .55))
  const y = (value: number) => top + chartHeight - value / max * chartHeight
  const bars = rows.map((row, index) => {
    const x = left + index * slot + (slot - barWidth) / 2
    const topY = y(row.timerActual)
    return `<rect x="${x.toFixed(1)}" y="${topY.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, top + chartHeight - topY).toFixed(1)}" rx="3" fill="#8b5cf6"/>`
  }).join('')
  const points = rows.map((row, index) => `${(left + index * slot + slot / 2).toFixed(1)},${y(row.focusSessions).toFixed(1)}`).join(' ')
  const labels = rows.map((row, index) => {
    const step = Math.max(1, Math.ceil(rows.length / 10))
    if (index % step !== 0 && index !== rows.length - 1) return ''
    return `<text x="${(left + index * slot + slot / 2).toFixed(1)}" y="${height - 18}" text-anchor="middle" font-size="10" fill="#718096">${xml(row.shortLabel)}</text>`
  }).join('')
  const guides = [0, .5, 1].map(ratio => {
    const value = Math.round(max * ratio)
    const yy = y(value)
    return `<line x1="${left}" x2="${width - right}" y1="${yy}" y2="${yy}" stroke="#e7edf4"/><text x="${left - 9}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#8a97aa">${value}</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="每日有效专注分钟与次数">${guides}${bars}<polyline points="${points}" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${labels}<g transform="translate(${left},10)"><rect width="10" height="10" rx="2" fill="#8b5cf6"/><text x="16" y="9" font-size="10" fill="#68758a">专注分钟</text><line x1="88" x2="102" y1="5" y2="5" stroke="#f59e0b" stroke-width="2.5"/><text x="108" y="9" font-size="10" fill="#68758a">有效次数</text></g></svg>`
}

function heatmapSvg(rows: ReturnType<typeof aggregateDaily>) {
  const cell = 14
  const gap = 3
  const left = 32
  const top = 26
  const offset = rows.length ? (new Date(`${rows[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0
  const weekCount = Math.max(1, Math.ceil((offset + rows.length) / 7))
  const width = left + weekCount * (cell + gap) + 18
  const height = top + 7 * (cell + gap) + 16
  const max = Math.max(1, ...rows.map(row => row.actual))
  const color = (value: number) => value <= 0 ? '#eef2f6' : value / max < .25 ? '#cfe0ff' : value / max < .5 ? '#9fc1ff' : value / max < .75 ? '#5f92f2' : '#2563eb'
  const cells = rows.map((row, index) => {
    const position = offset + index
    const column = Math.floor(position / 7)
    const weekday = position % 7
    const x = left + column * (cell + gap)
    const y = top + weekday * (cell + gap)
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="5" fill="${color(row.actual)}"><title>${xml(row.label)} · ${xml(minutesText(row.actual))}</title></rect>`
  }).join('')
  const weekdays = ['一', '三', '五', '日'].map((label, index) => `<text x="${left - 8}" y="${top + [0, 2, 4, 6][index] * (cell + gap) + 10}" text-anchor="end" font-size="9" fill="#718096">${label}</text>`).join('')
  const months = rows.map((row, index) => {
    if (index > 0 && !row.date.endsWith('-01')) return ''
    const position = offset + index
    const column = Math.floor(position / 7)
    return `<text x="${left + column * (cell + gap)}" y="${top - 8}" font-size="9" fill="#718096">${Number(row.date.slice(5, 7))}月</text>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="实际学习时间热力图">${weekdays}${months}${cells}</svg>`
}

interface ExportLedgerRow {
  date: string
  title: string
  group: string
  subject: string
  minutes: number
  source: string
  createdAt: string
}

function ledgerRowsForExport(state: AppState, range: ExportRange): ExportLedgerRow[] {
  const groups = activeGroupMap(state)
  const rows: ExportLedgerRow[] = []
  for (const assignment of state.assignments) {
    const group = groups.get(assignment.groupId)
    if (!group) continue
    let recorded = 0
    for (const entry of assignment.timeEntries ?? []) {
      const date = entryDate(entry.createdAt)
      const minutes = Math.max(0, Number(entry.minutes) || 0)
      recorded += minutes
      if (!date || date < range.start || date > range.end || minutes <= 0) continue
      rows.push({ date, title: assignment.title, group: group.title, subject: group.subject, minutes, source: sourceLabel(entry.source), createdAt: entry.originalCreatedAt ?? entry.createdAt })
    }
    const residual = Math.max(0, assignment.actualMinutes - recorded)
    const residualDate = entryDate(assignment.completedAt) ?? assignment.scheduledDate
    if (residual > 0 && residualDate && residualDate >= range.start && residualDate <= range.end) {
      rows.push({ date: residualDate, title: assignment.title, group: group.title, subject: group.subject, minutes: residual, source: sourceLabel(), createdAt: assignment.completedAt ?? residualDate })
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.createdAt.localeCompare(b.createdAt))
}

function accuracyLabel(value?: number) {
  if (value === undefined) return '样本不足'
  if (value > 0) return `低估 ${Math.round(value)}%`
  if (value < 0) return `高估 ${Math.abs(Math.round(value))}%`
  return '预计准确'
}

function reportSection(enabled: boolean, title: string, content: string) {
  return enabled ? `<section class="report-section"><h2>${html(title)}</h2>${content}</section>` : ''
}

export function buildStatisticsReportHtml(state: AppState, range: ExportRange, requestedSections: Partial<StatisticsReportSections> = {}) {
  const sections = { ...defaultStatisticsReportSections, ...requestedSections }
  const groups = activeGroupMap(state)
  const daily = aggregateDaily(state.assignments, groups, state.settings.countWordsTime, range.start, range.end, state.dailyPlanBaselines)
  const subjects = subjectSummaryForExport(state, range)
  const assignments = assignmentsInRange(state, range)
  const goalRows = allGoalProgress(state)
  const durationSuggestions = allDurationSuggestions(state).filter(item => groups.has(item.groupId))
  const ledgerRows = ledgerRowsForExport(state, range)
  const planned = daily.reduce((sum, row) => sum + row.planned, 0)
  const actual = daily.reduce((sum, row) => sum + row.actual, 0)
  const extra = daily.reduce((sum, row) => sum + row.extraActual, 0)
  const timer = daily.reduce((sum, row) => sum + row.timerActual, 0)
  const manual = daily.reduce((sum, row) => sum + row.manualActual, 0)
  const legacy = daily.reduce((sum, row) => sum + row.legacyActual, 0)
  const taskCount = daily.reduce((sum, row) => sum + row.plannedTasks, 0)
  const completedEquivalent = daily.reduce((sum, row) => sum + row.completedEquivalent, 0)
  const taskCompletion = taskCount ? completedEquivalent / taskCount * 100 : 0
  const workloadCompletion = planned ? daily.reduce((sum, row) => sum + row.planned * row.workloadCompletion / 100, 0) / planned * 100 : 0
  const activeDays = daily.filter(row => row.actual > 0).length
  const average = activeDays ? Math.round(actual / activeDays) : 0
  const focusSessions = daily.reduce((sum, row) => sum + row.focusSessions, 0)
  const focusDurations = ledgerRows.filter(row => row.source === '计时器').map(row => row.minutes)
  const averageFocus = focusDurations.length ? Math.round(focusDurations.reduce((sum, value) => sum + value, 0) / focusDurations.length) : 0
  const longestFocus = focusDurations.length ? Math.max(...focusDurations) : 0
  const today = todayISO()
  const completedCounted = state.assignments.filter(item => {
    const group = groups.get(item.groupId)
    return isCountedForExport(group, state.settings.countWordsTime) && item.status === 'done' && item.completedAt && item.scheduledDate
  })
  const onTime = completedCounted.filter(item => entryDate(item.completedAt)! <= item.scheduledDate!).length
  const onTimeRate = completedCounted.length ? onTime / completedCounted.length * 100 : 0
  const currentLate = state.assignments.filter(item => {
    const group = groups.get(item.groupId)
    return Boolean(group && item.scheduledDate && item.scheduledDate < today && item.status !== 'done')
  }).length
  const changedTasks = state.assignments.filter(item => item.previousDate && groups.has(item.groupId)).length
  const activeTasks = state.assignments.filter(item => groups.has(item.groupId)).length
  const carryovers = state.assignments.filter(item => item.scheduleSource === 'carryover' && groups.has(item.groupId)).length
  const priorityRows = [5, 3, 2, 1, 0].map(priority => {
    const ids = new Set(state.taskGroups.filter(group => group.priority === priority && !group.hidden).map(group => group.id))
    const items = state.assignments.filter(item => ids.has(item.groupId))
    const completed = items.reduce((sum, item) => sum + progressForExport(item), 0)
    return { label: priority === 5 ? '核心' : priority === 3 ? '高' : priority === 2 ? '中' : priority === 1 ? '低' : '可选', total: items.length, completion: items.length ? completed / items.length * 100 : 0 }
  }).filter(row => row.total > 0)
  const dominantSubject = subjects.filter(item => actual > 0 && item.actual > 0).sort((a, b) => b.actual - a.actual)[0]
  const insightItems = [
    planned > 0 ? { tone: actual >= planned ? 'positive' : 'warning', title: actual >= planned ? '实际学习达到或超过原计划' : '实际学习低于原计划', detail: `范围内实际 ${minutesText(actual)}，原计划 ${minutesText(planned)}，完成 ${Math.round(workloadCompletion)}%。` } : undefined,
    dominantSubject ? { tone: 'neutral', title: `${dominantSubject.subject}是投入最多的科目`, detail: `实际 ${minutesText(dominantSubject.actual)}，占有效学习 ${Math.round(dominantSubject.actual / Math.max(actual, 1) * 100)}%。` } : undefined,
    currentLate > 0 ? { tone: 'warning', title: `当前有 ${currentLate} 项任务超过原定日期`, detail: '延期统计按当前任务日期计算，不会把已经归档的任务混入。' } : undefined,
    durationSuggestions.length ? { tone: 'neutral', title: `有 ${durationSuggestions.length} 个任务组出现稳定时长偏差`, detail: '报告只展示建议，不会在导出时修改预计时长或计划。' } : undefined,
  ].filter(Boolean) as Array<{ tone: string; title: string; detail: string }>
  const dailyRows = daily.map(row => `<tr><td>${html(row.date)}</td><td>${html(fmtWeekday(row.date))}</td><td>${row.planned}</td><td>${row.actual}</td><td>${row.extraActual}</td><td>${row.timerActual}</td><td>${row.manualActual}</td><td>${row.plannedTasks}</td><td>${row.doneTasks}</td><td>${row.partialTasks}</td><td>${Math.round(row.taskCompletion)}%</td><td>${Math.round(row.workloadCompletion)}%</td><td>${row.lateTasks}</td><td>${row.focusSessions}</td></tr>`).join('')
  const subjectRows = subjects.map(row => `<tr><td>${html(row.subject)}</td><td>${row.planned}</td><td>${row.actual}</td><td>${row.total}</td><td>${row.done}</td><td>${Math.round(row.completedEquivalent / Math.max(row.total, 1) * 100)}%</td><td>${html(accuracyLabel(row.accuracy))}</td><td>${row.sampleSize || '—'}</td></tr>`).join('')
  const subjectGroupRows = subjects.flatMap(subject => subject.groups.filter(group => group.total > 0 || group.planned > 0 || group.actual > 0).map(group => `<tr><td>${html(subject.subject)}</td><td>${html(group.title)}</td><td>${group.planned}</td><td>${group.actual}</td><td>${group.done}/${group.total}</td><td>${html(accuracyLabel(group.accuracy))}</td></tr>`)).join('')
  const taskRows = assignments.map(item => {
    const group = groups.get(item.groupId)
    return `<tr><td>${html(item.scheduledDate)}</td><td>${html(item.title)}</td><td>${html(group?.subject ?? '其他')}</td><td>${item.estimatedMinutes}</td><td>${item.actualMinutes}</td><td>${Math.round(item.progress)}%</td><td>${html(taskStatusLabel[item.status])}</td></tr>`
  }).join('')
  const tasksByDate = new Map<string, Assignment[]>()
  for (const assignment of assignments) {
    const date = assignment.scheduledDate!
    tasksByDate.set(date, [...(tasksByDate.get(date) ?? []), assignment])
  }
  const taskDates = dateRange(range.start, range.end).filter(date => (tasksByDate.get(date)?.length ?? 0) > 0)
  const dailyTaskCards = taskDates.map(date => {
    const dayAssignments = tasksByDate.get(date) ?? []
    const doneCount = dayAssignments.filter(item => item.status === 'done').length
    const taskItems = dayAssignments.length ? dayAssignments.map(item => {
      const group = groups.get(item.groupId)
      const stateClass = item.status === 'done' ? 'done' : item.status === 'partial' ? 'partial' : 'todo'
      const stateText = item.status === 'done' ? '已完成' : item.status === 'partial' ? `部分完成 ${Math.round(item.progress)}%` : '未完成'
      return `<li><span class="day-task-title"><i class="subject-dot" style="background:${subjectSvgColors[group?.subject ?? '其他'] ?? subjectSvgColors.其他}"></i><strong>${html(item.title)}</strong><small>${html(group?.subject ?? '其他')} · ${item.estimatedMinutes} 分钟</small></span><span class="task-state ${stateClass}">${stateText}</span></li>`
    }).join('') : '<li class="day-task-empty">当天没有已排任务</li>'
    return `<article class="day-task-card"><header><div><strong>${html(fmtDate(date))}</strong><span>${html(fmtWeekday(date))}</span></div><em>${doneCount}/${dayAssignments.length} 已完成</em></header><ul>${taskItems}</ul></article>`
  }).join('')
  const ledgerSummary = [
    ['计时器', timer],
    ['手动补录', manual],
    ['旧数据折算', legacy],
    ['计划外学习', extra],
  ].map(([label, value]) => `<div class="report-stat"><span>${label}</span><strong>${minutesText(Number(value))}</strong></div>`).join('')
  const goalTable = goalRows.map(row => {
    const goal = state.goals.find(item => item.id === row.goalId)
    if (!goal) return ''
    return `<tr><td>${html(goal.title)}</td><td>${row.completedCount}/${row.requiredCount}</td><td>${Math.round(row.progress * 100)}%</td><td>${html(row.expectedCompletion ? fmtDate(row.expectedCompletion) : row.completed ? '已完成' : '无法预计')}</td><td>${html(row.latestRisk ? '最晚日期风险' : row.desiredRisk ? '期望日期风险' : '正常')}</td><td>${minutesText(row.estimatedRemainingMinutes)}</td></tr>`
  }).join('')
  const versionRows = [...state.planVersions].reverse().map(version => `<tr><td>${html(new Date(version.timestamp).toLocaleString('zh-CN'))}</td><td>${html(version.reason)}</td><td>${version.summary.goalCount}</td><td>${version.summary.groupCount}</td><td>${version.summary.assignmentCount}</td><td>${version.summary.completedCount}</td><td>${version.summary.movedTaskCount}</td><td>${minutesText(version.summary.scheduledMinutes)}</td></tr>`).join('')
  const accuracyRows = subjects.filter(item => item.accuracy !== undefined).sort((a, b) => Math.abs(b.accuracy ?? 0) - Math.abs(a.accuracy ?? 0)).map(item => `<tr><td>${html(item.subject)}</td><td>${html(accuracyLabel(item.accuracy))}</td><td>${item.sampleSize}</td><td>${item.actual} 分钟</td></tr>`).join('')
  const suggestionRows = durationSuggestions.map(suggestion => {
    const group = groups.get(suggestion.groupId)
    return `<tr><td>${html(group?.subject ?? '其他')}</td><td>${html(group?.title ?? suggestion.groupId)}</td><td>${suggestion.currentEstimate} 分钟</td><td>${suggestion.suggestedEstimate} 分钟</td><td>${suggestion.recentAverage} 分钟</td><td>${suggestion.sampleCount}</td></tr>`
  }).join('')
  const insightHtml = insightItems.length ? `<div class="report-insights">${insightItems.map(item => `<article class="${item.tone}"><strong>${html(item.title)}</strong><span>${html(item.detail)}</span></article>`).join('')}</div>` : '<p class="muted">范围内暂时没有可生成的洞察。</p>'
  const ledgerDetailRows = ledgerRows.map(row => `<tr><td>${html(row.date)}</td><td>${html(row.title)}</td><td>${html(row.group)}</td><td>${html(row.subject)}</td><td>${row.minutes}</td><td>${html(row.source)}</td><td>${html(row.createdAt)}</td></tr>`).join('')
  const generatedAt = new Date().toLocaleString('zh-CN')
  const empty = (columns: number, message: string) => `<tr><td colspan="${columns}">${html(message)}</td></tr>`
  const overviewHtml = `<div class="report-stat-grid"><div class="report-stat"><span>范围内实际</span><strong>${minutesText(actual)}</strong></div><div class="report-stat"><span>原计划</span><strong>${minutesText(planned)}</strong></div><div class="report-stat"><span>实际学习天数 · 日均</span><strong>${activeDays} 天 · ${minutesText(average)}</strong></div><div class="report-stat"><span>任务完成率</span><strong>${Math.round(taskCompletion)}%</strong></div><div class="report-stat"><span>工作量完成率</span><strong>${Math.round(workloadCompletion)}%</strong></div><div class="report-stat"><span>计划外学习</span><strong>${minutesText(extra)}</strong></div><div class="report-stat"><span>有效专注</span><strong>${focusSessions} 次</strong></div><div class="report-stat"><span>平均每次专注</span><strong>${minutesText(averageFocus)}</strong></div></div><div class="report-note"><strong>统计范围：</strong>${html(range.start)} 至 ${html(range.end)}。实际时间按时间记录发生日期归属；计划外学习单独展示，不会混入原计划完成率。</div>`
  const dailyHtml = `<div class="chart">${dailyChartSvg(daily)}</div>`
  const completionHtml = `<div class="chart">${completionChartSvg(daily)}</div>`
  const focusHtml = `<div class="chart">${focusChartSvg(daily)}</div><div class="report-stat-grid report-stat-grid-four">${ledgerSummary}<div class="report-stat"><span>最长一次专注</span><strong>${minutesText(longestFocus)}</strong></div></div>`
  const subjectHtml = `<div class="chart">${subjects.length ? subjectChartSvg(subjects) : '<p class="muted">范围内还没有可统计的科目数据。</p>'}</div><div class="table-wrap"><table><thead><tr><th>科目</th><th>计划分钟</th><th>实际分钟</th><th>任务数</th><th>已完成</th><th>完成率</th><th>时长准确度</th><th>样本</th></tr></thead><tbody>${subjectRows || empty(8, '没有可统计的科目数据。')}</tbody></table></div><h3 class="subheading">任务组明细</h3><div class="table-wrap"><table><thead><tr><th>科目</th><th>任务组</th><th>计划分钟</th><th>实际分钟</th><th>完成</th><th>时长准确度</th></tr></thead><tbody>${subjectGroupRows || empty(6, '没有可统计的任务组数据。')}</tbody></table></div>`
  const accuracyHtml = `<p class="muted">只有完成至少 ${state.settings.duration.minimumSamples} 个有实际用时的任务后，才会形成正式时长准确度；建议只供参考，不会因导出自动修改计划。</p><div class="table-wrap"><table><thead><tr><th>科目</th><th>准确度</th><th>样本数</th><th>实际总时长</th></tr></thead><tbody>${accuracyRows || empty(4, '暂时没有达到样本数和偏差阈值的准确度数据。')}</tbody></table></div><h3 class="subheading">预计时长校准建议</h3><div class="table-wrap"><table><thead><tr><th>科目</th><th>任务组</th><th>当前预计</th><th>建议预计</th><th>样本平均</th><th>样本数</th></tr></thead><tbody>${suggestionRows || empty(6, '当前没有预计时长校准建议。')}</tbody></table></div>`
  const goalsHtml = `<div class="two-column"><div><h3>当前目标</h3><div class="table-wrap"><table><thead><tr><th>目标</th><th>完成</th><th>进度</th><th>预计完成</th><th>风险</th><th>剩余</th></tr></thead><tbody>${goalTable || empty(6, '暂无目标。')}</tbody></table></div></div><div><h3>历史计划版本</h3><div class="table-wrap"><table><thead><tr><th>时间</th><th>原因</th><th>目标</th><th>任务组</th><th>任务</th><th>完成</th><th>移动</th><th>负载</th></tr></thead><tbody>${versionRows || empty(8, '尚无重大计划版本。')}</tbody></table></div></div></div>`
  const qualityHtml = `<div class="report-stat-grid report-stat-grid-four"><div class="report-stat"><span>按期完成率</span><strong>${Math.round(onTimeRate)}%</strong><small>${onTime}/${completedCounted.length} 个可判断任务</small></div><div class="report-stat"><span>当前延期</span><strong>${currentLate} 项</strong></div><div class="report-stat"><span>顺延任务</span><strong>${carryovers} 项</strong></div><div class="report-stat"><span>计划变更率</span><strong>${activeTasks ? Math.round(changedTasks / activeTasks * 100) : 0}%</strong><small>${changedTasks}/${activeTasks} 项保留最近原日期</small></div></div><h3 class="subheading">优先级完成进度</h3><div class="table-wrap"><table><thead><tr><th>优先级</th><th>任务数</th><th>完成进度</th></tr></thead><tbody>${priorityRows.map(row => `<tr><td>${row.label}</td><td>${row.total}</td><td>${Math.round(row.completion)}%</td></tr>`).join('') || empty(3, '暂无优先级任务。')}</tbody></table></div><p class="report-note">计划变更率依据任务当前保留的最近一次原日期；旧数据可能没有完整的改期历史。顺延任务按系统记录的顺延来源统计。</p>`
  const emptyTaskDays = Math.max(0, daily.length - taskDates.length)
  const detailsHtml = `<h3>每天任务清单</h3><p class="muted">按日期列出范围内有任务的全部日期。绿色表示已完成，橙色表示部分完成，灰色表示未完成；另有 ${emptyTaskDays} 天没有已排任务，已省略空白卡片。</p><div class="day-task-grid">${dailyTaskCards || '<article class="day-task-card"><p class="day-task-empty">这个范围没有已排任务。</p></article>'}</div><h3 class="subheading">每日统计明细</h3><div class="table-wrap"><table class="wide-table"><thead><tr><th>日期</th><th>星期</th><th>原计划</th><th>实际</th><th>计划外</th><th>计时器</th><th>手动</th><th>任务数</th><th>完成</th><th>部分完成</th><th>任务完成</th><th>工作量完成</th><th>逾期</th><th>专注次数</th></tr></thead><tbody>${dailyRows || empty(14, '没有每日数据。')}</tbody></table></div><h3 class="subheading">任务明细</h3><div class="table-wrap"><table><thead><tr><th>日期</th><th>任务</th><th>科目</th><th>预计</th><th>实际累计</th><th>进度</th><th>状态</th></tr></thead><tbody>${taskRows || empty(7, '这个范围没有已排期任务。')}</tbody></table></div>`
  const ledgerHtml = `<p class="muted">时间流水按实际发生日期列出，共 ${ledgerRows.length} 条；修改任务日期不会重写这些记录。</p><div class="table-wrap"><table><thead><tr><th>归属日期</th><th>任务</th><th>任务组</th><th>科目</th><th>分钟</th><th>来源</th><th>创建时间</th></tr></thead><tbody>${ledgerDetailRows || empty(7, '这个范围还没有时间流水。')}</tbody></table></div>`
  const selectedCount = Object.values(sections).filter(Boolean).length
  const body = selectedCount === 0 ? '<div class="report-note">未选择报告内容，请回到导出页面至少选择一个模块。</div>' : [
    reportSection(sections.overview, '范围概览', overviewHtml),
    reportSection(sections.daily, '每日计划与实际', dailyHtml),
    reportSection(sections.completion, '完成率趋势', completionHtml),
    reportSection(sections.focus, '专注与时间来源', focusHtml),
    reportSection(sections.subjects, '科目投入与任务分布', subjectHtml),
    reportSection(sections.accuracy, '预计时长准确度', accuracyHtml),
    reportSection(sections.insights, '数据洞察', insightHtml),
    reportSection(sections.heatmap, '学习热力图', `<div class="chart heatmap-chart">${heatmapSvg(daily)}</div>`),
    reportSection(sections.goals, '目标与计划版本', goalsHtml),
    reportSection(sections.quality, '执行状态与计划质量', qualityHtml),
    reportSection(sections.details, '每日与任务明细', detailsHtml),
    reportSection(sections.ledger, '时间流水明细', ledgerHtml),
  ].join('')
  const reportStyles = `
    :root{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#172033;background:#fff}
    *{box-sizing:border-box}
    body{margin:0 auto;max-width:1120px;padding:34px}
    header{border-bottom:2px solid #2563eb;padding-bottom:18px;margin-bottom:24px}
    h1{font-size:28px;margin:0 0 8px;letter-spacing:-.03em}
    h2{font-size:18px;margin:30px 0 12px}
    h3{font-size:14px;margin:0 0 9px}
    .subheading{margin-top:22px}
    p{color:#667085;margin:4px 0;line-height:1.6}
    .muted{color:#7a8799;font-size:11px}
    .report-section{break-inside:auto}
    .report-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}
    .report-stat-grid-four{grid-template-columns:repeat(5,minmax(0,1fr))}
    .report-stat{border:1px solid #dfe5ee;border-radius:12px;padding:13px;background:#fbfcfe;min-height:76px}
    .report-stat span{display:block;color:#667085;font-size:11px}
    .report-stat strong{display:block;font-size:19px;margin-top:6px}
    .report-stat small{display:block;color:#7a8799;font-size:10px;margin-top:4px}
    .report-note{margin:12px 0;padding:10px 12px;border-radius:9px;background:#f4f7fb;color:#526176;font-size:11px;line-height:1.65}
    .chart{border:1px solid #e1e8f1;border-radius:14px;padding:12px 14px;background:#fff}
    .chart svg{width:100%;height:auto;display:block}
    .heatmap-chart{overflow:hidden}
    .heatmap-chart svg{min-width:0;max-width:100%}
    .two-column{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .table-wrap{overflow:hidden;border:1px solid #e1e8f1;border-radius:12px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border-bottom:1px solid #e6ebf1;padding:8px 7px;text-align:left;vertical-align:top}
    th{background:#f5f8fc;color:#526176;font-weight:700;white-space:nowrap}
    tbody tr:last-child td{border-bottom:0}
    .wide-table{min-width:980px}
    .day-task-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .day-task-card{border:1px solid #e1e8f1;border-radius:12px;padding:12px;background:#fbfcfe;break-inside:avoid}
    .day-task-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;border:0;padding:0;margin:0 0 8px}
    .day-task-card header div{display:flex;align-items:baseline;gap:8px}
    .day-task-card header strong{font-size:13px}
    .day-task-card header span,.day-task-card header em{color:#718096;font-size:10px;font-style:normal}
    .day-task-card ul{list-style:none;margin:0;padding:0}
    .day-task-card li{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid #e6ebf1}
    .day-task-title{display:grid;grid-template-columns:8px 1fr;column-gap:7px;min-width:0}
    .day-task-title strong{font-size:11px;line-height:1.45;overflow-wrap:anywhere}
    .day-task-title small{grid-column:2;color:#7a8799;font-size:10px;margin-top:2px}
    .subject-dot{width:8px;height:8px;border-radius:50%;margin-top:4px}
    .task-state{flex:none;font-size:10px;font-weight:700}
    .task-state.done{color:#15803d}
    .task-state.partial{color:#b45309}
    .task-state.todo{color:#64748b}
    .day-task-empty{color:#8a97aa;font-size:11px}
    .report-insights{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .report-insights article{display:flex;flex-direction:column;gap:6px;border:1px solid #dfe5ee;border-left:4px solid #94a3b8;border-radius:10px;padding:12px;background:#fbfcfe}
    .report-insights article.positive{border-left-color:#16a34a}
    .report-insights article.warning{border-left-color:#f59e0b}
    .report-insights strong{font-size:13px}
    .report-insights span{color:#667085;font-size:11px;line-height:1.55}
    .privacy{margin-top:24px;padding:12px;border-radius:10px;background:#f4f7fb;font-size:10px;color:#667085}
    @media print{body{padding:0;max-width:none}.report-stat,.chart,.report-insights article,.two-column>div{break-inside:avoid}.day-task-grid{grid-template-columns:1fr 1fr}.day-task-card{break-inside:avoid}.report-section{break-before:auto}thead{display:table-header-group}.table-wrap{overflow:visible}.wide-table{min-width:0;font-size:8px}h2{break-after:avoid}}
    @media(max-width:760px){body{padding:20px}.report-stat-grid,.report-stat-grid-four{grid-template-columns:1fr 1fr}.two-column,.report-insights,.day-task-grid{grid-template-columns:1fr}.table-wrap{overflow:auto}table{min-width:650px}}
  `
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(state.settings.planName)} 学习统计报告</title><style>${reportStyles}</style></head><body><header><h1>${html(state.settings.planName)} 学习统计报告</h1><p>${html(range.start)} 至 ${html(range.end)} · 生成于 ${html(generatedAt)}</p><p class="muted">可按需要选择报告模块；实际学习按实际发生日期归属，导出只在本机生成。</p></header>${body}<p class="privacy">报告可能包含个人任务、目标和学习时间。分享前请先检查内容。你可以在打印窗口选择“另存为 PDF”。</p></body></html>`
}

export function buildPrintableReportHtml(state: AppState, range: ExportRange, sections?: Partial<StatisticsReportSections>) {
  return buildStatisticsReportHtml(state, range, sections)
}

function buildCalendarTaskDetailsHtml(state: AppState, range: ExportRange) {
  const groups = activeGroupMap(state)
  const assignments = assignmentsInRange(state, range)
  const rows = assignments.map(assignment => {
    const group = groups.get(assignment.groupId)
    return `<tr><td>${html(assignment.scheduledDate)}</td><td>${html(group?.subject ?? '其他')}</td><td>${html(assignment.title)}</td><td>${assignment.estimatedMinutes} 分钟</td><td>${html(taskStatusLabel[assignment.status])}</td></tr>`
  }).join('')
  return `<section class="calendar-details"><h2>每日任务明细</h2><p class="muted">月历格子用于快速浏览；以下清单保留这个月份的全部任务，不会因格子高度被隐藏。</p><div class="table-wrap"><table><thead><tr><th>日期</th><th>科目</th><th>任务</th><th>预计</th><th>状态</th></tr></thead><tbody>${rows || '<tr><td colspan="5">这个月份没有已排期任务。</td></tr>'}</tbody></table></div></section>`
}

export function buildCalendarPrintHtml(state: AppState, month: string) {
  const range = monthExportRange(month)
  const generatedAt = new Date().toLocaleString('zh-CN')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(state.settings.planName)} ${html(month)} 月历</title><style>:root{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#172033}*{box-sizing:border-box}body{margin:0;padding:22px}header{display:flex;align-items:end;justify-content:space-between;gap:16px;border-bottom:2px solid #2563eb;padding-bottom:14px;margin-bottom:16px}h1{font-size:24px;margin:0 0 5px}h2{font-size:18px;margin:28px 0 9px}.muted{margin:0 0 10px;color:#667085;font-size:11px}.calendar-svg{display:block;width:100%;height:auto}.table-wrap{overflow:hidden;border:1px solid #e1e8f1;border-radius:12px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border-bottom:1px solid #e6ebf1;padding:8px 7px;text-align:left}th{background:#f5f8fc;color:#526176;font-weight:700}tbody tr:last-child td{border-bottom:0}.calendar-details{break-before:page}@media print{body{padding:0}@page{size:landscape;margin:10mm}thead{display:table-header-group}}@media(max-width:700px){body{padding:12px}header{display:block}header p{margin-top:6px}}</style></head><body><header><div><h1>${html(state.settings.planName)} · ${html(range.start.slice(0, 7))} 月历</h1><p>月度任务安排、每日容量与科目标记</p></div><p>生成于 ${html(generatedAt)}</p></header>${buildCalendarSvg(state, month, { showAllTasks: false })}${buildCalendarTaskDetailsHtml(state, range)}</body></html>`
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
