#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const exists = file => fs.existsSync(path.join(root, file))
const source = {
  app: read('src/App.tsx'),
  context: read('src/AppContext.tsx'),
  tutorial: read('src/lib/tutorial.ts'),
  adjustment: read('src/components/AdjustmentIntentDialog.tsx'),
  intake: read('src/components/IntakePage.tsx'),
  goals: read('src/components/GoalsPage.tsx'),
  review: read('src/components/ReviewDialog.tsx'),
  proposal: read('src/components/ProposalDialog.tsx'),
  task: read('src/components/TaskCard.tsx'),
  coach: read('src/components/TutorialCoachmark.tsx'),
  css: read('src/tutorial.css'),
  types: read('src/types.ts'),
}

const results = []
function check(group, name, condition, detail = '') {
  results.push({ group, name, ok: Boolean(condition), detail })
}
function has(text, ...needles) { return needles.every(needle => text.includes(needle)) }
function count(text, needle) { return text.split(needle).length - 1 }

check('数据隔离', '教程使用独立 namespace', has(source.tutorial, "TUTORIAL_NAMESPACE = `tutorial:v${TUTORIAL_VERSION}`"))
check('数据隔离', '教程模板类型独立', has(source.types, "'summer' | 'demo' | 'blank' | 'tutorial'"))
check('数据隔离', '进入教程前保存原数据空间', has(source.app, 'if (returnHadData) await setDataSpace(returnNamespace, stateRef.current, false)'))
check('数据隔离', '退出教程清理教程空间', has(source.app, 'clearDataSpace(TUTORIAL_NAMESPACE)'))
check('数据隔离', '教程期间阻断账号云恢复切换', has(source.app, 'tutorialSession || isTutorialNamespace(namespace)'))
check('数据隔离', '教程 namespace 不进入普通账号自动上传', has(source.app, 'namespace !== `user:${sessionUser.id}`'))
check('数据隔离', '认证变化不会替换教程数据', has(source.app, 'if (tutorialRunning)', 'it must never replace tutorial data mid-step'))
check('数据隔离', '首次账号教程结束可初始化独立空白账号计划', has(source.app, "教程已结束，已创建独立的空白个人计划。"))

const expectedSteps = ['repair-entry','repair-action','repair-preview','goal','intake','intake-preview','execute','review-entry','review-carry','review-preview','future-entry','future-action','future-preview','complete','free']
for (const step of expectedSteps) check('状态机', `存在步骤 ${step}`, source.tutorial.includes(`'${step}'`))
check('状态机', '瞬态 repair 可恢复', has(source.tutorial, "'repair-action': 'repair-entry'", "'repair-preview': 'repair-entry'"))
check('状态机', '瞬态 intake 可恢复', has(source.tutorial, "'intake-preview': 'intake'"))
check('状态机', '瞬态 review 可恢复', has(source.tutorial, "'review-carry': 'review-entry'", "'review-preview': 'review-entry'"))
check('状态机', '瞬态 future replan 可恢复', has(source.tutorial, "'future-action': 'future-entry'", "'future-preview': 'future-entry'"))
check('状态机', '步骤推进要求 expected-step 匹配', has(source.tutorial, 'if (!allowed.includes(session.step)) return session'))
check('状态机', '运行时有 transition 防重复提交', count(source.app, 'tutorialTransitionRunning.current') >= 8)
check('状态机', '状态损坏会自动 health-check 恢复', has(source.app, 'tutorialStateHealth(state, current)', '教程状态已自动恢复到当前步骤'))
check('状态机', '教程版本不匹配会丢弃旧 session', has(source.tutorial, 'parsed.version !== TUTORIAL_VERSION'))
check('状态机', '教程日期 anchor 格式验证', has(source.tutorial, 'isISODate(parsed.anchorDate)'))
check('状态机', '跨午夜冻结教程时钟', has(source.tutorial, 'setNowProvider(() => new Date(`${anchorDate}T12:00:00`))'))

