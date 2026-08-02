import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const app = read('src/App.tsx')
const taskCard = read('src/components/TaskCard.tsx')
const review = read('src/components/ReviewDialog.tsx')
const settings = app
const statsPage = read('src/components/StatsPage.tsx')
const statsLib = read('src/lib/stats.ts')
const modal = read('src/components/Modal.tsx')
const drawer = read('src/components/Drawer.tsx')

const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })

add('计时任务完成入口回到计时结算', /if \(active\)/.test(taskCard) && /onOpenTimer\(assignment\)/.test(taskCard), 'TaskCard 不直接清空活动计时器')
add('陈旧计时状态仍有实际分钟兜底', /activeTimerMinutes/.test(app) && /source:\s*activeTimerMinutes/.test(app), 'Today 完成弹窗保留极端状态兜底')
add('Today 区分原计划、实际、剩余和执行负载', /原计划/.test(app) && /已发生实际/.test(app) && /剩余预计/.test(app) && /执行负载/.test(app), '首页与复盘口径可解释')
add('Today 负载使用实际加剩余口径', /planningDayLoad\(state, date\)/.test(app) && /executionLoad/.test(app), '容量风险统一基于真实执行快照')
add('任务页覆盖所有任务状态', /任务收件箱/.test(app) && /未安排/.test(app) && /逾期/.test(app) && /已完成/.test(app), '具体任务与任务组分离')
add('复盘暂不顺延仍可找回', /任务 → 待处理/.test(review) && /pendingPastTasks/.test(app), '任务收件箱和首页提醒均可进入')
add('批量顺延只有一个最终确认点', /批量顺延设置/.test(app) && /生成完整预览/.test(app) && !/应用批量顺延/.test(app), '设置页只生成统一预览')
add('删除入口直接进入统一预览', /prepareAssignmentDelete\(taskOpen.id\)/.test(app) && !/确认移除该任务/.test(app), '不再前置重复确认')
add('任务时长变化按最小作用域预览', /requestedChangeKind:\s*'assignment-duration'/.test(app) && /日期保持不变/.test(app), '只处理本次新增或恶化问题')
add('文本编辑使用草稿后一次保存', /taskTitleDraft/.test(app) && /pendingDayNote/.test(app) && /保存基本信息/.test(app), '避免每个字符占用撤销历史')
add('批量移动使用日期选择器', /bulkMoveDialog/.test(app) && /预览批量移动/.test(app) && !/window\.prompt\('输入目标日期/.test(app), '桌面和手机均使用同一日期表单')
add('导入和恢复先预览差异', /replacementPreview/.test(settings) && /覆盖当前计划前预览/.test(settings), 'JSON、云端和冲突备份统一预览')
add('算法和维护设置默认折叠', /settings-advanced/.test(settings) && /高级排期设置|恢复与维护/.test(settings), '普通用户不先面对内部参数')
add('模态草稿不会因误点背景消失', !/onMouseDown=\{onClose\}/.test(modal + drawer), '长表单只通过明确关闭或取消退出')
add('统计页使用独立纯函数', /from '..\/lib\/stats'/.test(statsPage) && /export function aggregateDaily/.test(statsLib), '统计口径可独立运行验证')
add('今日容量只在相关场景询问', /showTodayCapacity/.test(read('src/components/AdjustmentIntentDialog.tsx')), '减负和复盘差异不重复询问无关条件')
add('计划调整入口显示当前问题数量', /currentIssueCount/.test(app) && /计划问题/.test(app), '无问题时保持普通入口，有问题时直接显示数量')
add('编号整理不再自动打断主流程', /sequence-renumber-toast/.test(app) && /查看编号建议/.test(app) && /detailsOpen/.test(app), '先以非阻断结果条提示，用户主动展开后再决定')
add('手机关键图标具有可见文字', /mobile-action-label/.test(read('src/components/GoalsPage.tsx')) && /task-lock-action/.test(taskCard), '目标编辑归档删除和任务锁定在窄屏可读')
add('统计概览默认只保留主结论和主图', /stats-overview-more/.test(statsPage) && /查看连续记录和学习热力图/.test(statsPage), '连续记录与热力图按需展开')
add('方案卡首屏收敛计算指标', !read('src/components/ProposalDialog.tsx').includes('{display.metrics.stabilityScore}% 稳定性'), '稳定性计算仍保留在详情，不占据首选方案摘要')

let runtimeStatsPass = false
let runtimeStatsEvidence = ''
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-planner-stats-test-'))
try {
  const compile = spawnSync('tsc', ['src/lib/stats.ts', 'src/types.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--outDir', temp, '--skipLibCheck', '--strict', '--noEmitOnError'], { cwd: root, encoding: 'utf8' })
  if (compile.status !== 0) throw new Error((compile.stdout + compile.stderr).trim())
  fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}')
  const mod = await import(`${pathToFileURL(path.join(temp, 'lib/stats.js')).href}?v=${Date.now()}`)
  const date = '2026-08-01'
  const group = { id: 'g', title: '测试组', subject: '数学', priority: 3, quantity: 2, unitMinutes: 60, dailyMax: 3, activityType: 'normal', highIntensity: false, countInStats: true, status: 'active', createdAt: '', updatedAt: '' }
  const base = { groupId: 'g', scheduledDate: date, estimatedMinutes: 60, progress: 100, status: 'done', locked: false, scheduleSource: 'system', intentStrength: 'normal', createdAt: '', updatedAt: '', completedAt: `${date}T12:00:00.000Z` }
  const assignments = [
    { ...base, id: 'a', index: 1, title: '有明细', actualMinutes: 60, timeEntries: [{ id: 'e', minutes: 40, createdAt: `${date}T10:00:00.000Z`, source: 'timer' }] },
    { ...base, id: 'b', index: 2, title: '旧数据', actualMinutes: 30, timeEntries: [] },
  ]
  const row = mod.aggregateDaily(assignments, new Map([['g', group]]), false, date, date)[0]
  runtimeStatsPass = row.actual === 90 && row.timerActual === 40 && row.legacyActual === 50
  runtimeStatsEvidence = `actual=${row.actual}; timer=${row.timerActual}; legacy=${row.legacyActual}`
} catch (error) {
  runtimeStatsEvidence = error instanceof Error ? error.message : String(error)
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
add('实际时间与旧数据残差各只计算一次', runtimeStatsPass, runtimeStatsEvidence)

const passed = checks.filter(item => item.pass).length
const result = { version: '0.8.13', generatedAt: new Date().toISOString(), passed, total: checks.length, checks }
fs.mkdirSync(path.join(root, 'validation'), { recursive: true })
fs.writeFileSync(path.join(root, 'validation', 'v0.8.13用户效率验证.json'), JSON.stringify(result, null, 2))
const lines = ['# Study Planner v0.8.13 用户效率验证', '', `- 通过：${passed} / ${checks.length}`, `- 生成时间：${result.generatedAt}`, '', ...checks.map(item => `- ${item.pass ? '✅' : '❌'} **${item.name}**：${item.evidence}`)]
fs.writeFileSync(path.join(root, 'validation', 'v0.8.13用户效率验证.md'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
if (passed !== checks.length) process.exit(1)
