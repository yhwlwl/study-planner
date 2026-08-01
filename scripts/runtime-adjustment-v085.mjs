import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'study-planner-adjustment-runtime-'))
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
  const compile = spawnSync('tsc', ['src/lib/planner.ts', declarations, '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', '--outDir', out, '--skipLibCheck', '--strict', '--noEmitOnError'], { cwd: root, encoding: 'utf8' })
  if (compile.status !== 0) throw new Error((compile.stdout + compile.stderr).trim())

  const dateFns = path.join(out, 'node_modules/date-fns')
  fs.mkdirSync(dateFns, { recursive: true })
  fs.writeFileSync(path.join(dateFns, 'package.json'), '{"name":"date-fns","version":"0.0.0","main":"index.js"}')
  fs.writeFileSync(path.join(dateFns, 'index.js'), `
    const parseISO = value => new Date(\`${'${String(value).slice(0,10)}'}T00:00:00Z\`)
    const isBefore = (a,b) => a.getTime() < b.getTime()
    const isAfter = (a,b) => a.getTime() > b.getTime()
    const addDays = (date, amount) => new Date(date.getTime() + amount * 86400000)
    const differenceInCalendarDays = (a,b) => Math.round((Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate())-Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate()))/86400000)
    const eachDayOfInterval = ({start,end}) => { const out=[]; for(let d=new Date(start); d<=end; d=addDays(d,1)) out.push(new Date(d)); return out }
    const format = (date, pattern) => { const y=date.getUTCFullYear(); const m=date.getUTCMonth()+1; const d=date.getUTCDate(); if(pattern==='yyyy-MM-dd') return \`${'${y}'}-${'${String(m).padStart(2,\'0\')}'}-${'${String(d).padStart(2,\'0\')}'}\`; if(pattern==='M月d日') return \`${'${m}'}月${'${d}'}日\`; return \`${'${y}'}-${'${String(m).padStart(2,\'0\')}'}-${'${String(d).padStart(2,\'0\')}'}\` }
    module.exports={parseISO,isBefore,isAfter,addDays,differenceInCalendarDays,eachDayOfInterval,format}
  `)
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"commonjs"}')
  const testFile = path.join(out, 'test.cjs')
  fs.writeFileSync(testFile, `
    const { previewPreparedChange, generateSchedulingProposals } = require('./lib/planner.js')
    const pad=n=>String(n).padStart(2,'0')
    const iso=d=>\`${'${d.getUTCFullYear()}'}-${'${pad(d.getUTCMonth()+1)}'}-${'${pad(d.getUTCDate())}'}\`
    const add=(s,n)=>{const d=new Date(\`${'${s}'}T00:00:00Z\`);d.setUTCDate(d.getUTCDate()+n);return iso(d)}
    const today=iso(new Date()), end=add(today,10), dates=Array.from({length:11},(_,i)=>add(today,i))
    const settings={planName:'test',startDate:today,endDate:end,coreTargetDate:end,chemistryTargetDate:end,bufferDays:0,regularMinutes:90,studyMinutes:180,travelMinutes:0,countWordsTime:false,showWarnings:true,optionalReview:true,sidebarCollapsed:false,planningMode:'balanced',freezeDays:0,regularOverbookMinutes:0,studyOverbookMinutes:0,regularMaxTasks:10,studyMaxTasks:10,subjectShareLimit:1,highLoadThreshold:.85,highLoadStreak:3,keepOfflineOnLogout:false,targetUtilization:.85,nearFullThreshold:.9,bufferUtilization:.3,localRepairRadius:3,maxNewTasksPerDay:3,maxLoadChangeRatio:.3,customSubjects:['化学'],duration:{enabled:true,windowSize:10,minimumSamples:3,deviationThreshold:.2,outlierRule:'iqr'}}
    const group={id:'g',subject:'化学',title:'化学预习',priority:3,quantity:3,unitMinutes:60,targetDate:end,dueDate:end,dailyMax:3,countInStats:true,status:'active',activityType:'normal',createdAt:'',updatedAt:''}
    const task=(id,date,index)=>({id,groupId:'g',index,title:id,scheduledDate:date,estimatedMinutes:60,actualMinutes:0,progress:0,status:'todo',locked:false,timeEntries:[],scheduleSource:'system',intentStrength:'normal',createdAt:'',updatedAt:''})
    const base={schemaVersion:9,version:9,updatedAt:'',settings,dayConfigs:Object.fromEntries(dates.map(date=>[date,{date,type:'regular',userSet:false}])),taskGroups:[group],assignments:[task('conflict',today,1),task('legal',add(today,4),2),task('existing',add(today,1),3)],goals:[],calendarConstraints:[],acceptedConstraintExceptions:[],timer:{accumulatedSeconds:0,running:false},reviewRecords:[],changeEvents:[],guestModified:false,replanHistory:[],planVersions:[],conflictBackups:[],templateKind:'blank'}
    const prepared=structuredClone(base)
    for(const item of prepared.assignments){ if(item.id==='conflict'){item.previousDate=today;item.scheduledDate=add(today,1);item.intentStrength='manual';item.scheduleSource='carryover'} if(item.id==='legal'){item.previousDate=add(today,4);item.scheduledDate=add(today,3);item.intentStrength='manual';item.scheduleSource='carryover'} }
    const event={id:'e',type:'execution-difference',action:'repair',title:'复盘',description:'',affectedGoalIds:[],affectedGroupIds:['g'],affectedAssignmentIds:['conflict','legal'],affectedDates:[today,add(today,1),add(today,3),add(today,4)],createdAt:'',metadata:{requestedCarryDates:{conflict:add(today,1),legal:add(today,3)}}}
    const preview=previewPreparedChange(base,prepared,event,'按选择')
    if(!preview.infeasible || !preview.issues.some(i=>i.assignmentIds.includes('conflict'))) throw new Error('未识别冲突项')
    if(preview.issues.some(i=>i.assignmentIds.includes('legal'))) throw new Error('合法项被错误标记')
    const routed={...event,affectedAssignmentIds:['conflict'],metadata:{...event.metadata,fixedAssignmentIds:['legal'],preferredPreferences:['preserve','balanced']}}
    const proposals=generateSchedulingProposals(prepared,routed,{baseline:base})
    if(!proposals.length) throw new Error('未生成修复方案')
    const legalDate=add(today,3)
    if(proposals.some(p=>p.stateAfter.assignments.find(a=>a.id==='legal')?.scheduledDate!==legalDate)) throw new Error('合法项在修复中被再次移动')
    console.log(JSON.stringify({previewIssues:preview.issues.length,issueTitles:preview.issues.map(i=>i.title),proposals:proposals.length,legalDate}))
  `)
  const run = spawnSync(process.execPath, [testFile], { cwd: out, encoding: 'utf8' })
  if (run.status !== 0) throw new Error((run.stdout + run.stderr).trim())
  result = { generatedAt: new Date().toISOString(), pass: true, ...JSON.parse(run.stdout.trim()) }
} catch (error) {
  result = { generatedAt: new Date().toISOString(), pass: false, error: error instanceof Error ? error.message : String(error) }
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
fs.mkdirSync(path.join(root, 'validation'), { recursive: true })
fs.writeFileSync(path.join(root, 'validation', '复盘精确校验运行验证.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (!result.pass) process.exit(1)
