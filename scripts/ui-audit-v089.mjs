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
add('桌面与手机底部操作区分别适配', css.includes('.adjustment-actions{position:sticky') && css.includes('.proposal-sticky-actions{position:sticky') && css.includes('env(safe-area-inset-bottom)'), '桌面粘性 footer + 手机安全区')
add('其余主要页面统一卡片层级', css.includes('.goal-card,.stats-panel,.stats-kpi,.settings-section,.group-card,.chart-card'), '目标、统计、设置、任务卡统一阴影')
add('约束列表桌面与手机分别布局', css.includes('.constraint-list article{display:grid;grid-template-columns:minmax(0,1fr) auto') && css.includes('.constraint-list article{grid-template-columns:1fr'), '桌面双区 / 手机单列')
add('表单输入保持统一高度和视觉', css.includes('.field input,.field select,.field textarea{min-height:42px}'), '表单控件统一')


add('局部操作在桌面端显示作用范围摘要', proposal.includes('proposal-scope-summary') && css.includes('.proposal-scope-summary{display:grid;grid-template-columns:'), '原操作与既有问题分层')
add('局部操作摘要在手机端回落单列', css.includes('.proposal-scope-summary{grid-template-columns:1fr') && css.includes('.proposal-scope-stats{grid-template-columns:repeat(2'), '手机单列与 2×2 数据摘要')

const passed = checks.filter(item => item.pass).length
const output = { version: '0.8.9', generatedAt: new Date().toISOString(), passed, total: checks.length, checks }
fs.mkdirSync(path.join(root, 'validation'), { recursive: true })
fs.writeFileSync(path.join(root, 'validation', 'v0.8.9界面布局审计.json'), JSON.stringify(output, null, 2))
const md = ['# Study Planner v0.8.9 界面布局审计', '', `- 通过：${passed} / ${checks.length}`, `- 生成时间：${output.generatedAt}`, '', ...checks.map(item => `- ${item.pass ? '✅' : '❌'} **${item.name}**：${item.evidence}`)]
fs.writeFileSync(path.join(root, 'validation', 'v0.8.9界面布局审计.md'), md.join('\n') + '\n')
console.log(md.join('\n'))
process.exit(passed === checks.length ? 0 : 1)
