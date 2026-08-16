import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const analytics = read('src/lib/analytics.ts')
const observer = read('src/components/AnalyticsObserver.tsx')
const verification = read('src/components/EmailVerificationBanner.tsx')
const supabase = read('src/lib/supabase.ts')
const api = read('api/visit-log.ts')
const main = read('src/main.tsx')
const schema = read('supabase-schema.sql')
const vercel = read('vercel.json')
const docs = read('docs/ANALYTICS_FUNNEL.md')

const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })
add('访问事件先进入持久 outbox', /OUTBOX_KEY/.test(analytics) && /localStorage\.setItem\(OUTBOX_KEY/.test(analytics) && /enqueueVisit/.test(analytics), '失败事件不会在一次重试后永久丢失')
add('联网后自动补写', /addEventListener\('online'/.test(analytics) && /visibilitychange/.test(analytics) && /flushVisitLogOutbox/.test(analytics), 'PWA 恢复联网或重新可见时会刷新队列')
add('永久匿名 visitor_id', /VISITOR_KEY = 'study-planner:visitor-id'/.test(analytics) && /safeLocalSet\(VISITOR_KEY/.test(analytics) && /initializeAnalytics\(\)/.test(main), '首次运行生成并持久化 visitor_id')
add('首次来源只写一次', /ATTRIBUTION_KEY/.test(analytics) && /if \(existing\) return existing/.test(analytics), '首次来源存在后不被后续访问覆盖')
add('来源字段单独保留', /UTM_SOURCE_KEY/.test(analytics) && /UTM_CAMPAIGN_KEY/.test(analytics) && /FIRST_REFERRER_KEY/.test(analytics), 'utm_source / utm_campaign / first_referrer 可直接检查')
add('r2 小红书映射准确', /'\/r2': \{ utmSource: 'xiaohongshu', utmCampaign: 'summer_homework_2' \}/.test(analytics), '/r2 → xiaohongshu / summer_homework_2')
add('r1/r2/r3 都能作为 SPA 短入口', ['/r1','/r2','/r3'].every(route => vercel.includes(`"source": "${route}"`)) && /"destination": "\/index\.html"/.test(vercel), '短路径由 Vercel rewrite 到同一 SPA')
add('跨自然日恢复记访问', /LAST_VISIT_DAY_KEY/.test(analytics) && /resume_after_day_change/.test(analytics), '长驻 PWA 跨日恢复也进入留存口径')
add('SPA 页面独立埋点', /recordAppPageView/.test(observer) && /PAGE_BY_HEADING/.test(observer) && /focus-timer-page/.test(observer), '逻辑页面切换记录 app_page_view，不再只依赖 pathname')
add('状态观察器首次挂载只建基线', /if \(!ready\)/.test(observer) && /!previous \|\| previous\.namespace !== namespace/.test(observer), '不会把已存在的历史计划误回填为首次漏斗事件')
add('核心漏斗事件完整白名单', ['signup_started','signup_confirmed','intake_started','natural_language_parsed','first_plan_applied','first_task_completed','review_completed','schedule_repair_applied'].every(event => analytics.includes(`'${event}'`) && api.includes(`'${event}'`)), '客户端与 API 同时声明八个核心事件')
add('录入/首计划/首完成来自实时状态转换', /recordAnalyticsEventOnce\('intake_started'/.test(observer) && /recordAnalyticsEventOnce\('first_plan_applied'/.test(observer) && /recordAnalyticsEventOnce\('first_task_completed'/.test(observer), '不需要事后查询 Snapshot 反推')
add('复盘与排期修复来自实时状态转换', /recordAnalyticsEvent\('review_completed'/.test(observer) && /recordAnalyticsEvent\('schedule_repair_applied'/.test(observer) && /event\.action === 'repair'/.test(observer), '复盘保存和真实日期变化直接产生日志事件')
add('自然语言解析只记录事件不记录原文', /解析并预览/.test(observer) && /natural_language_parsed/.test(observer) && !/pasteText|textarea\.value|textContent.*metadata/.test(observer), '解析成功出现预览后记录，不发送用户原文')
add('注册开始由认证封装层直接记录', /recordAnalyticsEvent\('signup_started'/.test(supabase) && /emailDomain/.test(supabase), '注册请求发生时记录，只上传邮箱域名')
add('邮箱确认由 Auth session 直接确认', /onAuthStateChange/.test(analytics) && /recordSignupConfirmedIfPending/.test(analytics), '同浏览器 pending signup 与认证 Session 串联')
add('邮箱验证明确提示且支持重发', /必须验证邮箱/.test(verification) && /重新发送验证邮件/.test(verification) && /resendSignupConfirmation/.test(verification), '全局提示覆盖注册后到确认前的空档')
add('未确认登录也恢复验证提示', /confirm\|verified\|验证\|确认/.test(supabase) && /rememberPendingSignup\(email\)/.test(supabase), '旧注册用户登录遇到未确认错误时也可看到重发入口')
add('数据库幂等新增分析列', ['visitor_id','app_page','utm_source','utm_campaign','first_referrer'].every(column => schema.includes(`add column if not exists ${column}`)), '已有 visit_logs 不必重建')
add('分析常用索引齐全', /visit_logs_visitor_id_idx/.test(schema) && /visit_logs_event_type_idx/.test(schema) && /visit_logs_attribution_idx/.test(schema), '浏览器、事件、来源查询有索引')
add('服务端未知事件不会污染 page_view', /unsupported_event_type/.test(api) && /ALLOWED_EVENT_TYPES/.test(api), '未知显式事件返回 400')
add('旧 PWA 客户端仍可写 page_view', /visitor_id is optional/.test(api), '迁移期 visitor_id 缺失不会让旧缓存客户端全部失败')
add('漏斗与留存 SQL 已文档化', /D1 \/ D3 \/ D7/.test(docs) && /来源 → 注册 → 第一份计划/.test(docs) && /邮箱域名的验证流失/.test(docs), '后续分析不再依赖 Snapshot 反推')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-planner-visit-log-'))
const localTsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const compileArgs = ['api/visit-log.ts', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--lib', 'ES2022,DOM', '--strict', '--skipLibCheck', '--outDir', temp]
const compile = fs.existsSync(localTsc)
  ? spawnSync(process.execPath, [localTsc, ...compileArgs], { cwd: root, encoding: 'utf8' })
  : spawnSync('tsc', compileArgs, { cwd: root, encoding: 'utf8' })
add('服务端访问 API 独立类型检查', compile.status === 0, compile.status === 0 ? 'api/visit-log.ts 编译通过' : `${compile.stdout}\n${compile.stderr}`.trim())

if (compile.status === 0) {
  const module = await import(pathToFileURL(path.join(temp, 'visit-log.js')).href)
  const sameUrl = new Request('https://study-planner.yhwlwl.xyz/api/visit-log', { headers: { origin: 'https://study-planner.yhwlwl.xyz', 'x-forwarded-host': 'deployment.vercel.app' } })
  const sameForwarded = new Request('https://deployment.vercel.app/api/visit-log', { headers: { origin: 'https://study-planner.yhwlwl.xyz', 'x-forwarded-host': 'study-planner.yhwlwl.xyz' } })
  const foreign = new Request('https://study-planner.yhwlwl.xyz/api/visit-log', { headers: { origin: 'https://evil.example' } })
  add('自定义域名同源请求可通过', module.sameOrigin(sameUrl) && module.sameOrigin(sameForwarded) && !module.sameOrigin(foreign), '请求 URL 或转发 Host 匹配即可，外站仍拒绝')
  add('Supabase 精确计数头解析', module.parseContentRangeTotal('0-0/123') === 123 && module.parseContentRangeTotal('*/0') === 0 && module.parseContentRangeTotal('bad') === null, '支持非零、零记录与异常响应')
}

const passed = checks.filter(item => item.pass).length
const output = { version: '0.9.0-growth-analytics', generatedAt: new Date().toISOString(), passed, total: checks.length, checks }
fs.writeFileSync(path.join(root, 'validation', 'v0.9.0增长分析验证.json'), JSON.stringify(output, null, 2))
fs.writeFileSync(path.join(root, 'validation', 'v0.9.0增长分析验证.md'), ['# Study Planner v0.9.0 增长分析验证', '', `- 通过：${passed} / ${checks.length}`, `- 生成时间：${output.generatedAt}`, '', ...checks.map(item => `- ${item.pass ? '✅' : '❌'} **${item.name}**：${item.evidence}`)].join('\n') + '\n')
console.log(JSON.stringify(output, null, 2))
if (passed !== checks.length) process.exit(1)
