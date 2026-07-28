import type { ReplanResult } from '../types'
import { Modal } from './Modal'

export function ReplanDialog({ result, open, onClose, onApply }: { result?: ReplanResult; open: boolean; onClose: () => void; onApply: () => void }) {
  return <Modal open={open} title="重新排期预览" onClose={onClose} wide>
    {!result ? <p>正在计算……</p> : <>
      <div className="summary-grid two">
        <div className="metric-card"><span>将移动</span><strong>{result.moves.length}</strong><small>个任务</small></div>
        <div className="metric-card"><span>风险提示</span><strong>{result.warnings.length}</strong><small>条</small></div>
      </div>
      {result.warnings.length > 0 && <div className="warning-list">
        {result.warnings.slice(0, 12).map((w, i) => <div key={i} className="warning-item">{w}</div>)}
        {result.warnings.length > 12 && <p>另有 {result.warnings.length - 12} 条提示。</p>}
      </div>}
      <div className="move-list">
        {result.moves.slice(0, 30).map(move => <div key={move.assignmentId}><span>{move.from ?? '未安排'}</span><b>→</b><span>{move.to ?? '无法安排'}</span></div>)}
        {result.moves.length > 30 && <p>另有 {result.moves.length - 30} 项变动。</p>}
      </div>
      <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={onApply}>确认应用</button></div>
    </>}
  </Modal>
}
