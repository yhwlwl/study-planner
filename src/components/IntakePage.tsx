import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, Check, ChevronRight, ClipboardPaste, Copy, Download, FileSpreadsheet, FolderPlus, Inbox, Pencil, Plus,
  Save, Trash2, Upload, X,
} from 'lucide-react'
import type { AppState, IntakeBatch, IntakeTaskGroupDraft, NewTaskDraft, PlanChangeEvent, Priority, TaskGroupDraft } from '../types'
import { useApp } from '../AppContext'
import { dateRange, getCapacity, todayISO } from '../lib/date'
import {
  buildIntakeCsvTemplate, intakeDraftIssues, intakeDraftSignature, intakeImportFields, intakeSummary, parsePastedText,
  readIntakeFile, rebuildImportResult, remapIntakeTable, splitSessionCount, validateImportedDraft,
  type IntakeImportField, type IntakeImportResult, type IntakeImportReviewRow,
} from '../lib/intake'
import { downloadTextFile } from '../lib/exports'
import { Modal } from './Modal'
import { NumericInput } from './NumericInput'
import { SingleTaskDialog } from './SingleTaskDialog'
import type { TaskCreationKind } from './AddTaskDialog'

const priorities: Array<{ value: Priority; label: string }> = [
  { value: 5, label: '核心' }, { value: 3, label: '高' }, { value: 2, label: '中' }, { value: 1, label: '低' }, { value: 0, label: '可选' },
]

function minutesText(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes))
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return hours ? `${hours} 小时${rest ? ` ${rest} 分钟` : ''}` : `${rest} 分钟`
}

function emptyDraft(state: AppState): TaskGroupDraft {
  return {
    title: '', subject: state.settings.customSubjects[0] ?? '其他', priority: 3, unitMinutes: 30,
    activityType: 'normal', highIntensity: false, countInStats: true, quantity: 1, goalIds: [],
    recurring: false, allowSplit: false, prerequisiteGroupIds: [],
  }
}

