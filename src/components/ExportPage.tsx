import { useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, Database, Download, FileSpreadsheet, FileText, Printer, ShieldCheck } from 'lucide-react'
import { useApp } from '../AppContext'
import { clampDate, minutesText, shiftDate, todayISO } from '../lib/date'
import {
  buildCalendarCsv,
  buildCalendarIcs,
  buildPrintableReportHtml,
  buildStatisticsCsv,
  buildTimeLedgerCsv,
  downloadTextFile,
  exportRangeSummary,
  safeExportName,
  type ExportRange,
} from '../lib/exports'

type ExportPageId = 'settings'

export function ExportPage({ onNavigate }: { onNavigate: (page: ExportPageId) => void }) {
  const { state } = useApp()
  const today = todayISO()
  const initialEnd = clampDate(today, state.settings.startDate, state.settings.endDate)
  const initialStart = clampDate(shiftDate(initialEnd, -6), state.settings.startDate, state.settings.endDate)
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const [notice, setNotice] = useState('')
  const valid = Boolean(start && end && start <= end)
  const range: ExportRange = { start, end }
  const summary = useMemo(() => valid ? exportRangeSummary(state, range) : undefined, [state, start, end, valid])
  const filenameBase = `${safeExportName(state.settings.planName)}-${start}-${end}`

  const runExport = (label: string, filename: string, content: string, mime: string) => {
    downloadTextFile(filename, content, mime)
    setNotice(`${label}已开始下载。文件只保存在你的设备上。`)
  }

  const setPreset = (preset: 'all' | 'future' | 'recent') => {
    if (preset === 'all') {
      setStart(state.settings.startDate)
      setEnd(state.settings.endDate)
    } else if (preset === 'future') {
      setStart(clampDate(today, state.settings.startDate, state.settings.endDate))
      setEnd(state.settings.endDate)
    } else {
      const recentEnd = clampDate(today, state.settings.startDate, state.settings.endDate)
      setEnd(recentEnd)
      setStart(clampDate(shiftDate(recentEnd, -6), state.settings.startDate, state.settings.endDate))
    }
    setNotice('')
  }

  const openPrintReport = () => {
    const reportWindow = window.open('', '_blank')
    if (!reportWindow) {
      setNotice('浏览器阻止了打印窗口。请允许本站打开新窗口后重试。')
      return
    }
    reportWindow.opener = null
    reportWindow.document.open()
    reportWindow.document.write(buildPrintableReportHtml(state, range))
    reportWindow.document.close()
    reportWindow.focus()
    window.setTimeout(() => reportWindow.print(), 250)
    setNotice('打印报告已打开。你可以在打印窗口中选择“另存为 PDF”。')
  }

  return <div className="export-page">
    <section className="export-hero">
      <div>
        <span className="export-kicker"><Download size={16}/>导出中心</span>
        <h2>把计划和学习记录带出去</h2>
        <p>月历、统计和时间流水使用同一套日期与历史口径。CSV 适合 Excel，ICS 可以导入系统日历，打印报告可以保存为 PDF。</p>
      </div>
      <div className="export-hero-mark" aria-hidden="true"><FileSpreadsheet size={44}/></div>
    </section>

    <section className="export-range-panel">
      <div className="export-range-copy"><h3>选择导出范围</h3><p>默认是最近 7 天，也可以导出完整计划或未来安排。</p></div>
      <div className="export-presets" aria-label="日期范围快捷选项">
        <button type="button" onClick={() => setPreset('recent')}>最近 7 天</button>
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
        <span><strong>{minutesText(summary.actualMinutes)}</strong> 实际</span>
      </div>}
    </section>

    <section className="export-options" aria-label="可用导出格式">
      <article className="export-card export-card-calendar">
        <div className="export-card-icon"><CalendarDays size={22}/></div>
        <div className="export-card-copy"><h3>月历与任务安排</h3><p>包含每日容量、日期类型、任务组、预计分钟、进度和锁定状态。</p></div>
        <div className="export-card-actions">
          <button type="button" className="primary-button" disabled={!valid} onClick={() => runExport('月历 CSV', `${filenameBase}-calendar.csv`, buildCalendarCsv(state, range), 'text/csv')}><FileSpreadsheet size={16}/>下载 CSV</button>
          <button type="button" className="secondary-button" disabled={!valid} onClick={() => runExport('日历 ICS', `${filenameBase}-calendar.ics`, buildCalendarIcs(state, range), 'text/calendar')}><CalendarDays size={16}/>下载 ICS</button>
        </div>
      </article>

      <article className="export-card export-card-stats">
        <div className="export-card-icon"><FileSpreadsheet size={22}/></div>
        <div className="export-card-copy"><h3>每日学习统计</h3><p>导出原计划、实际、计划外执行、完成率、逾期和专注次数，适合继续分析。</p></div>
        <div className="export-card-actions">
          <button type="button" className="primary-button" disabled={!valid} onClick={() => runExport('统计 CSV', `${filenameBase}-statistics.csv`, buildStatisticsCsv(state, range), 'text/csv')}><Download size={16}/>下载统计 CSV</button>
        </div>
      </article>

      <article className="export-card export-card-ledger">
        <div className="export-card-icon"><Clock3 size={22}/></div>
        <div className="export-card-copy"><h3>实际时间流水</h3><p>逐条导出归属日期、任务、分钟、计时或手动来源，以及创建和修改时间。</p></div>
        <div className="export-card-actions">
          <button type="button" className="secondary-button" disabled={!valid} onClick={() => runExport('时间流水 CSV', `${filenameBase}-time-ledger.csv`, buildTimeLedgerCsv(state, range), 'text/csv')}><Download size={16}/>下载流水 CSV</button>
        </div>
      </article>

      <article className="export-card export-card-report">
        <div className="export-card-icon"><Printer size={22}/></div>
        <div className="export-card-copy"><h3>打印学习报告</h3><p>生成简洁的每日统计与月历任务报告，可以直接打印或在系统打印窗口保存为 PDF。</p></div>
        <div className="export-card-actions">
          <button type="button" className="secondary-button" disabled={!valid} onClick={openPrintReport}><Printer size={16}/>打开打印报告</button>
          <button type="button" className="text-button" disabled={!valid} onClick={() => runExport('HTML 报告', `${filenameBase}-report.html`, buildPrintableReportHtml(state, range), 'text/html')}><FileText size={16}/>下载 HTML</button>
        </div>
      </article>
    </section>

    {notice && <div className="export-notice" role="status"><CheckCircle2 size={17}/><span>{notice}</span></div>}

    <section className="export-privacy">
      <ShieldCheck size={22}/>
      <div><h3>导出文件只在本机生成</h3><p>文件可能包含个人任务与学习时间。分享前请先检查。完整 JSON 备份和恢复仍在设置页管理。</p></div>
      <button type="button" className="secondary-button" onClick={() => onNavigate('settings')}><Database size={16}/>前往备份设置</button>
    </section>
  </div>
}
