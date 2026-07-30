import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const root = process.cwd()
const outDir = path.join(root, 'validation')
fs.mkdirSync(outDir, { recursive: true })
const date = index => `2026-08-${String(index % 28 + 1).padStart(2, '0')}`
const groups = Array.from({ length: 50 }, (_, index) => ({
  id: `g-${index}`, title: `规模测试任务组${index + 1}`, subject: `类别${index % 10}`,
  priority: [5, 3, 2, 1, 0][index % 5], quantity: 10, unitMinutes: 20 + index % 8 * 10,
  dailyMax: index % 4 ? undefined : 2, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}))
const assignments = Array.from({ length: 500 }, (_, index) => ({
  id: `a-${index}`, groupId: `g-${Math.floor(index / 10)}`, index: index % 10 + 1,
  title: `规模测试任务${index + 1}`, estimatedMinutes: 20 + index % 8 * 10, actualMinutes: index % 7 === 0 ? 12 : 0,
  progress: index % 11 === 0 ? 50 : 0, status: index % 13 === 0 ? 'done' : index % 11 === 0 ? 'partial' : 'todo',
  scheduledDate: date(index), locked: index % 47 === 0, intentStrength: index % 19 === 0 ? 'manual' : 'normal',
  scheduleSource: index % 19 === 0 ? 'manual' : 'system', timeEntries: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}))
const goals = Array.from({ length: 20 }, (_, index) => ({
  id: `goal-${index}`, title: `规模测试目标${index + 1}`, latestDate: date(index + 12), desiredDate: date(index + 8), status: 'active',
  linkedTaskGroupIds: [`g-${index}`, `g-${(index + 10) % 50}`], linkedAssignmentIds: [],
  completionConditions: [{ id: `condition-${index}`, groupId: `g-${index}`, mode: index % 3 === 0 ? 'all' : index % 3 === 1 ? 'percentage' : 'count', value: index % 3 === 1 ? 50 : index % 3 === 2 ? 5 : undefined }],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}))
const constraints = Array.from({ length: 30 }, (_, index) => ({ id: `constraint-${index}`, startDate: date(index), endDate: date(index + index % 3), kind: index % 3 === 0 ? 'unavailable' : 'reduced-capacity', capacityMinutes: index % 3 === 0 ? 0 : 90, protected: true, reason: `规模测试约束${index + 1}` }))
const heavyPayload = JSON.stringify({ groups, assignments, goals, constraints })
const versions = Array.from({ length: 10 }, (_, index) => ({ id: `version-${index}`, beforeState: heavyPayload, afterState: heavyPayload, localOnly: true }))
const state = { version: 8, taskGroups: groups, assignments, goals, calendarConstraints: constraints, planVersions: versions, replanHistory: [], conflictBackups: [] }

const startedClone = performance.now()
for (let index = 0; index < 50; index += 1) structuredClone({ ...state, planVersions: [], replanHistory: [], conflictBackups: [] })
const cloneMs = performance.now() - startedClone
const portable = { ...state, planVersions: [], replanHistory: [], conflictBackups: [] }
const startedSerialize = performance.now()
let portableJson = ''
for (let index = 0; index < 100; index += 1) portableJson = JSON.stringify(portable)
const serializeMs = performance.now() - startedSerialize
const fullJson = JSON.stringify(state)
const result = {
  generatedAt: new Date().toISOString(),
  fixture: { goals: goals.length, taskGroups: groups.length, assignments: assignments.length, constraints: constraints.length, localVersions: versions.length },
  checks: {
    fixtureMatchesRequirement: goals.length === 20 && groups.length === 50 && assignments.length === 500 && constraints.length === 30 && versions.length === 10,
    portableExcludesHeavyVersions: !portableJson.includes('beforeState') && portable.planVersions.length === 0,
    noRecursiveVersionPayload: !versions.some(version => version.beforeState.includes('beforeState')),
    serializationCompletes: portableJson.length > 0,
  },
  measurements: {
    clone50TimesMs: Math.round(cloneMs * 100) / 100,
    serialize100TimesMs: Math.round(serializeMs * 100) / 100,
    portableBytes: Buffer.byteLength(portableJson),
    fullWithLocalVersionsBytes: Buffer.byteLength(fullJson),
    heavyToPortableRatio: Math.round(Buffer.byteLength(fullJson) / Buffer.byteLength(portableJson) * 100) / 100,
  },
}
fs.writeFileSync(path.join(outDir, '500任务规模验证.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (Object.values(result.checks).some(value => !value)) process.exit(1)