export function IntakePage({ onPrepared, onNavigate, onAddTask, addRequest, onAddRequestHandled }: {
  onPrepared: (state: AppState, event: PlanChangeEvent) => void
  onNavigate: (page: 'today' | 'tasks' | 'intake' | 'goals' | 'settings') => void
  onAddTask: (batchId?: string) => void
  addRequest?: { id: string; kind: TaskCreationKind; batchId?: string }
  onAddRequestHandled: () => void
}) {
  const {
    state, canUndo, undo, updateSettings, createIntakeBatch, duplicateIntakeBatch, updateIntakeBatch, addIntakeSingleTask, addIntakeTaskGroup, updateIntakeSingleTask, updateIntakeTaskGroup,
    removeIntakeTaskGroup, deleteIntakeBatch, prepareIntakeBatch, resetAll,
  } = useApp()
  const activeBatches = useMemo(() => state.intakeBatches.filter(batch => batch.status !== 'archived'), [state.intakeBatches])
  const [showArchived, setShowArchived] = useState(false)
  const visibleBatches = showArchived ? state.intakeBatches : activeBatches
  const [activeId, setActiveId] = useState<string>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<IntakeTaskGroupDraft>()
  const [singleDialogOpen, setSingleDialogOpen] = useState(false)
  const [editingSingle, setEditingSingle] = useState<IntakeTaskGroupDraft>()
  const [dialogBatchId, setDialogBatchId] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [importResult, setImportResult] = useState<IntakeImportResult>()
  const [importSource, setImportSource] = useState<'paste' | 'csv' | 'xlsx'>('paste')
  const [importBusy, setImportBusy] = useState(false)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [deletedBatchName, setDeletedBatchName] = useState<string>()
  const fileRef = useRef<HTMLInputElement>(null)
  const handledAddRequestId = useRef<string>()

  useEffect(() => {
    if (activeId && activeBatches.some(batch => batch.id === activeId)) return
    const resumable = [...activeBatches].reverse().find(batch => batch.status === 'editing' || batch.status === 'pending' || batch.status === 'calculating')
    setActiveId(resumable?.id ?? activeBatches.at(-1)?.id)
  }, [activeBatches, activeId])

  const active = activeBatches.find(batch => batch.id === activeId)
  const pendingItems = active?.taskGroups.filter(item => !item.appliedAt) ?? []
  const summary = intakeSummary(active?.taskGroups ?? [])
  const capacity = dateRange(state.settings.startDate, state.settings.endDate)
    .reduce((sum, date) => sum + getCapacity(state, date) * state.settings.targetUtilization, 0)
  const existingPendingMinutes = state.assignments.filter(item => item.status !== 'done')
    .reduce((sum, item) => sum + Math.max(0, item.remainingMinutes ?? item.estimatedMinutes), 0)
  const capacityGap = capacity - existingPendingMinutes - summary.minutes
  const issueCount = pendingItems.reduce((sum, item) => sum + intakeDraftIssues(item, state).length, 0)
  const duplicateSignatures = useMemo(() => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const item of pendingItems) {
      const signature = intakeDraftSignature(item)
      if (seen.has(signature)) duplicates.add(signature)
      seen.add(signature)
    }
    return duplicates
  }, [pendingItems])
  const duplicateCount = pendingItems.filter(item => duplicateSignatures.has(intakeDraftSignature(item))).length
  const deadlineCount = pendingItems.filter(item => item.desiredDate || item.latestDate || item.recurring).length
  const linkedGoalCount = pendingItems.filter(item => item.goalIds.length || item.goalTitle || item.desiredDate || item.latestDate).length
  const availabilityConfirmed = state.settings.setupProgress?.availabilityConfirmed ?? Boolean(state.assignments.length)
  const setupStep = state.settings.setupProgress?.currentStep ?? 1
  const setSetupStep = (currentStep: 1 | 2 | 3 | 4) => updateSettings({ setupProgress: { ...(state.settings.setupProgress ?? {}), currentStep } })

  useEffect(() => {
    if (!active?.lastEditedItemId) return
    const frame = window.requestAnimationFrame(() => document.getElementById(`intake-item-${active.lastEditedItemId}`)?.scrollIntoView({ block: 'nearest' }))
    return () => window.cancelAnimationFrame(frame)
  }, [active?.id])

  const createBatch = () => {
    const id = createIntakeBatch()
    setActiveId(id)
    setSelectedIds([])
    return id
  }

  useEffect(() => {
    if (!addRequest || handledAddRequestId.current === addRequest.id) return
    handledAddRequestId.current = addRequest.id
    const requestedBatch = addRequest.batchId && state.intakeBatches.some(batch => batch.id === addRequest.batchId && batch.status !== 'archived')
      ? addRequest.batchId
      : undefined
    const batchId = requestedBatch ?? createIntakeBatch()
    setActiveId(batchId)
    setSelectedIds([])
    setDialogBatchId(batchId)
    if (addRequest.kind === 'single') {
      setEditingSingle(undefined)
      setSingleDialogOpen(true)
    } else {
      setEditingItem(undefined)
      setDialogOpen(true)
    }
    onAddRequestHandled()
  }, [addRequest, createIntakeBatch, onAddRequestHandled, state.intakeBatches])

  const startWithImport = () => {
    createBatch()
    setImportSource('paste')
    setImportResult(undefined)
    setPasteOpen(true)
  }

  const startAddTask = () => {
    const id = createBatch()
    onAddTask(id)
  }

  const persistTaskGroupDraft = useCallback((draft: Partial<TaskGroupDraft>) => {
    const targetBatchId = dialogBatchId ?? active?.id
    if (targetBatchId) updateIntakeBatch(targetBatchId, { formDraft: draft })
  }, [active?.id, dialogBatchId, updateIntakeBatch])

  const schedule = () => {
    if (!active) return
    const ids = selectedIds.length ? selectedIds : pendingItems.map(item => item.id)
    const invalid = pendingItems.filter(item => ids.includes(item.id) && intakeDraftIssues(item, state).length)
    if (invalid.length) {
      window.alert(`有 ${invalid.length} 项录入内容需要先修正。`)
      return
    }
    const prepared = prepareIntakeBatch(active.id, ids)
    prepared.state.settings.setupProgress = { ...(prepared.state.settings.setupProgress ?? {}), currentStep: 4 }
    onPrepared(prepared.state, prepared.event)
  }

  const importDrafts = (result: IntakeImportResult, source: 'paste' | 'csv' | 'xlsx') => {
    if (!active) return
    const existing = new Set(pendingItems.map(intakeDraftSignature))
    let added = 0
    for (const draft of result.drafts) {
      const signature = intakeDraftSignature(draft)
      if (skipDuplicates && existing.has(signature)) continue
      addIntakeTaskGroup(active.id, draft, source)
      existing.add(signature)
      added += 1
    }
    setImportResult(undefined)
    setPasteText('')
    setPasteOpen(false)
    if (!added) window.alert('没有新增内容。请检查重复项或导入错误。')
  }

  const handleFile = async (file: File) => {
    setImportBusy(true)
    try {
      const result = await readIntakeFile(file)
      setImportSource(file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv')
      setImportResult(result)
      setPasteOpen(true)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '无法读取这个文件。')
    } finally {
      setImportBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return <div className="intake-page">
    <section className="intake-intro">
      <div>
        <span className="intake-kicker"><Inbox size={16}/>录入</span>
        <h2>{state.assignments.length ? '先把新增任务收齐，再决定如何调整计划' : '先录入任务，完成后统一生成第一份计划'}</h2>
        <p>{state.assignments.length
          ? '录入中的内容不会改变今天和未来的正式安排。你可以分几次完成，再统一安排全部或所选任务。'
          : '这里会自动保存录入进度。中途退出没有关系，下次可以从原位置继续。'}</p>
      </div>
      <button className="primary-button" onClick={createBatch}><FolderPlus size={17}/>新建录入批次</button>
    </section>
    {!state.assignments.length && <nav className="intake-setup-steps" aria-label="首次建档进度">
      <button className={`${pendingItems.length ? 'complete ' : ''}${setupStep === 1 ? 'active' : ''}`} onClick={() => setSetupStep(1)}><span>1</span><strong>任务清单</strong><small>{pendingItems.length ? `${pendingItems.length} 项已录入` : '正在进行'}</small></button>
      <button className={`${state.goals.length ? 'complete ' : ''}${setupStep === 2 ? 'active' : ''}`} onClick={() => { setSetupStep(2); onNavigate('goals') }}><span>2</span><strong>目标期限</strong><small>{state.goals.length ? `${state.goals.length} 个目标` : '可稍后补充'}</small></button>
      <button className={`${availabilityConfirmed ? 'complete ' : ''}${setupStep === 3 ? 'active' : ''}`} onClick={() => { setSetupStep(3); onNavigate('settings') }}><span>3</span><strong>可用时间</strong><small>{availabilityConfirmed ? `已确认 · 约 ${minutesText(Math.round(capacity))}` : '请确认每天能学习多久'}</small></button>
      <button className={setupStep === 4 ? 'active' : ''} disabled={!pendingItems.length || Boolean(issueCount) || !availabilityConfirmed} onClick={schedule}><span>4</span><strong>首次排期</strong><small>{issueCount ? `先修正 ${issueCount} 项` : !availabilityConfirmed ? '先确认可用时间' : pendingItems.length ? '已可生成预览' : '等待任务'}</small></button>
    </nav>}

    <div className="intake-layout">
      <aside className="intake-batch-list" aria-label="录入批次">
        <div className="intake-batch-list-head"><strong>录入批次</strong><button className="text-button" onClick={() => setShowArchived(value => !value)}>{showArchived ? '隐藏归档' : `归档 ${state.intakeBatches.length - activeBatches.length}`}</button></div>
        {visibleBatches.length ? visibleBatches.map(batch => {
          const batchSummary = intakeSummary(batch.taskGroups)
          const pending = batch.taskGroups.filter(item => !item.appliedAt).length
          const archived = batch.status === 'archived'
          return <button key={batch.id} className={`intake-batch-button ${batch.id === active?.id ? 'active' : ''} ${archived ? 'archived' : ''}`} onClick={() => { if (archived) updateIntakeBatch(batch.id, { status: 'editing' }); setActiveId(batch.id); setSelectedIds([]) }}>
            <span><strong>{batch.name}</strong><small>{archived ? '已归档，点击恢复' : batch.status === 'calculating' ? '正在生成排期预览' : pending ? `${pending} 项待安排内容` : batch.taskGroups.length ? '已全部安排' : '尚未录入'}</small></span>
            <span className="intake-batch-count">{batchSummary.assignmentCount}</span>
            <ChevronRight size={16}/>
          </button>
        }) : <div className="intake-empty-side"><Inbox size={24}/><p>还没有录入批次</p></div>}
      </aside>

      <section className="intake-workspace">
        {!active ? <div className="intake-empty-main">
          <Inbox size={34}/><h3>{state.assignments.length ? '新增内容先保存到录入' : '选择最省力的建档方式'}</h3><p>录入期间只保存和校验，不会重新计算正式计划。随时退出都能继续。</p>
          <div className="intake-empty-options">
            <button className="primary-button" onClick={startWithImport}><Upload size={17}/><span><strong>导入任务清单</strong><small>粘贴文本、CSV 或 XLSX</small></span></button>
            <button className="secondary-button" onClick={startAddTask}><Plus size={17}/><span><strong>添加任务</strong><small>独立任务或任务组</small></span></button>
            {!state.assignments.length && <button className="secondary-button" onClick={() => { if (window.confirm('载入示例计划会替换当前空白空间，录入内容将不保留。继续吗？')) void resetAll('demo').then(() => onNavigate('today')) }}><FileSpreadsheet size={17}/><span><strong>暂时体验示例计划</strong><small>先看看完整使用效果</small></span></button>}
          </div>
        </div> : <>
          <header className="intake-workspace-head">
            <div className="intake-name-field">
              <label htmlFor="intake-batch-name">批次名称</label>
              <input id="intake-batch-name" value={active.name} onChange={event => updateIntakeBatch(active.id, { name: event.target.value })}/>
              <small>最近保存于 {new Date(active.updatedAt).toLocaleString('zh-CN')}</small>
            </div>
            <div className="intake-head-actions">
              <button className="secondary-button" onClick={() => { updateIntakeBatch(active.id, { status: 'pending' }); onNavigate(state.assignments.length ? 'today' : 'intake') }}><Save size={16}/>保存并退出</button>
              <button className="icon-button" aria-label={`复制录入批次 ${active.name}`} onClick={() => setActiveId(duplicateIntakeBatch(active.id))}><Copy size={17}/></button>
              <button className="icon-button danger-icon" aria-label={`删除录入批次 ${active.name}`} onClick={() => { if (!window.confirm('删除这个录入批次？已进入正式计划的任务不会被删除。删除后可立即撤销。')) return; setDeletedBatchName(active.name); deleteIntakeBatch(active.id) }}><Trash2 size={17}/></button>
            </div>
          </header>

          <div className="intake-summary" aria-label="录入汇总">
            <div><span>待安排内容</span><strong>{summary.groupCount}</strong></div>
            <div><span>预计生成任务</span><strong>{summary.assignmentCount}</strong></div>
            <div><span>新增工作量</span><strong>{minutesText(summary.minutes)}</strong></div>
            <div className={capacityGap < 0 ? 'danger' : ''}><span>计划容量余量</span><strong>{capacityGap < 0 ? `缺 ${minutesText(-capacityGap)}` : `余 ${minutesText(capacityGap)}`}</strong></div>
          </div>
          <p className="intake-summary-note">容量余量是录入阶段的粗略估算，不代表所有任务都能满足每日上限和目标期限。正式结果以排期预览为准。</p>
          <div className="intake-health" role="status"><span>已设期限 <strong>{deadlineCount}/{pendingItems.length}</strong></span><span>已关联目标 <strong>{linkedGoalCount}/{pendingItems.length}</strong></span><span className={duplicateCount ? 'warning-text' : ''}>重复疑似 <strong>{duplicateCount}</strong></span><span className={issueCount ? 'danger-text' : ''}>字段问题 <strong>{issueCount}</strong></span></div>

          <div className="intake-toolbar">
            <div>
              <button className="primary-button" onClick={() => onAddTask(active.id)}><Plus size={16}/>添加任务</button>
              <button className="secondary-button" onClick={() => { setImportSource('paste'); setImportResult(undefined); setPasteOpen(true) }}><ClipboardPaste size={16}/>自然语言 / 粘贴清单</button>
              <button className="secondary-button" disabled={importBusy} onClick={() => fileRef.current?.click()}><Upload size={16}/>{importBusy ? '读取中' : '导入文件'}</button>
              <button className="text-button" onClick={() => downloadTextFile('study-planner-import-template.csv', buildIntakeCsvTemplate(), 'text/csv')}><Download size={15}/>下载完整模板</button>
              <input ref={fileRef} hidden type="file" accept=".txt,.csv,.tsv,.xlsx,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => event.target.files?.[0] && void handleFile(event.target.files[0])}/>
            </div>
            <div className="intake-readiness">
              {issueCount ? <span className="danger-text">{issueCount} 个字段问题</span> : <span className="success-text"><Check size={15}/>可以生成预览</span>}
              <button className="primary-button" disabled={!pendingItems.length || Boolean(issueCount)} onClick={schedule}>
                {selectedIds.length ? `安排所选 ${selectedIds.length} 项` : state.assignments.length ? '安排本批任务' : '生成第一份计划'}
              </button>
            </div>
          </div>

          {pendingItems.length ? <div className="intake-table-wrap">
            <table className="intake-table">
              <thead><tr><th><input aria-label="选择全部待安排内容" type="checkbox" checked={selectedIds.length === pendingItems.length && pendingItems.length > 0} onChange={event => setSelectedIds(event.target.checked ? pendingItems.map(item => item.id) : [])}/></th><th>录入内容</th><th>数量</th><th>单项预计</th><th>规则</th><th>状态</th><th><span className="sr-only">操作</span></th></tr></thead>
              <tbody>{pendingItems.map(item => {
                const issues = intakeDraftIssues(item, state)
                const duplicate = duplicateSignatures.has(intakeDraftSignature(item))
                return <tr key={item.id} id={`intake-item-${item.id}`} className={issues.length ? 'has-error' : ''}>
                  <td><input aria-label={`选择 ${item.title}`} type="checkbox" checked={selectedIds.includes(item.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))}/></td>
                  <td><strong>{item.title || (item.kind === 'single' ? '未命名独立任务' : '未命名任务组')}</strong><small><span className="intake-kind-label">{item.kind === 'single' ? '独立任务' : '任务组'}</span>{item.subject}，{priorities.find(option => option.value === item.priority)?.label ?? item.priority}优先级{item.latestDate ? `，最晚 ${item.latestDate}` : item.desiredDate ? `，期望 ${item.desiredDate}` : ''}</small></td>
                  <td>{item.kind === 'single' ? '1' : item.recurring ? '按重复日期' : item.quantity}</td>
                  <td>{item.unitMinutes} 分钟</td>
                  <td>{item.kind === 'single' ? '独立任务' : item.recurring ? '重复任务' : item.allowSplit ? `可拆分标记 · 建议 ${item.splitSessionMinutes ?? 30} 分钟` : item.dailyMax ? `每天最多 ${item.dailyMax} 项` : '普通任务组'}</td>
                  <td>{issues.length ? <span className="danger-text">{issues.join('；')}</span> : duplicate ? <span className="warning-text">疑似重复</span> : <span className="success-text">已保存</span>}</td>
                  <td><div className="row-actions"><button className="icon-button" aria-label={`编辑 ${item.title}`} onClick={() => { setDialogBatchId(active.id); if (item.kind === 'single') { setEditingSingle(item); setSingleDialogOpen(true) } else { setEditingItem(item); setDialogOpen(true) } }}><Pencil size={16}/></button><button className="icon-button danger-icon" aria-label={`删除 ${item.title}`} onClick={() => removeIntakeTaskGroup(active.id, item.id)}><X size={16}/></button></div></td>
                </tr>
              })}</tbody>
            </table>
          </div> : <div className="intake-list-empty"><FileSpreadsheet size={28}/><h3>这个批次还是空的</h3><p>逐项新增，或一次导入现有任务清单。</p></div>}

          {active.taskGroups.some(item => item.appliedAt) && <details className="intake-applied"><summary>已从本批次加入计划的内容（{active.taskGroups.filter(item => item.appliedAt).length}）</summary><ul>{active.taskGroups.filter(item => item.appliedAt).map(item => <li key={item.id}>{item.title}</li>)}</ul></details>}

          <div className="intake-next-step">
            <div><strong>{state.assignments.length ? '当前正式计划不会被录入内容改动' : '还可以先完善目标和可用时间'}</strong><p>{state.assignments.length ? '需要时再安排本批任务，系统会先展示它对原计划的影响。' : '目标和容量设置完成后，第一次排期会更接近真实情况。'}</p></div>
            <div>{!state.assignments.length && <><button className="secondary-button" onClick={() => onNavigate('goals')}>设置目标</button><button className="secondary-button" onClick={() => onNavigate('settings')}>设置可用时间</button></>}<button className="text-button" onClick={() => updateIntakeBatch(active.id, { status: 'archived' })}><Archive size={15}/>归档批次</button></div>
          </div>
        </>}
      </section>
    </div>
    {deletedBatchName && <div className="intake-undo-toast" role="status"><span>已删除“{deletedBatchName}”</span><button className="secondary-button" disabled={!canUndo} onClick={() => { undo(); setDeletedBatchName(undefined) }}>撤销删除</button><button className="text-button" onClick={() => setDeletedBatchName(undefined)}>关闭</button></div>}

    <IntakeTaskDialog
      key={`${active?.id ?? 'none'}-${editingItem?.id ?? 'new'}`}
      open={dialogOpen}
      state={state}
      initial={editingItem ?? active?.formDraft as TaskGroupDraft | undefined}
      onDraftChange={persistTaskGroupDraft}
      onClose={() => { setDialogOpen(false); setEditingItem(undefined); setDialogBatchId(undefined) }}
      onSave={(draft, keepOpen) => {
        const targetBatchId = dialogBatchId ?? active?.id
        if (!targetBatchId) return
        if (editingItem) updateIntakeTaskGroup(targetBatchId, editingItem.id, draft)
        else addIntakeTaskGroup(targetBatchId, draft)
        updateIntakeBatch(targetBatchId, { formDraft: undefined })
        if (!keepOpen || editingItem) { setDialogOpen(false); setEditingItem(undefined); setDialogBatchId(undefined) }
      }}
    />

    <SingleTaskDialog
      key={`${dialogBatchId ?? active?.id ?? 'none'}-${editingSingle?.id ?? 'new-single'}`}
      open={singleDialogOpen}
      state={state}
      creationMode="intake"
      initial={editingSingle ? {
        title: editingSingle.title,
        standalone: true,
        subject: editingSingle.subject,
        priority: editingSingle.priority,
        estimatedMinutes: editingSingle.unitMinutes,
        schedulingIntent: 'system',
        locked: false,
        notes: editingSingle.notes,
      } : undefined}
      onClose={() => { setSingleDialogOpen(false); setEditingSingle(undefined); setDialogBatchId(undefined) }}
      onSubmit={(draft: NewTaskDraft) => {
        const targetBatchId = dialogBatchId ?? active?.id
        if (!targetBatchId) return
        if (editingSingle) updateIntakeSingleTask(targetBatchId, editingSingle.id, draft)
        else addIntakeSingleTask(targetBatchId, draft)
        setSingleDialogOpen(false)
        setEditingSingle(undefined)
        setDialogBatchId(undefined)
      }}
    />

    <Modal open={pasteOpen} title={importResult ? '确认导入结果' : '自然语言录入 / 粘贴清单'} onClose={() => { setPasteOpen(false); setImportResult(undefined) }} wide mobileFullscreen>
      {!importResult ? <div className="intake-paste-form">
        <label className="field"><span>每行一个任务，或直接粘贴表格</span><textarea autoFocus rows={12} value={pasteText} onChange={event => setPasteText(event.target.value)} placeholder={'数学卷 8 套，每套 90 分钟\n物理错题整理 12 次，每次 30 分钟\n\n也可以粘贴列：任务组、科目、数量、预计时长、优先级'}/><small>系统只解析并生成预览，不会直接修改正式计划。</small></label>
      </div> : <ImportPreview result={importResult} onChange={setImportResult}/>} 
      <div className="modal-actions intake-import-actions">
        <label className="checkbox-field"><input type="checkbox" checked={skipDuplicates} onChange={event => setSkipDuplicates(event.target.checked)}/><span>跳过与当前批次相同的任务组</span></label>
        <button className="secondary-button" onClick={() => { setPasteOpen(false); setImportResult(undefined) }}>取消</button>
        {importResult && importSource === 'paste' && <button className="secondary-button" onClick={() => setImportResult(undefined)}>返回修改原文</button>}
        {!importResult ? <button className="primary-button" disabled={!pasteText.trim()} onClick={() => setImportResult(parsePastedText(pasteText))}>解析并预览</button>
          : <button className="primary-button" disabled={!importResult.drafts.length || !active} onClick={() => importDrafts(importResult, importSource)}>加入当前批次</button>}
      </div>
    </Modal>
  </div>
}

