#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const exists = file => fs.existsSync(path.join(root, file))
const source = {
  app: read('src/App.tsx'), context: read('src/AppContext.tsx'), tutorial: read('src/lib/tutorial.ts'),
  adjustment: read('src/components/AdjustmentIntentDialog.tsx'), intake: read('src/components/IntakePage.tsx'),
  goals: read('src/components/GoalsPage.tsx'), review: read('src/components/ReviewDialog.tsx'),
  proposal: read('src/components/ProposalDialog.tsx'), task: read('src/components/TaskCard.tsx'),
  coach: read('src/components/TutorialCoachmark.tsx'), css: read('src/tutorial.css'), types: read('src/types.ts'),
}
const results = []
const check = (group, name, ok) => results.push({ group, name, ok: Boolean(ok) })
const has = (text, ...needles) => needles.every(needle => text.includes(needle))
const lacks = (text, ...needles) => needles.every(needle => !text.includes(needle))

check('数据隔离', '独立教程 namespace', has(source.tutorial, 'TUTORIAL_NAMESPACE = `tutorial:v${TUTORIAL_VERSION}`'))
check('数据隔离', '教程模板类型独立', has(source.types, "'summer' | 'demo' | 'blank' | 'tutorial'"))
check('数据隔离', '进入教程前保存原空间', has(source.app, 'if (returnHadData) await setDataSpace(returnNamespace, stateRef.current, false)'))
check('数据隔离', '教程不进入账号普通云上传', has(source.app, 'namespace !== `user:${sessionUser.id}`'))
check('数据隔离', '退出失败不清 session', has(source.app, '暂时无法恢复你的原计划，请稍后再退出教程', 'if (!switched) return'))
check('数据隔离', '退出后清理教程空间', has(source.app, 'clearDataSpace(TUTORIAL_NAMESPACE)'))

const steps = ['repair-entry','repair-action','repair-preview','goal','intake','intake-preview','execute','review-entry','review-carry','review-preview','future-entry','future-action','future-preview','complete','free']
for (const step of steps) check('状态机', `步骤 ${step}`, source.tutorial.includes(`'${step}'`))
check('状态机', '重复推进幂等', has(source.tutorial, 'if (!allowed.includes(session.step)) return session'))
check('状态机', '提交锁防双击', has(source.app, 'tutorialTransitionRunning.current'))
check('状态机', '刷新只把瞬态步骤恢复到安全 checkpoint', has(source.tutorial, "'repair-preview': 'repair-entry'", "'intake-preview': 'intake'", "'review-preview': 'review-entry'", "'future-preview': 'future-entry'"))
check('状态机', '运行时不再每次 state 变化自动跳回', lacks(source.app, 'tutorialStateHealth(state, current)', '教程状态已自动恢复到当前步骤'))
check('状态机', '版本/日期损坏会拒绝旧 session', has(source.tutorial, 'parsed.version !== TUTORIAL_VERSION', 'isISODate(parsed.anchorDate)'))
check('状态机', '跨午夜固定 anchor clock', has(source.tutorial, 'setNowProvider(() => new Date(`${anchorDate}T12:00:00`))'))

check('真实流程', '修复事件显式包含受影响任务', has(source.adjustment, 'const affectedAssignmentIds = Array.from(new Set', '...overdueAssignments.map(item => item.id)'))
check('真实流程', '修复事件覆盖逾期任务', has(source.adjustment, 'overdueAssignments', '需要重新安排'))
check('真实流程', '教程调用正式 generateProposals', has(source.app, 'generateProposals(prepared, event, baseline, undefined, 0)'))
check('真实流程', '教程不再调用写死修复结果', lacks(source.app, 'buildTutorialRepairedFrom(prepared'))
check('真实流程', '教程不再调用写死录入排期结果', lacks(source.app, 'buildTutorialScheduledFrom(baseline'))
check('真实流程', '教程不再调用写死未来重排结果', lacks(source.app, 'buildTutorialFutureFrom(prepared'))
check('真实流程', 'Proposal 应用的是 stateAfter', has(source.app, 'tutorialProposalState(proposal)'))
check('真实流程', '应用前只做 checkpoint 验证且失败留在当前页', has(source.app, '这个方案暂时不能进入下一步', 'return false'))
check('真实流程', '指定执行任务有手动安排保护', has(source.tutorial, "id: TUTORIAL_EXECUTE_ASSIGNMENT_ID", "intentStrength: 'manual'", "scheduleSource: 'manual'"))
check('真实流程', '复盘顺延优先下一天且有合法 fallback', has(source.review, 'tutorialPreferredTarget', 'legalOptions.includes(tutorialPreferredTarget)', 'legalOptions.slice(0, 1)'))
check('真实流程', '未来重排是独立 future event', has(source.tutorial, "event.type === 'future-replanning'"))
check('真实流程', '结束展示闭环', has(source.app, '目标 → 排期 → 执行 → 复盘 → 调整'))