check('核心流程', '初始计划有固定 3 类问题健康断言', has(source.tutorial, 'tutorialIssueCount(state, anchor) !== 3'))
check('核心流程', '修复当前问题入口有唯一教程动作', has(source.adjustment, "tutorialMode ? group.items.filter", "'current-conflicts'"))
check('核心流程', '修复通过真实预览后才能应用', has(source.app, "previewPreparedChange(baseline, target, event, '教程推荐方案')", "'repair-preview'"))
check('核心流程', '目标步骤定位固定教程目标', has(source.tutorial, "TUTORIAL_GOAL_ID = 'tutorial-goal-math'", source.app.includes("target: 'tutorial-goal'") ? 'tutorial-goal' : '__missing__'))
check('核心流程', '录入固定教程批次', has(source.tutorial, "id: 'tutorial-intake-batch'", "name: '刚收到的新作业'"))
check('核心流程', '录入阶段只能使用指定 batch 事件', has(source.tutorial, "event.metadata?.intakeBatchId === 'tutorial-intake-batch'"))
check('核心流程', '录入必须先进入排期预览', has(source.intake, 'data-tutorial-target="schedule-intake"'))
check('核心流程', '执行阶段固定指定任务', has(source.tutorial, "TUTORIAL_EXECUTE_ASSIGNMENT_ID = 'tutorial-task-math-today'"))
check('核心流程', '执行实际用时限制在安全范围', has(source.app, "tutorialMode ? 65 : 1440", 'Number(actual) > 65'))
check('核心流程', '今日复盘入口只在指定步骤开放', has(source.app, "tutorialStep === 'review-entry'", 'data-tutorial-target={tutorialMode'))
check('核心流程', '复盘自动只给一个合法顺延日期', has(source.review, 'const tutorialTarget = shiftDate(date, 1)', 'candidate === tutorialTarget'))
check('核心流程', '复盘顺延仍进入 proposal preview', has(source.app, "tutorial?.step === 'review-carry'", 'openPrepared(prepared, event)'))
check('核心流程', '未来重排教程固定均衡取舍', has(source.adjustment, "item !== 'balanced'", "tutorialMode === 'future'"))
check('核心流程', '未来重排与修复使用不同事件', has(source.tutorial, "event.type === 'future-replanning'", "requestedOutcome === 'fix-current'"))
check('核心流程', '教程结束展示完整闭环', has(source.app, '目标 → 排期 → 执行 → 复盘 → 调整'))

check('操作限制', '侧栏错误页面 disabled', has(source.app, 'const tutorialDisabled', 'disabled={tutorialDisabled}'))
check('操作限制', '教程中禁止日期前后切换', count(source.app, 'disabled={tutorialMode}') >= 2)
check('操作限制', '教程中隐藏今日新增/日历/批量顺延', has(source.app, '{!tutorialMode && <><button className="primary-button subtle-action"'))
check('操作限制', '非指定任务不能完成', has(source.app, "tutorialStep !== 'execute' || a.id !== tutorialTargetId"))
check('操作限制', '教程 TaskCard 禁止拖拽和更多操作', has(source.task, '!tutorialLocked && !assignment.locked', '!tutorialLocked && <div className="task-actions"'))
check('操作限制', '目标页禁止新建编辑归档删除', count(source.goals, 'tutorialMode') >= 5)
check('操作限制', '录入页禁止增删改导入选择', count(source.intake, 'tutorialMode') >= 14)
check('操作限制', 'Proposal 教程隐藏保留/更多方案/逐项微调', has(source.proposal, '!tutorialMode && keepLabel', '!tutorialMode && !singleLocalProposal', '!tutorialMode && !proposal.infeasible'))
check('操作限制', 'Review 教程隐藏保存但不顺延/更多方案', has(source.review, '{!tutorialMode && <><button className="review-finish-option"'))
check('操作限制', 'Adjustment 教程隐藏无关录入入口', has(source.adjustment, '{!tutorialMode && <section className="adjustment-related-entry">'))
check('操作限制', 'AppContext 普通 commit 有教程业务白名单', has(source.context, 'tutorialAction?: string', 'tutorialAllowsCommit(readTutorialSession(), options?.tutorialAction, options?.tutorialTargetId)'))
check('操作限制', 'AppContext undo 在引导阶段阻断', has(source.context, 'const undo = useCallback', 'if (namespaceRef.current === TUTORIAL_NAMESPACE && !tutorialAllowsCommit(readTutorialSession())) return'))
check('操作限制', 'AppContext 直接 mutation 也有底层拦截', count(source.context, 'guidedTutorialMutationBlocked(namespaceRef.current)') >= 7)
check('操作限制', '教程中不弹编号重排干扰', has(source.context, 'if (namespace === TUTORIAL_NAMESPACE) { setSequenceRenumberSuggestion(undefined); return }'))

