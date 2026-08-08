import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const analytics = read('src/lib/analytics.ts')
const api = read('api/visit-log.ts')
const main = read('src/main.tsx')
const readme = read('README.md')
const deployment = read('docs/DEPLOYMENT.md')

const checks = []
const add = (name, pass, evidence) => checks.push({ name, pass: Boolean(pass), evidence })
add('访问事件先进入持久 outbox', /OUTBOX_KEY/.test(analytics) && /localStorage\.setItem\(OUTBOX_KEY/.test(analytics) && /enqueueVisit/.test(analytics), '失败事件不会在一次重试后永久丢失')
add('联网后自动补写', /addEventListener\('online'/.test(analytics) && /visibilitychange/.test(analytics) && /flushVisitLogOutbox/.test(analytics), 'PWA 恢复联网或重新可见时会刷新队列')
add('入口安装补写监听', /installVisitLogRetry\(\)/.test(main), '主入口只安装一次恢复监听')
add('自定义域名同源判断使用请求 URL', /new URL\(request\.url\)/.test(api) && /x-forwarded-host/.test(api) && /headerHosts/.test(api), '不再只依赖可能变化的转发 Host')
add('累计访问 JSON', /storedPageViews/.test(api) && /totalPageViews/.test(api) && /countOffset/.test(api), 'GET 健康检查同时返回累计口径')
add('README SVG 徽章', /searchParams\.get\('format'\)/.test(api) && /format=svg/.test(readme), 'GitHub README 可直接显示同一数据源的总访问数')
add('历史基数有明确部署说明', /VISIT_COUNT_OFFSET/.test(deployment) && /无法还原/.test(deployment), '不伪造丢失日志，只允许补入可信历史基数')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-planner-visit-log-'))
const tscCommand = process.execPath
const tscArgs = [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), 'api/visit-log.ts', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--lib', 'ES2022,DOM', '--strict', '--skipLibCheck', '--outDir', temp]
const compile = spawnSync(tscCommand, tscArgs, { cwd: root, encoding: 'utf8' })
add('服务端访问 API 独立类型检查', compile.status === 0, compile.status === 0 ? 'api/visit-log.ts 编译通过' : `${compile.stdout}\n${compile.stderr}`.trim())

if (compile.status === 0) {
  const module = await import(pathToFileURL(path.join(temp, 'visit-log.js')).href)
  const sameUrl = new Request('https://study-planner.yhwlwl.xyz/api/visit-log', { headers: { origin: 'https://study-planner.yhwlwl.xyz', 'x-forwarded-host': 'deployment.vercel.app' } })
  const sameForwarded = new Request('https://deployment.vercel.app/api/visit-log', { headers: { origin: 'https://study-planner.yhwlwl.xyz', 'x-forwarded-host': 'study-planner.yhwlwl.xyz' } })
  const foreign = new Request('https://study-planner.yhwlwl.xyz/api/visit-log', { headers: { origin: 'https://evil.example' } })
  add('自定义域名请求不会误拒绝', module.sameOrigin(sameUrl) && module.sameOrigin(sameForwarded) && !module.sameOrigin(foreign), '请求 URL Host 或转发 Host 任一匹配即通过，外站仍拒绝')
  add('Supabase 精确计数头解析', module.parseContentRangeTotal('0-0/123') === 123 && module.parseContentRangeTotal('*/0') === 0 && module.parseContentRangeTotal('bad') === null, '支持非零、零记录与异常响应')
}

const passed = checks.filter(item => item.pass).length
const output = { version: '0.8.15', generatedAt: new Date().toISOString(), passed, total: checks.length, checks }
fs.writeFileSync(path.join(root, 'validation', 'v0.8.15访问日志验证.json'), JSON.stringify(output, null, 2))
fs.writeFileSync(path.join(root, 'validation', 'v0.8.15访问日志验证.md'), ['# Study Planner v0.8.15 访问日志验证', '', `- 通过：${passed} / ${checks.length}`, `- 生成时间：${output.generatedAt}`, '', ...checks.map(item => `- ${item.pass ? '✅' : '❌'} **${item.name}**：${item.evidence}`)].join('\n') + '\n')
console.log(JSON.stringify(output, null, 2))
if (passed !== checks.length) process.exit(1)
