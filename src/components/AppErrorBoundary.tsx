import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Download, RotateCcw } from 'lucide-react'

interface State { error?: Error }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      localStorage.setItem('study-planner:last-crash', JSON.stringify({ message: error.message, stack: error.stack, componentStack: info.componentStack, occurredAt: new Date().toISOString() }))
    } catch { /* Diagnostics must never cause a second crash. */ }
  }

  private downloadDiagnostics = () => {
    const content = localStorage.getItem('study-planner:last-crash') ?? JSON.stringify({ message: this.state.error?.message, occurredAt: new Date().toISOString() }, null, 2)
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `study-planner-error-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  private openRecovery = () => {
    sessionStorage.setItem('study-planner:open-recovery', '1')
    location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="fatal-error-page">
      <section>
        <AlertTriangle size={42}/>
        <span>应用已进入安全模式</span>
        <h1>这次错误没有覆盖你的本机数据</h1>
        <p>你可以重新载入，或进入数据恢复中心下载迁移前、替换前和损坏数据副本。</p>
        <details><summary>错误详情</summary><pre>{this.state.error.message}</pre></details>
        <div className="button-wrap">
          <button className="primary-button" onClick={() => location.reload()}><RotateCcw size={16}/>重新载入</button>
          <button className="secondary-button" onClick={this.openRecovery}>进入恢复中心</button>
          <button className="secondary-button" onClick={this.downloadDiagnostics}><Download size={16}/>下载诊断</button>
        </div>
      </section>
    </main>
  }
}