function ImportPreview({ result, onChange }: { result: IntakeImportResult; onChange: (result: IntakeImportResult) => void }) {
  const [bulkSubject, setBulkSubject] = useState('')
  const [bulkMinutes, setBulkMinutes] = useState<number>()
  const [bulkLatestDate, setBulkLatestDate] = useState('')
  const [bulkGoalTitle, setBulkGoalTitle] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 100
  const reviewRows = result.reviewRows ?? result.drafts.map((draft, index) => ({ sourceRow: index + 1, draft, issues: validateImportedDraft(draft, index + 1) }))
  const generatedTaskCount = result.drafts.reduce((sum, draft) => sum + (draft.recurring ? 0 : splitSessionCount(draft)), 0)
  const generatedMinutes = result.drafts.reduce((sum, draft) => sum + (draft.recurring ? draft.unitMinutes : draft.quantity * draft.unitMinutes), 0)
  const updateRows = (rows: IntakeImportReviewRow[]) => { setPage(0); onChange(rebuildImportResult(result, rows)) }
  const updateDraft = (index: number, patch: Partial<TaskGroupDraft>) => updateRows(reviewRows.map((row, rowIndex) => {
    if (rowIndex !== index) return row
    const draft = { ...row.draft, ...patch }
    return { ...row, draft, issues: validateImportedDraft(draft, row.sourceRow) }
  }))
  const applyBulk = () => updateRows(reviewRows.map(row => {
    const draft = {
      ...row.draft,
      subject: bulkSubject.trim() || row.draft.subject,
      unitMinutes: bulkMinutes && bulkMinutes > 0 ? bulkMinutes : row.draft.unitMinutes,
      latestDate: bulkLatestDate || row.draft.latestDate,
      goalTitle: bulkGoalTitle.trim() || row.draft.goalTitle,
    }
    return { ...row, draft, issues: validateImportedDraft(draft, row.sourceRow) }
  }))
  const mergeSimilar = () => {
    const merged = new Map<string, TaskGroupDraft>()
    reviewRows.forEach((row, index) => {
      const draft = row.draft
      const key = draft.recurring
        ? `recurring-${index}`
        : [draft.title.trim().toLowerCase(), draft.subject.trim().toLowerCase(), draft.unitMinutes, draft.priority, draft.latestDate ?? '', draft.desiredDate ?? ''].join('|')
      const existing = merged.get(key)
      if (existing) existing.quantity += draft.quantity
      else merged.set(key, structuredClone(draft))
    })
    const rows = Array.from(merged.values()).map((draft, index) => ({ sourceRow: index + 1, draft, issues: validateImportedDraft(draft, index + 1) }))
    updateRows(rows)
  }
  return <div className="intake-import-preview">
    <div className="intake-import-summary"><strong>共 {reviewRows.length} 行 · {result.drafts.length} 行可加入 · 预计 {generatedTaskCount || '按重复日期'} 项 · {minutesText(generatedMinutes)}</strong><span>{result.issues.length ? `${result.issues.length} 个问题，请在红色行内修正` : '字段检查通过'}</span></div>
    {result.table && <details className="intake-mapping" open={result.table.mapping.every(item => item === 'ignore')}><summary>检查表头映射</summary><p>如果自动识别不正确，请为每一列选择真实含义。修改后会立即重新解析全部行。</p><div className="intake-mapping-grid">{result.table.headers.map((header, index) => <label key={`${header}-${index}`}><span>{header}</span><select value={result.table?.mapping[index] ?? 'ignore'} onChange={event => result.table && onChange(remapIntakeTable(result.table, result.table.mapping.map((field, fieldIndex) => fieldIndex === index ? event.target.value as IntakeImportField | 'ignore' : field)))}>{intakeImportFields.map(field => <option key={field.value} value={field.value}>{field.label}</option>)}</select></label>)}</div></details>}
    <div className="intake-import-bulk"><label><span>统一科目</span><input value={bulkSubject} onChange={event => setBulkSubject(event.target.value)} placeholder="留空不修改"/></label><label><span>统一分钟</span><NumericInput min={1} max={1440} value={bulkMinutes} onValueChange={setBulkMinutes} onEmpty={() => setBulkMinutes(undefined)}/></label><label><span>统一最晚日期</span><input type="date" value={bulkLatestDate} onChange={event => setBulkLatestDate(event.target.value)}/></label><label><span>统一目标名称</span><input value={bulkGoalTitle} onChange={event => setBulkGoalTitle(event.target.value)} placeholder="留空不修改"/></label><button className="secondary-button" onClick={applyBulk}>应用到全部行</button><button className="text-button" onClick={mergeSimilar}>合并同名同规则行</button></div>
    <p className="intake-preview-tip">错误行不会丢失。可以直接修改红色单元格，或留空清除可选字段；确认后仍只进入录入批次。</p>
    <div className="intake-preview-table-wrap"><table className="intake-table"><thead><tr><th>源行</th><th>任务组</th><th>科目</th><th>数量</th><th>单项预计</th><th>目标期限</th><th>排期日期</th><th>状态</th><th><span className="sr-only">移除</span></th></tr></thead><tbody>{reviewRows.slice(page * pageSize, (page + 1) * pageSize).map((row, offset) => { const index = page * pageSize + offset; const draft = row.draft; return <tr className={row.issues.length ? 'has-error' : ''} key={`${row.sourceRow}-${index}`}><td>{row.sourceRow}</td><td><input aria-label={`第 ${row.sourceRow} 行任务组`} value={draft.title} onChange={event => updateDraft(index, { title: event.target.value })}/></td><td><input aria-label={`第 ${row.sourceRow} 行科目`} value={draft.subject} onChange={event => updateDraft(index, { subject: event.target.value })}/></td><td>{draft.recurring ? '重复' : <NumericInput aria-label={`第 ${row.sourceRow} 行数量`} min={1} max={10000} value={draft.quantity} onValueChange={quantity => updateDraft(index, { quantity })}/>}</td><td><NumericInput aria-label={`第 ${row.sourceRow} 行预计分钟`} min={1} max={1440} value={draft.unitMinutes} onValueChange={unitMinutes => updateDraft(index, { unitMinutes })}/></td><td><input aria-label={`第 ${row.sourceRow} 行最晚完成日`} type="date" value={draft.latestDate ?? ''} onChange={event => updateDraft(index, { latestDate: event.target.value || undefined })}/></td><td><select aria-label={`第 ${row.sourceRow} 行排期日期类型`} value={draft.fixedDate ? 'fixed' : draft.preferredDate ? 'preferred' : 'system'} onChange={event => updateDraft(index, event.target.value === 'fixed' ? { fixedDate: draft.fixedDate ?? todayISO(), preferredDate: undefined } : event.target.value === 'preferred' ? { preferredDate: draft.preferredDate ?? todayISO(), fixedDate: undefined } : { preferredDate: undefined, fixedDate: undefined })}><option value="system">系统安排</option><option value="preferred">偏好日期</option><option value="fixed">固定日期</option></select>{(draft.preferredDate || draft.fixedDate) && <input aria-label={`第 ${row.sourceRow} 行排期日期`} type="date" value={draft.fixedDate ?? draft.preferredDate ?? ''} onChange={event => updateDraft(index, draft.fixedDate ? { fixedDate: event.target.value || undefined } : { preferredDate: event.target.value || undefined })}/>}</td><td>{row.issues.length ? <span className="danger-text">{row.issues.map(issue => `${issue.field ? `${issue.field}：` : ''}${issue.message}`).join('；')}</span> : <span className="success-text">可加入{draft.allowSplit ? `，将生成 ${splitSessionCount(draft)} 段` : ''}</span>}</td><td><button className="icon-button danger-icon" aria-label={`移除源文件第 ${row.sourceRow} 行`} onClick={() => updateRows(reviewRows.filter((_, rowIndex) => rowIndex !== index))}><X size={15}/></button></td></tr>})}</tbody></table></div>
    {reviewRows.length > pageSize && <div className="intake-import-pagination"><span>显示第 {page * pageSize + 1}–{Math.min((page + 1) * pageSize, reviewRows.length)} 行，共 {reviewRows.length} 行</span><div className="button-wrap"><button className="secondary-button" disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}>上一页</button><button className="secondary-button" disabled={(page + 1) * pageSize >= reviewRows.length} onClick={() => setPage(value => value + 1)}>下一页</button></div></div>}
  </div>
}

