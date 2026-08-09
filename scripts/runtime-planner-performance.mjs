import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-planner-runtime-performance-'))
const out = path.join(temp, 'out')
let result

try {
  const declarations = path.join(temp, 'date-fns.d.ts')
  fs.writeFileSync(declarations, `declare module 'date-fns' {
    export function parseISO(value: string): Date
    export function isBefore(a: Date, b: Date): boolean
    export function isAfter(a: Date, b: Date): boolean
    export function addDays(date: Date, amount: number): Date
    export function differenceInCalendarDays(a: Date, b: Date): number
    export function eachDayOfInterval(value: {start: Date; end: Date}): Date[]
    export function format(date: Date, pattern: string): string
  }\n`)
  const compile = spawnSync(process.execPath, [tscBin, 'src/lib/planner.ts', declarations, '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', '--outDir', out, '--skipLibCheck', '--strict', '--noEmitOnError'], { cwd: root, encoding: 'utf8' })
  if (compile.status !== 0) throw new Error((compile.stdout + compile.stderr).trim())

  const dateFns = path.join(out, 'node_modules/date-fns')
  fs.mkdirSync(dateFns, { recursive: true })
  fs.writeFileSync(path.join(dateFns, 'package.json'), '{"name":"date-fns","version":"0.0.0","main":"index.js"}')
  fs.writeFileSync(path.join(dateFns, 'index.js'), `
    const parseISO = value => new Date(String(value).slice(0,10) + 'T00:00:00Z')
    const isBefore = (a,b) => a.getTime() < b.getTime()
    const isAfter = (a,b) => a.getTime() > b.getTime()
    const addDays = (date, amount) => new Date(date.getTime() + amount * 86400000)
    const differenceInCalendarDays = (a,b) => Math.round((Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate())-Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate()))/86400000)
    const eachDayOfInterval = ({start,end}) => { const out=[]; for(let d=new Date(start); d<=end; d=addDays(d,1)) out.push(new Date(d)); return out }
    const format = date => String(date.getUTCFullYear())+'-'+String(date.getUTCMonth()+1).padStart(2,'0')+'-'+String(date.getUTCDate()).padStart(2,'0')
    module.exports={parseISO,isBefore,isAfter,addDays,differenceInCalendarDays,eachDayOfInterval,format}
  `)
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"commonjs"}')
  const testFile = path.join(out, 'benchmark.cjs')
  fs.writeFileSync(testFile, `
    const os = require('node:os')
    const { performance } = require('node:perf_hooks')
    const { generateReplanBundle } = require('./lib/planner.js')
    const pad = value => String(value).padStart(2,'0')
    const iso = date => date.getUTCFullYear()+'-'+pad(date.getUTCMonth()+1)+'-'+pad(date.getUTCDate())
    const add = (date, days) => { const value=new Date(date+'T00:00:00Z'); value.setUTCDate(value.getUTCDate()+days); return iso(value) }
    const today = iso(new Date())
    const dates = days => Array.from({length:days},(_,index)=>add(today,index))
    const settings = (end) => ({planName:'性能基准',startDate:today,endDate:end,coreTargetDate:end,chemistryTargetDate:end,bufferDays:0,regularMinutes:720,studyMinutes:720,travelMinutes:0,countWordsTime:false,showWarnings:true,optionalReview:false,sidebarCollapsed:false,planningMode:'balanced',freezeDays:0,regularOverbookMinutes:0,studyOverbookMinutes:0,regularMaxTasks:1000,studyMaxTasks:1000,subjectShareLimit:1,highLoadThreshold:.9,highLoadStreak:5,keepOfflineOnLogout:false,targetUtilization:.95,nearFullThreshold:.98,bufferUtilization:.8,localRepairRadius:5,maxNewTasksPerDay:1000,maxLoadChangeRatio:1,customSubjects:['其他'],theme:'light',notificationsEnabled:false,duration:{enabled:true,windowSize:10,minimumSamples:3,deviationThreshold:.2,outlierRule:'iqr'}})
    const fixture = (count, dayCount, existingCount=0) => {
      const range=dates(dayCount), end=range.at(-1), groupCount=Math.ceil(count/10)
      const groups=Array.from({length:groupCount},(_,index)=>({id:'g-'+index,subject:'其他',title:'任务组 '+index,priority:[5,3,2,1][index%4],quantity:Math.min(10,count-index*10),unitMinutes:30,targetDate:end,dueDate:end,countInStats:true,status:'active',activityType:'normal',prerequisiteGroupIds:[],createdAt:'',updatedAt:''}))
      const assignments=Array.from({length:count},(_,index)=>({id:'a-'+index,groupId:'g-'+Math.floor(index/10),index:index%10+1,title:'任务 '+index,scheduledDate:index<existingCount?range[1+index%(dayCount-1)]:undefined,estimatedMinutes:30,actualMinutes:0,progress:0,status:'todo',locked:false,timeEntries:[],scheduleSource:index<existingCount?'system':'system',intentStrength:'normal',createdAt:'',updatedAt:''}))
      return {schemaVersion:10,version:10,updatedAt:'',settings:settings(end),dayConfigs:Object.fromEntries(range.map(date=>[date,{date,type:'regular',userSet:false}])),taskGroups:groups,assignments,goals:[],calendarConstraints:[],acceptedConstraintExceptions:[],timer:{accumulatedSeconds:0,running:false},reviewRecords:[],changeEvents:[],dailyPlanBaselines:[],intakeBatches:[],guestModified:false,replanHistory:[],planVersions:[],conflictBackups:[],templateKind:'blank'}
    }
    const percentile = (values, ratio) => values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*ratio)-1)]
    const measure = (count, dayCount) => {
      const samples=[], unscheduled=[]; let signature=''
      // Warm the module/JIT once; the gate measures scheduler jitter, not Node's first import.
      generateReplanBundle(fixture(count,dayCount),{mode:'repair',fromDate:today,freezeDays:0},['preserve'])
      for(let run=0;run<5;run++){
        const state=fixture(count,dayCount)
        const memoryBefore=process.memoryUsage().heapUsed
        const started=performance.now()
        const bundle=generateReplanBundle(state,{mode:'repair',fromDate:today,freezeDays:0},['preserve'])
        samples.push(performance.now()-started)
        const scenario=bundle.scenarios[0]
        unscheduled.push(scenario?.summary.unresolved ?? count)
        const currentSignature=scenario?.nextState.assignments.map(item=>item.scheduledDate||'-').join('|') ?? ''
        if(run===0) signature=currentSignature
        else if(signature!==currentSignature) throw new Error(count+' 项调度结果不稳定')
        if(process.memoryUsage().heapUsed-memoryBefore>512*1024*1024) throw new Error(count+' 项调度内存增量异常')
      }
      return {count,days:dayCount,samplesMs:samples.map(value=>Math.round(value*100)/100),p50Ms:Math.round(percentile(samples,.5)*100)/100,p95Ms:Math.round(percentile(samples,.95)*100)/100,maxUnscheduled:Math.max(...unscheduled),stable:true}
    }
    const cases=[measure(100,30),measure(500,90),measure(1000,180)]
    const incremental=fixture(500,90,450)
    const before=new Map(incremental.assignments.slice(0,450).map(item=>[item.id,item.scheduledDate]))
    const started=performance.now()
    const incrementalBundle=generateReplanBundle(incremental,{mode:'repair',fromDate:today,freezeDays:0},['preserve'])
    const incrementalMs=performance.now()-started
    const incrementalAfter=incrementalBundle.scenarios[0]?.nextState
    const movedExisting=incrementalAfter?incrementalAfter.assignments.slice(0,450).filter(item=>before.get(item.id)!==item.scheduledDate).length:450
    const threshold500 = Number(process.env.PLANNER_P95_500_MS || 5000)
    const threshold1000 = Number(process.env.PLANNER_P95_1000_MS || 20000)
    const pass=cases.every(item=>item.maxUnscheduled===0)&&cases.find(item=>item.count===500).p95Ms<=threshold500&&cases.find(item=>item.count===1000).p95Ms<=threshold1000&&movedExisting===0
    console.log(JSON.stringify({pass,thresholds:{p95_500_ms:threshold500,p95_1000_ms:threshold1000},generatedAt:new Date().toISOString(),environment:{platform:process.platform,node:process.version,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryGb:Math.round(os.totalmem()/1024/1024/1024*10)/10},cases,incremental:{totalTasks:500,existingTasks:450,newTasks:50,elapsedMs:Math.round(incrementalMs*100)/100,movedExisting}},null,2))
  `)
  const run = spawnSync(process.execPath, [testFile], { cwd: out, encoding: 'utf8', timeout: 240000 })
  if (run.status !== 0) throw new Error((run.stdout + run.stderr).trim() || `基准进程退出码 ${run.status}`)
  result = JSON.parse(run.stdout)
} catch (error) {
  result = { pass: false, generatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}

fs.mkdirSync(path.join(root, 'validation'), { recursive: true })
fs.writeFileSync(path.join(root, 'validation', '真实调度性能基准.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (!result.pass) process.exit(1)
