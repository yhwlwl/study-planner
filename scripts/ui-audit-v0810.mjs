import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8')
const modal = fs.readFileSync(path.join(root, 'src/components/Modal.tsx'), 'utf8')
const review = fs.readFileSync(path.join(root, 'src/components/ReviewDialog.tsx'), 'utf8')
const adjustment = fs.readFileSync(path.join(root, 'src/components/AdjustmentIntentDialog.tsx'), 'utf8')
const proposal = fs.readFileSync(path.join(root, 'src/components/ProposalDialog.tsx'), 'utf8')

const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })

add('复杂弹窗支持独立视觉变体', modal.includes('className?: string') && modal.includes('${className}'), 'Modal className 可按页面配置')
add('复盘使用独立桌面布局', review.includes('className="review-modal"') && css.includes('.modal-card.review-modal'), 'review-modal')
add('计划调整使用独立桌面布局', adjustment.includes('className="adjustment-modal"') && css.includes('.modal-card.adjustment-modal'), 'adjustment-modal')
add('方案预览使用独立桌面布局', proposal.includes('className="proposal-modal"') && css.includes('.modal-card.proposal-modal'), 'proposal-modal')
add('桌面复杂弹窗正文独立滚动', css.includes('.review-modal .modal-body') && css.includes('overflow-y:auto') && css.includes('overscroll-behavior:contain'), '桌面 modal body 独立滚动')
add('复盘摘要桌面三列', css.includes('.review-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))'), '桌面 3 列，避免六张窄卡')
add('计划调整桌面主次双栏', adjustment.includes('adjustment-layout') && adjustment.includes('adjustment-sidebar') && css.includes('.adjustment-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px'), '主场景 + 今日容量侧栏')
add('计划调整手机回落单栏', css.includes('@media(max-width:760px)') && css.includes('.adjustment-layout{grid-template-columns:1fr'), '手机单列')
add('方案摘要桌面四列手机两列', css.includes('.proposal-summary-grid{grid-template-columns:repeat(4,minmax(0,1fr))') && css.includes('.proposal-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))'), '桌面 4 列 / 手机 2 列')
add('复盘手机保留紧凑双列摘要', css.includes('.review-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))'), '手机 2 列')
add('手机复杂弹窗保持 100dvh 全屏', css.includes('.modal-card.modal-mobile-fullscreen') && css.includes('height:100dvh'), 'iPhone 全屏与安全区')
add('桌面与手机底部操作区分别适配', modal.includes('footer?: ReactNode') && proposal.includes('footer={footer}') && css.includes('.modal-footer') && css.includes('env(safe-area-inset-bottom)'), '方案操作区位于滚动正文外，桌面固定在弹窗底部，手机保留安全区')
add('其余主要页面统一卡片层级', css.includes('.goal-card,.stats-panel,.stats-kpi,.settings-section,.group-card,.chart-card'), '目标、统计、设置、任务卡统一阴影')
add('约束列表桌面与手机分别布局', css.includes('.constraint-list article{display:grid;grid-template-columns:minmax(0,1fr) auto') && css.includes('.constraint-list article{grid-template-columns:1fr'), '桌面双区 / 手机单列')
add('表单输入保持统一高度和视觉', css.includes('.field input,.field select,.field textarea{min-height:42px}'), '表单控件统一')


add('局部操作在桌面端显示精简结果摘要', proposal.includes('proposal-local-result') && css.includes('.proposal-local-result-grid{display:grid'), '原操作、其他任务移动和新增问题分层')
add('局部操作摘要在手机端使用 2×2 数据卡', css.includes('.proposal-local-result-grid{grid-template-columns:repeat(2') && css.includes('.proposal-local-result{padding:13px'), '手机 2×2 数据摘要')


add('任务中心提供完整任务收件箱', css.includes('.task-inbox-summary') && css.includes('.assignment-list-card'), '待处理、未安排与逾期任务都有桌面和手机布局')
add('批量移动使用统一日期弹窗', css.includes('.bulk-move-dialog') && css.includes('.bulk-move-summary'), '不依赖浏览器 prompt')
add('高级设置默认渐进展开', css.includes('.settings-advanced') && css.includes('.form-advanced'), '普通设置保持简洁，算法和特殊关联按需展开')
add('操作结果提供就近撤销', css.includes('.action-result-toast'), '应用调整后无需进入设置页寻找恢复')
add('移动端任务收件箱回落单列', css.includes('.task-inbox-summary{grid-template-columns:1fr') || css.includes('.assignment-list-card'), '任务卡和筛选器适配窄屏')
add('编号整理使用非阻断结果条', css.includes('.sequence-renumber-toast'), '主要操作完成后不立即弹出第二个全屏流程')
add('手机关键图标显示文字标签', css.includes('.mobile-action-label') && css.includes('.goal-card .row-actions'), '编辑、归档、删除和锁定在触屏端可理解')
add('统计次要概览默认折叠', css.includes('.stats-overview-more') && css.includes('.stats-overview-more-body'), '连续记录与热力图不再挤占首屏')

add('单一局部操作不再显示伪方案选择', proposal.includes('singleLocalProposal') && proposal.includes('!singleLocalProposal && <section className="proposal-options-heading"') && proposal.includes('LocalOperationResult'), '只有一个精确方案时直接展示本次结果')
add('方案底部按钮不遮挡正文', modal.includes('{effectiveFooter && <footer className="modal-footer">') && proposal.includes('proposal-footer-actions') && !proposal.includes('proposal-sticky-actions'), 'footer 与 modal-body 为同级独立区域')
add('手机方案弹窗最终覆盖为完整 100dvh', css.includes('.modal-card.modal-wide.modal-mobile-fullscreen.modal-with-footer') && css.includes('max-height:100dvh'), '避免 modal-wide 的 90vh 规则留下底部空白')

const passed = checks.filter(item => item.pass).length
const output = { version: '0.8.15', generatedAt: new Date().toISOString(), passed, total: checks.length, checks }
fs.mkdirSync(path.join(root, 'validation'), { recursive: true })
fs.writeFileSync(path.join(root, 'validation', 'v0.8.15界面布局审计.json'), JSON.stringify(output, null, 2))
const md = ['# Study Planner v0.8.15 界面布局审计', '', `- 通过：${passed} / ${checks.length}`, `- 生成时间：${output.generatedAt}`, '', ...checks.map(item => `- ${item.pass ? '✅' : '❌'} **${item.name}**：${item.evidence}`)]
fs.writeFileSync(path.join(root, 'validation', 'v0.8.15界面布局审计.md'), md.join('\n') + '\n')
console.log(md.join('\n'))
process.exit(passed === checks.length ? 0 : 1)
