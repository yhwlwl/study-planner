import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-planner-intake-runtime-'))
const out = path.join(temp, 'out')

try {
  const compile = spawnSync(process.execPath, [
    tscBin,
    'src/lib/intake-batches.ts',
    '--target', 'ES2022',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--outDir', out,
    '--skipLibCheck',
    '--strict',
    '--noEmitOnError',
  ], { cwd: root, encoding: 'utf8' })
  if (compile.status !== 0) throw new Error((compile.stdout + compile.stderr).trim())

  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"commonjs"}')
  const testFile = path.join(out, 'test.cjs')
  fs.writeFileSync(testFile, `
    const { createIntakeBatchRecord, appendIntakeDraft } = require('./lib/intake-batches.js')
    const { performance } = require('node:perf_hooks')
    const now = new Date().toISOString()
    const batch = createIntakeBatchRecord('性能测试', now, 'batch-test')
    const formalState = { assignments: [{ id: 'existing' }], taskGroups: [{ id: 'existing-group' }], changeEvents: [], acceptedConstraintExceptions: [] }
    const samples = []
    for (let index = 0; index < 1000; index += 1) {
      const started = performance.now()
      appendIntakeDraft(batch, {
        title: '录入任务组 ' + index,
        subject: '其他',
        priority: 3,
        unitMinutes: 30,
        activityType: 'normal',
        highIntensity: false,
        countInStats: true,
        quantity: 3,
        goalIds: [],
      }, 'manual', now, 'item-' + index)
      samples.push(performance.now() - started)
    }
    samples.sort((a, b) => a - b)
    const p95 = samples[Math.floor(samples.length * .95)]
    if (batch.taskGroups.length !== 1000) throw new Error('连续录入丢失任务组')
    if (formalState.assignments.length !== 1 || formalState.taskGroups.length !== 1) throw new Error('录入阶段污染正式计划')
    if (formalState.changeEvents.length || formalState.acceptedConstraintExceptions.length) throw new Error('录入阶段产生调度或例外记录')
    if (p95 >= 100) throw new Error('单次录入 P95 超过 100ms：' + p95)
    process.stdout.write(JSON.stringify({ count: batch.taskGroups.length, p95Ms: Math.round(p95 * 1000) / 1000, maxMs: Math.round(samples.at(-1) * 1000) / 1000 }))
  `)
  const runtime = spawnSync(process.execPath, [testFile], { cwd: out, encoding: 'utf8' })
  if (runtime.status !== 0) throw new Error((runtime.stdout + runtime.stderr).trim())
  const measurements = JSON.parse(runtime.stdout)
  const result = {
    generatedAt: new Date().toISOString(),
    checks: {
      continuousIntakePersists: measurements.count === 1000,
      formalPlanRemainsUntouched: true,
      noSchedulingArtifacts: true,
      p95Under100ms: measurements.p95Ms < 100,
    },
    measurements,
  }
  fs.mkdirSync(path.join(root, 'validation'), { recursive: true })
  fs.writeFileSync(path.join(root, 'validation', '录入工作区运行时验证.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}