check('可见限制', '侧栏入口完整显示而非 native disabled', has(source.app, 'aria-disabled={tutorialDisabled || undefined}', 'onClick={() => navigate(item.id)}') && !has(source.app, 'disabled={tutorialDisabled}'))
check('可见限制', '重排中心全部 action group 仍渲染', has(source.adjustment, 'group.items.map(item =>', 'blocked={!allowedTutorialAction}'))
check('可见限制', '重排中心录入入口教程中仍显示', lacks(source.adjustment, '!tutorialMode && <section className="adjustment-related-entry"'))
check('可见限制', '今日常用操作由点击拦截而非隐藏', has(source.app, "tutorialMode ? onTutorialBlocked?.('教程中", 'aria-disabled={tutorialMode || undefined}'))
check('可见限制', 'TaskCard 更多/计时/锁定仍可见且受限', has(source.task, 'tutorial-disabled-control', 'onTutorialBlocked'))
check('可见限制', '目标创建编辑归档删除仍可见', has(source.goals, 'tutorial-disabled-control', '创建目标', '删除目标'))
check('可见限制', '录入新增/粘贴/导入/编辑/删除仍可见', has(source.intake, '添加任务', '自然语言 / 粘贴清单', '导入文件', '编辑 ${item.title}', '删除 ${item.title}'))
check('可见限制', 'Review 更多方案/仅保存仍可见', has(source.review, '获取更多方案', '仅保存复盘，暂不顺延', 'tutorial-disabled-control'))
check('可见限制', 'Proposal 保留/更多方案仍可见', has(source.proposal, 'proposal-keep-action', '生成更多不同方案（教程中暂不可用）'))
check('可见限制', 'Proposal 逐项微调仍显示但控件禁用', has(source.proposal, '教程中完整展示该功能，但本步固定使用推荐结果。', 'disabled={tutorialMode}'))
check('可见限制', '业务层普通 commit 仍有白名单', has(source.context, 'tutorialAllowsCommit(readTutorialSession()', 'guidedTutorialMutationBlocked(namespaceRef.current)'))

check('引导布局', 'Coachmark 是文档流 aside', has(source.coach, '<aside className="tutorial-coachmark"'))
check('引导布局', 'Coachmark 不做 fixed 定位', lacks(source.css, '.tutorial-coachmark {\n  position: fixed'))
check('引导布局', 'Coachmark 不使用 MutationObserver 跟踪', lacks(source.coach, 'MutationObserver'))
check('引导布局', '目标离屏时一次性滚动', has(source.coach, 'scrollIntoView'))
check('引导布局', '引导有 region 与 polite live', has(source.coach, 'role="region"', 'aria-live="polite"'))
check('引导布局', '手机 safe area 与横向边距', has(source.css, 'env(safe-area-inset-bottom)', '@media (max-width: 640px)'))

check('健康检查', '初始健康不再绑定精确问题数量', lacks(source.tutorial, 'tutorialIssueCount(state, anchor) !== 3'))
check('健康检查', '健康检查仍保护完成与锁定历史', has(source.tutorial, '教程锁定完成任务状态异常', '教程历史完成记录异常'))
check('健康检查', '复盘候选接受任意合法未来日期', has(source.tutorial, '.some(date => date > anchorDate)'))
check('健康检查', '教程读取损坏时用 checkpoint 恢复', has(source.app, '教程本地状态读取失败，使用当前版本 checkpoint 恢复。'))

check('验证资产', '教程单元测试存在', exists('tests/tutorial.test.ts'))
check('验证资产', '流程审计文档存在', exists('docs/TUTORIAL_FLOW_AUDIT.md'))
check('验证资产', '静态流程审计脚本存在', exists('scripts/tutorial-flow-audit.mjs'))

const failed = results.filter(item => !item.ok)
const groups = new Map()
for (const r of results) {
  const row = groups.get(r.group) ?? { total: 0, passed: 0 }
  row.total++; if (r.ok) row.passed++; groups.set(r.group, row)
}
for (const [group,row] of groups) console.log(`${row.passed === row.total ? 'PASS' : 'FAIL'} ${group}: ${row.passed}/${row.total}`)
console.log(`\n${failed.length ? 'FAIL' : 'PASS'} tutorial-flow-audit: ${results.length - failed.length}/${results.length}`)
for (const r of failed) console.error(`- [${r.group}] ${r.name}`)
if (failed.length) process.exit(1)
