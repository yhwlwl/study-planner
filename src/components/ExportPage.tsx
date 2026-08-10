import { useMemo, useState } from 'react'
import { BarChart3, CalendarDays, CheckCircle2, Clock3, Database, Download, FileSpreadsheet, FileText, Printer, ShieldCheck } from 'lucide-react'
import { useApp } from '../AppContext'
import { clampDate, minutesText, shiftDate, todayISO } from '../lib/date'
import {
  buildCalendarCsv,
  buildCalendarIcs,
  buildCalendarPrintHtml,
  buildCalendarSvg,
  buildStatisticsReportHtml,
  buildStatisticsCsv,
  buildTimeLedgerCsv,
  downloadSvgAsPng,
  downloadTextFile,
  exportRangeSummary,
  monthExportRange,
  safeExportName,
  defaultStatisticsReportSections,
  type StatisticsReportSections,
  type ExportRange,
} from '../lib/exports'

type ExportPageId = 'settings' | 'stats'
type RangePreset = 'recent' | '30d' | '90d' | 'future' | 'all'

const reportSectionOptions: Array<{ key: keyof StatisticsReportSections; title: string; description: string }> = [
  { key: 'overview', title: '范围概览', description: '实际、原计划、完成率和有效专注' },
  { key: 'daily', title: '每日学习趋势', description: '每天计划与实际时间变化' },
  { key: 'completion', title: '完成率趋势', description: '任务数与工作量两个口径' },
  { key: 'focus', title: '专注与时间来源', description: '计时器、手动补录和旧数据' },
  { key: 'subjects', title: '科目与任务组', description: '投入、任务数和完成情况' },
  { key: 'accuracy', title: '预计时长准确度', description: '样本准确度和校准建议' },
  { key: 'insights', title: '数据洞察', description: '范围内值得注意的变化' },
  { key: 'heatmap', title: '学习热力图', description: '按天查看学习时间密度' },
  { key: 'goals', title: '目标与计划版本', description: '目标进度和历史计划变化' },
  { key: 'quality', title: '执行状态与计划质量', description: '按期、延期、顺延和变更率' },
  { key: 'details', title: '每天任务清单', description: '按日期列出已完成与未完成任务' },
  { key: 'ledger', title: '时间流水明细', description: '逐条核对实际发生的时间记录' },
]

const coreReportSections: StatisticsReportSections = {
  ...defaultStatisticsReportSections,
  focus: false,
  accuracy: false,
  insights: false,
  heatmap: false,
  goals: false,
  quality: false,
  ledger: false,
}