check('一致性', '修复结果由固定 checkpoint 构造', has(source.app, 'buildTutorialRepairedFrom(prepared, tutorial.anchorDate)'))
check('一致性', '录入结果由固定 checkpoint 构造', has(source.app, 'buildTutorialScheduledFrom(baseline, tutorial.anchorDate)'))
check('一致性', '未来重排结果由固定 checkpoint 构造', has(source.app, 'buildTutorialFutureFrom(prepared, tutorial.anchorDate)'))
check('一致性', '每个 proposal 应用前检查目标 checkpoint 健康', has(source.app, 'tutorialStateHealth(nextState, candidateSession)'))
check('一致性', '教程应用使用 proposal.stateAfter，而非另造状态', has(source.app, 'tutorialProposalState(proposal)'))
check('一致性', '固定新增任务重复构造不会叠加', has(source.tutorial, 'state.taskGroups = state.taskGroups.filter(item => !canonicalGroupIds.has(item.id))'))

check('移动端与可访问性', 'Coachmark 不使用全屏遮罩', !source.coach.includes('overlay') && !source.css.includes('tutorial-overlay'))
check('移动端与可访问性', 'Coachmark 限宽并可滚动', has(source.css, 'width: min(320px', 'max-height:', 'overflow: auto'))
check('移动端与可访问性', 'Coachmark 底部通知考虑 safe-area', has(source.css, 'env(safe-area-inset-bottom)'))
check('移动端与可访问性', 'Coachmark 为可命名 region 且 polite announce', has(source.coach, 'role="region"', 'aria-label="互动体验引导"', 'aria-live="polite"'))
check('移动端与可访问性', '目标 DOM 不可见时自动滚动', has(source.coach, 'scrollIntoView'))
check('移动端与可访问性', '禁止操作提示使用 status', has(source.app, 'tutorial-blocked-notice" role="status"'))

check('故障恢复', '教程持久化失败不会中断当前标签页', has(source.app, '教程状态暂时无法持久化；当前标签页仍可继续。', 'return false'))
check('故障恢复', '退出前恢复原数据失败时保留教程 session', has(source.app, '暂时无法恢复你的原计划，请稍后再退出教程', 'if (!switched) return'))
check('故障恢复', '教程本地状态读取失败使用 checkpoint', has(source.app, '教程本地状态读取失败，使用当前版本 checkpoint 恢复。', 'await persistTutorialState(fallback)'))
check('故障恢复', '教程空间清理失败不阻断退出', has(source.app, 'clearDataSpace(TUTORIAL_NAMESPACE).catch(() => undefined)'))
check('故障恢复', '新账号云端初始化失败保留本地空白计划', has(source.app, '个人计划已保存在本机；云端初始化失败'))
check('故障恢复', '固定 Review 顺延候选由 planner 合法日期校验', has(source.tutorial, 'suggestMoveDates(state, item.id, 8).includes(tutorialTarget)'))

check('验证资产', '存在教程单元测试', exists('tests/tutorial.test.ts'))
check('验证资产', '存在完整流程审计文档', exists('docs/TUTORIAL_FLOW_AUDIT.md'))
check('验证资产', '不存在临时源码导出 workflow', !exists('.github/workflows/_temporary-source-export.yml'))

const failed = results.filter(item => !item.ok)
const groups = new Map()
for (const result of results) {
  const row = groups.get(result.group) ?? { total: 0, passed: 0 }
  row.total += 1
  if (result.ok) row.passed += 1
  groups.set(result.group, row)
}

for (const [group, row] of groups) console.log(`${row.passed === row.total ? 'PASS' : 'FAIL'} ${group}: ${row.passed}/${row.total}`)
console.log(`\n${failed.length ? 'FAIL' : 'PASS'} tutorial-flow-audit: ${results.length - failed.length}/${results.length}`)
if (failed.length) {
  for (const item of failed) console.error(`- [${item.group}] ${item.name}${item.detail ? `: ${item.detail}` : ''}`)
  process.exit(1)
}