function IntakeTaskDialog({ open, state, initial, onDraftChange, onClose, onSave }: {
  open: boolean
  state: AppState
  initial?: IntakeTaskGroupDraft | Partial<TaskGroupDraft>
  onDraftChange?: (draft: Partial<TaskGroupDraft>) => void
  onClose: () => void
  onSave: (draft: TaskGroupDraft, keepOpen: boolean) => void
}) {
  const existingItem = Boolean(initial && 'id' in initial)
  const [form, setForm] = useState<TaskGroupDraft>(() => ({ ...emptyDraft(state), ...(initial ? structuredClone(initial) : {}) }))
  const patch = <K extends keyof TaskGroupDraft>(key: K, value: TaskGroupDraft[K]) => setForm(current => ({ ...current, [key]: value }))
  useEffect(() => {
    if (!open || existingItem || !onDraftChange) return
    const timer = window.setTimeout(() => onDraftChange(form), 300)
    return () => window.clearTimeout(timer)
  }, [existingItem, form, onDraftChange, open])
  useEffect(() => {
    if (!open) return
    setForm({ ...emptyDraft(state), ...(initial ? structuredClone(initial) : {}) })
  }, [open])
  const valid = Boolean(form.title.trim()) && form.quantity > 0 && form.unitMinutes > 0
    && (!form.desiredDate || !form.latestDate || form.desiredDate <= form.latestDate)
    && !(form.preferredDate && form.fixedDate)
    && (!form.recurring || Boolean(form.recurrenceStart && form.recurrenceEnd && form.recurrenceStart <= form.recurrenceEnd))
  const save = (keepOpen: boolean) => {
    if (!valid) return
    onSave({ ...form, title: form.title.trim() }, keepOpen)
    if (keepOpen && !existingItem) {
      setForm({ ...emptyDraft(state), subject: form.subject, priority: form.priority, unitMinutes: form.unitMinutes, activityType: form.activityType, highIntensity: form.highIntensity, countInStats: form.countInStats, recurring: form.recurring, allowSplit: form.allowSplit, splitSessionMinutes: form.splitSessionMinutes, prerequisiteGroupIds: form.prerequisiteGroupIds, goalIds: form.goalIds })
    }
  }

  return <Modal open={open} title={existingItem ? '编辑录入中的任务组' : '添加任务组到录入'} onClose={onClose} wide mobileFullscreen>
    <div className="form-grid">
      <label className="field span-2"><span>任务组名称</span><input autoFocus value={form.title} onChange={event => patch('title', event.target.value)} placeholder="例如：化学预习"/></label>
      <label className="field"><span>科目／类别</span><input list="intake-subjects" value={form.subject} onChange={event => patch('subject', event.target.value)}/><datalist id="intake-subjects">{state.settings.customSubjects.map(subject => <option key={subject} value={subject}/>)}</datalist></label>
      <label className="field"><span>优先级</span><select value={form.priority} onChange={event => patch('priority', Number(event.target.value) as Priority)}>{priorities.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="field"><span>{form.recurring ? '单次预计（分钟）' : '单项预计（分钟）'}</span><NumericInput min={1} max={1440} value={form.unitMinutes} onValueChange={value => patch('unitMinutes', value)}/></label>
      {!form.recurring && <label className="field"><span>数量</span><NumericInput min={1} max={10000} value={form.quantity} onValueChange={value => patch('quantity', value)}/></label>}
      {!form.recurring && <><label className="field"><span>期望完成日期（可选）</span><input type="date" min={state.settings.startDate} value={form.desiredDate ?? ''} onChange={event => patch('desiredDate', event.target.value || undefined)}/></label><label className="field"><span>最晚完成日期（可选）</span><input type="date" min={form.desiredDate ?? state.settings.startDate} value={form.latestDate ?? ''} onChange={event => patch('latestDate', event.target.value || undefined)}/></label>{(form.desiredDate || form.latestDate) && <label className="field span-2"><span>目标名称（可选）</span><input value={form.goalTitle ?? ''} onChange={event => patch('goalTitle', event.target.value || undefined)} placeholder={`默认：${form.title || '任务组'}完成目标`}/><small>应用本批次时才会创建正式目标；录入阶段不影响当前计划。</small></label>}</>}
      {form.desiredDate && form.latestDate && form.desiredDate > form.latestDate && <div className="form-error span-2">期望完成日期不能晚于最晚完成日期。</div>}

      {!form.recurring && <><label className="field"><span>排期日期意图</span><select value={form.fixedDate ? 'fixed' : form.preferredDate ? 'preferred' : 'system'} onChange={event => { const date = form.fixedDate ?? form.preferredDate ?? todayISO(); setForm(current => ({ ...current, fixedDate: event.target.value === 'fixed' ? date : undefined, preferredDate: event.target.value === 'preferred' ? date : undefined })) }}><option value="system">系统选择日期</option><option value="preferred">尽量安排在指定日期</option><option value="fixed">必须安排并锁定在指定日期</option></select></label>{(form.preferredDate || form.fixedDate) && <label className="field"><span>{form.fixedDate ? '固定排期日' : '偏好排期日'}</span><input type="date" min={state.settings.startDate} max={state.settings.endDate} value={form.fixedDate ?? form.preferredDate ?? ''} onChange={event => form.fixedDate ? patch('fixedDate', event.target.value || undefined) : patch('preferredDate', event.target.value || undefined)}/><small>{form.fixedDate ? '固定日期属于硬约束，排期器不会自动移动。' : '这是软偏好，容量或目标冲突时方案可以调整。'}</small></label>}</>}

      <fieldset className="field span-2 intake-rule-choice"><legend>执行方式</legend>
        <label><input type="radio" name="intake-rule" checked={!form.recurring} onChange={() => patch('recurring', false)}/><span><strong>普通任务组</strong><small>生成指定数量的任务，由排期器安排日期。</small></span></label>
        <label><input type="radio" name="intake-rule" checked={Boolean(form.recurring)} onChange={() => patch('recurring', true)}/><span><strong>重复任务</strong><small>按日期范围固定生成每日或每周任务。</small></span></label>
      </fieldset>

      {form.recurring && <>
        <label className="field"><span>开始日期</span><input type="date" value={form.recurrenceStart ?? state.settings.startDate} onChange={event => patch('recurrenceStart', event.target.value)}/></label>
        <label className="field"><span>结束日期</span><input type="date" value={form.recurrenceEnd ?? state.settings.endDate} onChange={event => patch('recurrenceEnd', event.target.value)}/></label>
        <fieldset className="field span-2 weekday-picker"><legend>每周重复日期（不选表示每天）</legend>{['日','一','二','三','四','五','六'].map((label, day) => <label key={day}><input type="checkbox" checked={(form.recurrenceWeekdays ?? []).includes(day)} onChange={event => patch('recurrenceWeekdays', event.target.checked ? [...new Set([...(form.recurrenceWeekdays ?? []), day])].sort() : (form.recurrenceWeekdays ?? []).filter(value => value !== day))}/><span>周{label}</span></label>)}</fieldset>
      </>}

      {!form.recurring && <details className="form-advanced span-2"><summary>高级规则</summary><div className="form-grid">
        <label className="field"><span>每日最多数量</span><NumericInput min={1} max={999} value={form.dailyMax} placeholder="不限制" onValueChange={value => patch('dailyMax', value)} onEmpty={() => patch('dailyMax', undefined)}/></label>
        <label className="field checkbox-field"><input type="checkbox" checked={Boolean(form.highIntensity)} onChange={event => patch('highIntensity', event.target.checked)}/><span>高强度任务</span></label>
        <label className="field checkbox-field"><input type="checkbox" checked={Boolean(form.allowSplit)} onChange={event => patch('allowSplit', event.target.checked)}/><span>拆成多个可独立排期的学习段</span></label>
        {form.allowSplit && <label className="field"><span>目标单次时长</span><NumericInput min={5} max={Math.max(5, form.unitMinutes - 1)} value={form.splitSessionMinutes ?? Math.min(60, Math.max(5, Math.round(form.unitMinutes / 2)))} onValueChange={value => patch('splitSessionMinutes', value)}/></label>}
        {state.taskGroups.length > 0 && <fieldset className="field span-2 prerequisite-picker"><legend>前置任务组（可选）</legend>{state.taskGroups.filter(group => group.status !== 'archived').map(group => <label key={group.id}><input type="checkbox" checked={(form.prerequisiteGroupIds ?? []).includes(group.id)} onChange={event => patch('prerequisiteGroupIds', event.target.checked ? [...new Set([...(form.prerequisiteGroupIds ?? []), group.id])] : (form.prerequisiteGroupIds ?? []).filter(id => id !== group.id))}/><span>{group.subject}，{group.title}</span></label>)}</fieldset>}
      </div></details>}

      {state.goals.length > 0 && <fieldset className="field span-2 goal-link-field"><legend>加入目标（可选）</legend>{state.goals.filter(goal => goal.status !== 'archived').map(goal => <label key={goal.id}><input type="checkbox" checked={form.goalIds.includes(goal.id)} onChange={event => patch('goalIds', event.target.checked ? [...new Set([...form.goalIds, goal.id])] : form.goalIds.filter(id => id !== goal.id))}/><span>{goal.title}，最晚 {goal.latestDate}</span></label>)}</fieldset>}
      <label className="field span-2"><span>备注</span><textarea rows={3} value={form.notes ?? ''} onChange={event => patch('notes', event.target.value || undefined)}/></label>
      <div className="form-note span-2">保存只会更新当前录入批次，不会生成排期或改变正式计划。</div>
    </div>
    <div className="modal-actions">
      <button className="secondary-button" onClick={onClose}>取消</button>
      {!initial && <button className="secondary-button" disabled={!valid} onClick={() => save(true)}>保存并继续新增</button>}
      <button className="primary-button" disabled={!valid} onClick={() => save(false)}>{existingItem ? '保存修改' : '保存并返回'}</button>
    </div>
  </Modal>
}