export function ExportPage({ onNavigate }: { onNavigate: (page: ExportPageId) => void }) {
  const { state } = useApp()
  const today = todayISO()
  const initialEnd = clampDate(today, state.settings.startDate, state.settings.endDate)
  const initialStart = clampDate(shiftDate(initialEnd, -6), state.settings.startDate, state.settings.endDate)
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const [calendarMonth, setCalendarMonth] = useState(initialEnd.slice(0, 7))
  const [reportSections, setReportSections] = useState<StatisticsReportSections>(() => ({ ...defaultStatisticsReportSections }))
  const [notice, setNotice] = useState('')
  const valid = Boolean(start && end && start <= end)
  const range: ExportRange = { start, end }
  const calendarRange = monthExportRange(calendarMonth)
  const summary = useMemo(() => valid ? exportRangeSummary(state, range) : undefined, [state, start, end, valid])
  const filenameBase = `${safeExportName(state.settings.planName)}-${start}-${end}`
  const calendarFilenameBase = `${safeExportName(state.settings.planName)}-${calendarMonth}-calendar`

  const runExport = (label: string, filename: string, content: string, mime: string) => {
    downloadTextFile(filename, content, mime)
    setNotice(`${label}已开始下载。文件只保存在你的设备上。`)
  }

  const setPreset = (preset: RangePreset) => {
    if (preset === 'all') {
      setStart(state.settings.startDate)
      setEnd(state.settings.endDate)
    } else if (preset === 'future') {
      setStart(clampDate(today, state.settings.startDate, state.settings.endDate))
      setEnd(state.settings.endDate)
    } else {
      const days = preset === 'recent' ? 6 : preset === '30d' ? 29 : 89
      const recentEnd = clampDate(today, state.settings.startDate, state.settings.endDate)
      setEnd(recentEnd)
      setStart(clampDate(shiftDate(recentEnd, -days), state.settings.startDate, state.settings.endDate))
    }
    setNotice('')
  }

  const openPrintWindow = (html: string, label: string) => {
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      setNotice('浏览器阻止了打印窗口。请允许本站打开新窗口后重试。')
      return
    }
    reportWindow.opener = null
    reportWindow.document.open()
    reportWindow.document.write(html)
    reportWindow.document.close()
    reportWindow.focus()
    window.setTimeout(() => reportWindow.print(), 250)
    setNotice(`${label}已打开。请在打印窗口选择“另存为 PDF”。`)
  }

  const openStatisticsReport = () => {
    if (!valid) return
    openPrintWindow(buildStatisticsReportHtml(state, range, reportSections), '学习统计报告')
  }

  const openCalendarReport = () => {
    openPrintWindow(buildCalendarPrintHtml(state, calendarMonth), '月历 PDF')
  }

  const downloadCalendarImage = () => {
    setNotice('正在生成月历 PNG……')
    void downloadSvgAsPng(`${calendarFilenameBase}.png`, buildCalendarSvg(state, calendarMonth))
      .then(() => setNotice('月历 PNG 已开始下载。文件只保存在你的设备上。'))
      .catch(error => setNotice(error instanceof Error ? error.message : '月历图片生成失败，请稍后重试。'))
  }

  return <div className="export-page">
    <section className="export-hero">
      <div>
        <span className="export-kicker"><Download size={16}/>导出中心</span>
        <h2>导出学习数据</h2>
        <p>选择日期范围，生成统计报告、每天任务清单、月历或时间记录。所有文件都在本机生成，不会上传你的任务内容。</p>
        <div className="export-hero-links"><button type="button" className="text-button" onClick={() => onNavigate('stats')}><BarChart3 size={15}/>先查看统计页</button></div>
      </div>
      <div className="export-hero-mark" aria-hidden="true"><FileSpreadsheet size={44}/></div>
    </section>

    <section className="export-range-panel">
      <div className="export-range-copy"><h3>统计与流水范围</h3><p>这个范围用于统计报告、统计 CSV 和时间流水；月历导出单独选择月份。</p></div>
      <div className="export-presets" aria-label="日期范围快捷选项">
        <button type="button" onClick={() => setPreset('recent')}>近 7 天</button>
        <button type="button" onClick={() => setPreset('30d')}>近 30 天</button>
        <button type="button" onClick={() => setPreset('90d')}>近 90 天</button>
        <button type="button" onClick={() => setPreset('future')}>今天以后</button>
        <button type="button" onClick={() => setPreset('all')}>完整计划</button>
      </div>
      <div className="export-date-fields">
        <label><span>开始日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={start} onChange={event => { setStart(event.target.value); setNotice('') }}/></label>
        <span className="export-date-arrow">至</span>
        <label><span>结束日期</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={end} onChange={event => { setEnd(event.target.value); setNotice('') }}/></label>
      </div>
      {!valid && <p className="form-error" role="alert">结束日期不能早于开始日期。</p>}
      {summary && <div className="export-range-summary" aria-label="导出范围摘要">
        <span><strong>{summary.days}</strong> 天</span>
        <span><strong>{summary.assignments}</strong> 项已排任务</span>
        <span><strong>{minutesText(summary.plannedMinutes)}</strong> 原计划</span>
        <span><strong>{minutesText(summary.actualMinutes)}</strong> 已发生实际</span>
      </div>}
    </section>

    <section className="export-section-picker" aria-labelledby="export-report-sections-title">
      <div className="export-section-picker-header">
        <div><h3 id="export-report-sections-title">PDF 报告内容</h3><p>默认包含统计页的全部模块。每天任务清单会按日期列出已完成、部分完成和未完成任务；你也可以只保留需要分享的部分。</p></div>
        <div className="export-section-picker-actions"><span>{Object.values(reportSections).filter(Boolean).length}/{reportSectionOptions.length} 个模块</span><button type="button" className="text-button" onClick={() => setReportSections({ ...defaultStatisticsReportSections })}>全部选择</button><button type="button" className="text-button" onClick={() => setReportSections({ ...coreReportSections })}>只保留核心</button></div>
      </div>
      <div className="export-section-grid">
        {reportSectionOptions.map(option => <label key={option.key} className="export-section-choice"><input type="checkbox" checked={reportSections[option.key]} onChange={() => setReportSections(current => ({ ...current, [option.key]: !current[option.key] }))}/><span><strong>{option.title}</strong><small>{option.description}</small></span></label>)}
      </div>
    </section>

    <section className="export-options" aria-label="可用导出格式">
      <article className="export-card export-card-stats export-card-featured">
        <div className="export-card-icon"><BarChart3 size={22}/></div>
        <div className="export-card-copy"><h3>学习统计报告</h3><p>按上方日期范围生成美观的 PDF。报告先呈现范围概览，再按选择加入趋势、科目、目标、质量和时间流水等模块。</p></div>
        <div className="export-card-actions">
          <button type="button" className="primary-button" disabled={!valid} onClick={openStatisticsReport}><Printer size={16}/>统计报告 PDF</button>
          <button type="button" className="secondary-button" disabled={!valid} onClick={() => runExport('统计 CSV', `${filenameBase}-statistics.csv`, buildStatisticsCsv(state, range), 'text/csv')}><FileSpreadsheet size={16}/>统计 CSV</button>
          <button type="button" className="text-button" disabled={!valid} onClick={() => runExport('统计 HTML', `${filenameBase}-statistics.html`, buildStatisticsReportHtml(state, range, reportSections), 'text/html')}><FileText size={16}/>HTML</button>
        </div>
      </article>

      <article className="export-card export-card-calendar export-card-featured">
        <div className="export-card-icon"><CalendarDays size={22}/></div>
        <div className="export-card-copy"><h3>月历图片与 PDF</h3><p>选择一个月份。PDF 先给月历总览，再附上这个月的全部任务明细；PNG 会按任务数量自适应高度，减少每天任务被截断。</p></div>
        <div className="export-month-choice"><label><span>月历月份</span><input type="month" min={state.settings.startDate.slice(0, 7)} max={state.settings.endDate.slice(0, 7)} value={calendarMonth} onChange={event => setCalendarMonth(event.target.value)}/></label><small>{calendarRange.start} 至 {calendarRange.end}</small></div>
        <div className="export-card-actions">
          <button type="button" className="primary-button" onClick={openCalendarReport}><Printer size={16}/>月历 PDF</button>
          <button type="button" className="secondary-button" onClick={downloadCalendarImage}><Download size={16}/>月历 PNG</button>
          <button type="button" className="text-button" onClick={() => runExport('月历 CSV', `${calendarFilenameBase}.csv`, buildCalendarCsv(state, calendarRange), 'text/csv')}><FileSpreadsheet size={16}/>CSV</button>
        </div>
      </article>

      <article className="export-card export-card-ledger">
        <div className="export-card-icon"><Clock3 size={22}/></div>
        <div className="export-card-copy"><h3>实际时间流水</h3><p>逐条导出实际发生日期、任务、分钟、计时或手动来源，以及创建和修改时间，适合核对统计。</p></div>
        <div className="export-card-actions">
          <button type="button" className="secondary-button" disabled={!valid} onClick={() => runExport('时间流水 CSV', `${filenameBase}-time-ledger.csv`, buildTimeLedgerCsv(state, range), 'text/csv')}><Download size={16}/>下载流水 CSV</button>
        </div>
      </article>

      <article className="export-card export-card-calendar">
        <div className="export-card-icon"><CalendarDays size={22}/></div>
        <div className="export-card-copy"><h3>系统日历</h3><p>将选择范围内的已排任务导出到 Apple 日历、Google 日历或其他支持 ICS 的应用。</p></div>
        <div className="export-card-actions">
          <button type="button" className="secondary-button" disabled={!valid} onClick={() => runExport('日历 ICS', `${filenameBase}-calendar.ics`, buildCalendarIcs(state, range), 'text/calendar')}><CalendarDays size={16}/>下载 ICS</button>
        </div>
      </article>
    </section>

    {notice && <div className="export-notice" role="status"><CheckCircle2 size={17}/><span>{notice}</span></div>}

    <section className="export-privacy">
      <ShieldCheck size={22}/>
      <div><h3>导出文件只在本机生成</h3><p>PDF 通过浏览器打印窗口生成；选择“另存为 PDF”即可保存。文件可能包含个人任务与学习时间，分享前请先检查。</p></div>
      <button type="button" className="secondary-button" onClick={() => onNavigate('settings')}><Database size={16}/>前往备份设置</button>
    </section>
  </div>
}
