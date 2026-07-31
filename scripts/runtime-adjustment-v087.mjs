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
  const compile = spawnSync('tsc', ['src/lib/planner.ts', 'src/lib/conflicts.ts', declarations, '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', '--outDir', out, '--skipLibCheck', '--strict', '--noEmitOnError'], { cwd: root, encoding: 'utf8' })
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
    const { previewPreparedChange, generateSchedulingProposals, analyzePlan } = require('./lib/planner.js')
    const { applyConflictDecisions } = require('./lib/conflicts.js')
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

    const capacityIssue=preview.issues.find(i=>i.rawConstraintKey==='capacity')
    const activityIssue=preview.issues.find(i=>String(i.rawConstraintKey||'').startsWith('activity:'))
    if(!capacityIssue||!activityIssue) throw new Error('精确预览没有保留可逐项处理的原始约束键')
    const applied=applyConflictDecisions(base,prepared,preview,routed,[
      {issueId:capacityIssue.id,action:'accept-once'},
      {issueId:activityIssue.id,action:'system-find-another-date'},
    ])
    if(applied.acceptedExceptions.length!==1||applied.acceptedExceptions[0].rawKey!=='capacity') throw new Error('未按用户选择只接受容量例外')
    const recalculated=generateSchedulingProposals(applied.preparedState,applied.event,{baseline:base,acceptedExceptions:applied.acceptedExceptions,disableAutomaticExceptions:true,preferences:['preserve','balanced']})
    if(!recalculated.length) throw new Error('部分接受例外后未重新生成方案')
    if(recalculated.some(p=>p.exceptions.some(e=>String(e.rawKey||'').startsWith('activity:')))) throw new Error('用户拒绝的同类上限例外被重新加入')
    if(recalculated.some(p=>p.stateAfter.assignments.find(a=>a.id==='legal')?.scheduledDate!==legalDate)) throw new Error('重新计算时合法项未保持固定')
    const executable=recalculated.find(p=>!p.infeasible)
    if(!executable) throw new Error('部分接受容量、拒绝同类上限后没有生成可执行换日方案')

    // 模拟用户选中一个已经包含两项例外的候选：只接受容量例外，拒绝同类上限例外。
    // 重算必须从已选候选继续，保留已接受部分，并只释放被拒绝例外对应的任务。
    const normalGroup={...group,id:'normal',title:'普通任务',activityType:'normal',dailyMax:3}
    const chemGroup={...group,id:'chem',title:'化学预习',activityType:'chem-preview',dailyMax:3,unitMinutes:30}
    const task2=(id,groupId,date,index,minutes)=>({id,groupId,index,title:id,scheduledDate:date,estimatedMinutes:minutes,actualMinutes:0,progress:0,status:'todo',locked:false,timeEntries:[],scheduleSource:'system',intentStrength:'normal',createdAt:'',updatedAt:''})
    const base2={...structuredClone(base),taskGroups:[normalGroup,chemGroup],assignments:[
      task2('existing-cap','normal',add(today,1),1,60),task2('cap-task','normal',add(today,5),2,60),
      task2('existing-chem','chem',add(today,2),1,30),task2('activity-task','chem',add(today,6),2,30),
      task2('legal-2','normal',add(today,3),3,30),
    ]}
    const after2=structuredClone(base2)
    after2.assignments.find(a=>a.id==='cap-task').scheduledDate=add(today,1)
    after2.assignments.find(a=>a.id==='activity-task').scheduledDate=add(today,2)
    const event2={...event,id:'e2',affectedGroupIds:['normal','chem'],affectedAssignmentIds:['cap-task','activity-task'],affectedDates:[add(today,1),add(today,2),add(today,5),add(today,6)],metadata:{preferredPreferences:['preserve','balanced']}}
    const synthetic={...preview,id:'synthetic',eventId:'e2',stateBefore:base2,stateAfter:after2,issues:[],infeasible:false,infeasibleReason:undefined,movements:[
      {assignmentId:'cap-task',fromDate:add(today,5),toDate:add(today,1),reason:'候选',beforeLoad:60,afterLoad:120,goalImpact:'无',manualIntentImpact:'none',rejectedAlternatives:[]},
      {assignmentId:'activity-task',fromDate:add(today,6),toDate:add(today,2),reason:'候选',beforeLoad:30,afterLoad:60,goalImpact:'无',manualIntentImpact:'none',rejectedAlternatives:[]},
    ],exceptions:[
      {date:add(today,1),key:'capacity',rawKey:'capacity',label:'容量 90→120',permanent:false,currentLimit:90,overrideLimit:120,affectedAssignmentIds:['cap-task']},
      {date:add(today,2),key:'activity-daily-max',rawKey:'activity:chem-preview',label:'化学 1→2',permanent:false,currentLimit:1,overrideLimit:2,affectedAssignmentIds:['activity-task']},
    ]}
    const partialSelected=applyConflictDecisions(base2,base2,synthetic,event2,[],[
      {exception:synthetic.exceptions[0],action:'accept-once'},
      {exception:synthetic.exceptions[1],action:'system-find-another-date'},
    ])
    if(partialSelected.preparedState.assignments.find(a=>a.id==='cap-task')?.scheduledDate!==add(today,1)) throw new Error('接受的容量例外候选位置没有保留')
    if(partialSelected.preparedState.assignments.find(a=>a.id==='activity-task')?.scheduledDate) throw new Error('拒绝的例外任务没有释放给系统重新计算')
    if(partialSelected.preparedState.assignments.find(a=>a.id==='legal-2')?.scheduledDate!==add(today,3)) throw new Error('候选中的无关合法任务被改动')
    if(partialSelected.acceptedExceptions.length!==1||partialSelected.acceptedExceptions[0].affectedAssignmentIds?.join(',')!=='cap-task') throw new Error('一次性例外没有保持最小任务授权')
    if(!partialSelected.event.metadata.fixedAssignmentIds.includes('cap-task')) throw new Error('用户接受例外的候选任务没有在重算中固定')
    const recalculatedSelected=generateSchedulingProposals(partialSelected.preparedState,partialSelected.event,{baseline:base2,acceptedExceptions:partialSelected.acceptedExceptions,disableAutomaticExceptions:true,preferences:['preserve','balanced']})
    const executableSelected=recalculatedSelected.find(p=>!p.infeasible)
    if(!executableSelected) throw new Error('从已选候选部分拒绝例外后没有生成可执行结果')
    if(executableSelected.stateAfter.assignments.find(a=>a.id==='cap-task')?.scheduledDate!==add(today,1)) throw new Error('重算没有保留用户已接受的容量例外位置')
    if(executableSelected.exceptions.some(e=>String(e.rawKey||'').startsWith('activity:'))) throw new Error('被拒绝的一次性例外在重算后重新出现')

    // 已完成的真实执行即使超过容量和每日上限，也只是历史事实，不能单独生成待处理硬冲突。
    const mathGroup={...group,id:'math',subject:'数学',title:'数学套卷',activityType:'math-paper',dailyMax:1,unitMinutes:90}
    const done=(id,index,minutes)=>({id,groupId:'math',index,title:id,scheduledDate:today,estimatedMinutes:90,actualMinutes:minutes,progress:100,status:'done',locked:false,completedAt:today+'T12:00:00.000Z',timeEntries:[{id:id+'-time',minutes,createdAt:today+'T12:00:00.000Z',source:'finish'}],scheduleSource:'system',intentStrength:'normal',createdAt:'',updatedAt:''})
    const completedOnly={...structuredClone(base),taskGroups:[mathGroup],assignments:Array.from({length:5},(_,i)=>done('done-'+i,i+1,108)),settings:{...settings,regularMinutes:360}}
    const completedOnlyDangers=analyzePlan(completedOnly,today).filter(i=>i.level==='danger')
    if(completedOnlyDangers.length) throw new Error('已经完成的超容量或超次数历史仍被显示为硬冲突：'+completedOnlyDangers.map(i=>i.message).join('|'))

    // 基线本来已经超载，当前方案移走一项后虽然仍超载，但没有恶化，不能因为提示数字变化而误判为新冲突。
    const legacyOverload={...structuredClone(completedOnly),assignments:[...completedOnly.assignments,task2('remain-a','math',today,6,30),task2('remain-b','math',today,7,30)]}
    const improved=structuredClone(legacyOverload)
    improved.assignments.find(a=>a.id==='remain-a').scheduledDate=add(today,2)
    improved.assignments.find(a=>a.id==='remain-a').previousDate=today
    const improveEvent={...event,id:'history-improve',affectedGroupIds:['math'],affectedAssignmentIds:['remain-a'],affectedDates:[today,add(today,2)],metadata:{requestedCarryDates:{'remain-a':add(today,2)}}}
    const improvedPreview=previewPreparedChange(legacyOverload,improved,improveEvent,'按当前复盘方案')
    if(improvedPreview.infeasible) throw new Error('减少既有超载仍被误判为新增冲突：'+improvedPreview.issues.map(i=>i.detail).join('|'))

    // 向已经由完成记录占满的日期新增未完成任务，仍必须只针对新任务生成冲突。
    const incomingBase={...structuredClone(completedOnly),assignments:[...completedOnly.assignments,task2('incoming','math',add(today,3),6,30)]}
    const incomingPrepared=structuredClone(incomingBase)
    incomingPrepared.assignments.find(a=>a.id==='incoming').previousDate=add(today,3)
    incomingPrepared.assignments.find(a=>a.id==='incoming').scheduledDate=today
    const incomingEvent={...event,id:'history-incoming',affectedGroupIds:['math'],affectedAssignmentIds:['incoming'],affectedDates:[today,add(today,3)],metadata:{requestedCarryDates:{incoming:today}}}
    const incomingPreview=previewPreparedChange(incomingBase,incomingPrepared,incomingEvent,'按当前复盘方案')
    if(!incomingPreview.infeasible) throw new Error('向已完成超载日新增任务没有被拦截')
    if(incomingPreview.issues.some(i=>i.assignmentIds.some(id=>id.startsWith('done-')))) throw new Error('已完成任务被错误列入可处理冲突')
    if(!incomingPreview.issues.some(i=>i.assignmentIds.includes('incoming'))) throw new Error('冲突没有精确指向新增的未完成任务')

    console.log(JSON.stringify({previewIssues:preview.issues.length,issueTitles:preview.issues.map(i=>i.title),proposals:proposals.length,legalDate,partialDecisionProposals:recalculated.length,acceptedExceptionKeys:applied.acceptedExceptions.map(e=>e.rawKey),recalculatedDate:executable.stateAfter.assignments.find(a=>a.id==='conflict')?.scheduledDate,selectedCandidatePartialDecision:true,minimumScopedAssignments:partialSelected.acceptedExceptions[0].affectedAssignmentIds,recalculatedSelectedDate:executableSelected.stateAfter.assignments.find(a=>a.id==='activity-task')?.scheduledDate,completedHistoryExcluded:true,nonWorseningOverloadAllowed:true,incomingTaskStillValidated:true}))
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
fs.writeFileSync(path.join(root, 'validation', '复盘与已完成历史冲突验证.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (!result.pass) process.exit(1)
