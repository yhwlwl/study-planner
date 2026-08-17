import {
  ArrowUpRight, BarChart3, BookOpen, CalendarDays, CheckCircle2, Github, Inbox,
  ListChecks, RefreshCw, Target, Timer,
} from 'lucide-react'
import todayImage from '../../docs/images/02-today-execution.png'
import calendarImage from '../../docs/images/03-calendar-month-view.png'
import loadImage from '../../docs/images/06-daily-workload-before-after.png'
import reviewImage from '../../docs/images/16-review-summary-and-unfinished-tasks.png'
import { GITHUB_REPO_URL } from '../lib/constants'

type GuidePageId = 'today' | 'calendar' | 'tasks' | 'intake' | 'goals' | 'stats' | 'export' | 'settings'

const chapters = [
  { id: 'first-plan', label: '第一次建计划' },
  { id: 'daily-use', label: '每天怎么用' },
  { id: 'changes', label: '计划变化时' },
  { id: 'concepts', label: '指标与数据' },
]

export function GuidePage({ onNavigate, onStartTutorial }: { onNavigate: (page: GuidePageId) => void; onStartTutorial?: () => void }) {
  return <div className="guide-page">
    <section className="guide-hero">
      <div className="guide-hero-copy">
        <span className="guide-eyebrow"><BookOpen size={15}/>使用教程</span>
        <h2>先录入任务，再让计划跟着你走</h2>
        <p>这不是一张静态待办清单。你先收集任务、设置可用时间，再用今日执行和复盘记录真实进展。现实变化时，系统只在你确认后修复计划。</p>
        <div className="guide-hero-actions">
          <button type="button" className="primary-button" onClick={() => onNavigate('intake')}><Inbox size={16}/>开始录入任务</button>
          {onStartTutorial && <button type="button" className="secondary-button" onClick={onStartTutorial}><RefreshCw size={16}/>打开互动教程</button>}
          <a className="secondary-button" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer"><Github size={16}/>查看 GitHub 仓库<ArrowUpRight size={14}/></a>
        </div>
        {onStartTutorial && <p className="muted-text">互动教程使用独立演示数据；步骤提示可以随时收起，并通过右下角“重新打开提示”继续。</p>}
      </div>
      <figure className="guide-hero-figure">
        <img src={todayImage} alt="今日执行页面，展示当天任务、实际用时与完成入口" />
        <figcaption><span>今日执行</span><strong>计划、计时和复盘集中在同一处</strong></figcaption>
      </figure>
    </section>

    <nav className="guide-chapters" aria-label="教程章节">
      {chapters.map(chapter => <a key={chapter.id} href={`#${chapter.id}`}>{chapter.label}</a>)}
    </nav>

    <section className="guide-section" id="first-plan">
      <GuideHeading eyebrow="从空白开始" title="建立第一份计划" text="收集阶段只保存和校验，不会因为每新增一项就重算整份计划。任务收齐后，再统一预览排期结果。" />
      <div className="guide-story guide-story-image-right">
        <div className="guide-story-copy">
          <GuideSteps steps={[
            ['进入录入', '添加独立任务或任务组，也可以使用自然语言、粘贴清单、导入 CSV 或 XLSX。中途退出后，下次仍能继续这个批次。'],
            ['补充约束', '设置任务数量、单项时长、目标期限、日期偏好和每天最多安排几项。'],
            ['统一排期', '点击生成第一份计划，比较候选方案的移动、超载和目标风险，确认后才写入正式计划。'],
          ]} />
          <button type="button" className="guide-card-action" onClick={() => onNavigate('intake')}>打开录入<ArrowUpRight size={14}/></button>
        </div>
        <GuideFigure src={calendarImage} alt="月历页面，展示任务在计划周期内的日期分布" label="排期完成后" caption="在月历中检查每天的任务和容量" />
      </div>
    </section>

    <section className="guide-section" id="daily-use">
      <GuideHeading eyebrow="日常闭环" title="每天只做三件事" text="开始学习、记录真实用时、结束时处理未完成任务。实际时间归到你正在记录的日期，而不是操作发生的系统日期。" />
      <div className="guide-flow-grid">
        <GuideFlowCard icon={Timer} title="开始执行" text="在今日页面开始计时，也可以手动完成或记录部分进度。" />
        <GuideFlowCard icon={CheckCircle2} title="留下真实记录" text="昨天的学习补录到昨天；今天继续同一任务的用时则计入今天。" />
        <GuideFlowCard icon={ListChecks} title="结束并复盘" text="逐项决定未完成任务顺延、保留原日期，还是稍后再处理。" />
        <GuideFlowCard icon={BarChart3} title="查看趋势" text="统计按实际归属日汇总，计划基线不会被后来的重排悄悄改写。" />
      </div>
      <div className="guide-story guide-story-two-images">
        <GuideFigure src={todayImage} alt="今日任务执行页面" label="白天" caption="计时、完成和部分完成" />
        <GuideFigure src={reviewImage} alt="结束复盘弹窗，展示计划时间、实际时间和未完成任务处理" label="结束时" caption="确认真实结果并处理未完成任务" />
      </div>
    </section>

    <section className="guide-section" id="changes">
      <GuideHeading eyebrow="突发情况" title="计划不合适时，先看影响再调整" text="临时请假、突然增加任务、目标提前，或想把未来任务移到今天，都从一次明确的调整开始。" />
      <div className="guide-story guide-story-image-left">
        <GuideFigure src={loadImage} alt="计划调整前后的日期负载对比" label="方案预览" caption="删除内容红色划线，新增内容绿色标记" />
        <div className="guide-story-copy">
          <GuideSteps steps={[
            ['说明发生了什么', '点击顶部“计划有变化”，选择执行偏差、太累、未来重排或当前冲突。'],
            ['比较候选方案', '少改、均衡、目标优先和休息优先代表不同取舍，不是四个重复按钮。'],
            ['处理硬冲突', '系统不会静默突破锁定、日期保护或容量。确实需要时，可以只对本轮、指定任务授权例外。'],
          ]} />
          <button type="button" className="guide-card-action" onClick={() => onNavigate('stats')}>查看统计与复盘<ArrowUpRight size={14}/></button>
        </div>
      </div>
    </section>

    <section className="guide-section guide-concepts-section" id="concepts">
      <GuideHeading eyebrow="口径说明" title="三个容易混淆的指标" text="它们回答的是不同问题，放在一起才知道今天是否真的超载。" />
      <div className="guide-concept-grid">
        <article><span className="guide-concept-label">原计划</span><strong>这一天原本准备学多少</strong><p>来自当天首次形成的计划基线。后来挪动任务不会重写历史，所以适合用来复盘计划质量。</p></article>
        <article><span className="guide-concept-label guide-concept-label-blue">已发生实际</span><strong>这一天实际学了多少</strong><p>按记录的归属日期汇总当天总用时，包括计时、手动记录、部分完成和补录。</p></article>
        <article><span className="guide-concept-label guide-concept-label-amber">执行负载 / 容量</span><strong>这一天还能不能装下</strong><p>执行负载把已发生实际和仍需执行的计划放在一起；容量是这一天可用于学习的总时间。</p></article>
      </div>
    </section>

    <section className="guide-section guide-entry-section">
      <GuideHeading eyebrow="快速入口" title="按你现在要做的事选择" text="不必先理解所有规则，先完成眼前动作即可。" />
      <div className="guide-entry-list">
        <GuideEntry icon={CheckCircle2} title="现在开始学习" detail="进入今日，直接计时或更新进度。" action="打开今日" onAction={() => onNavigate('today')} />
        <GuideEntry icon={Inbox} title="加入一批新任务" detail="创建录入批次，收齐后再统一安排。" action="打开录入" onAction={() => onNavigate('intake')} />
        <GuideEntry icon={CalendarDays} title="检查未来安排" detail="在月历查看每日任务、容量和日期约束。" action="打开月历" onAction={() => onNavigate('calendar')} />
        <GuideEntry icon={Target} title="修改目标期限" detail="调整期望日期、最晚日期和完成条件。" action="管理目标" onAction={() => onNavigate('goals')} />
        <GuideEntry icon={BarChart3} title="导出月历或统计" detail="下载 CSV、ICS、时间流水或打印报告。" action="打开导出" onAction={() => onNavigate('export')} />
      </div>
    </section>

    <section className="guide-principles">
      <div><span className="guide-eyebrow">使用原则</span><h3>少改动，讲清楚，不替你确认。</h3><p>锁定任务、手动安排、受保护日期和已经发生的实际记录会优先保留。系统调整会先生成候选方案，应用前仍能返回修改。</p></div>
      <a className="guide-repo-link" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer"><Github size={18}/><span><strong>需要更完整的背景？</strong><small>在 GitHub 查看 README、版本记录和源代码</small></span><ArrowUpRight size={17}/></a>
    </section>
  </div>
}

function GuideHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return <div className="guide-section-heading"><div><span className="guide-eyebrow">{eyebrow}</span><h3>{title}</h3><p>{text}</p></div></div>
}

function GuideSteps({ steps }: { steps: Array<[string, string]> }) {
  return <ol className="guide-steps">{steps.map(([title, text]) => <li key={title}><span/><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>
}

function GuideFigure({ src, alt, label, caption }: { src: string; alt: string; label: string; caption: string }) {
  return <figure className="guide-figure"><div className="guide-figure-frame"><img loading="lazy" src={src} alt={alt}/></div><figcaption><span>{label}</span><strong>{caption}</strong></figcaption></figure>
}

function GuideFlowCard({ icon: Icon, title, text }: { icon: typeof Target; title: string; text: string }) {
  return <article className="guide-flow-card"><div className="guide-flow-icon"><Icon size={18}/></div><strong>{title}</strong><p>{text}</p></article>
}

function GuideEntry({ icon: Icon, title, detail, action, onAction }: { icon: typeof Target; title: string; detail: string; action: string; onAction: () => void }) {
  return <article className="guide-entry"><div className="guide-entry-icon"><Icon size={17}/></div><div><strong>{title}</strong><p>{detail}</p></div><button type="button" className="text-button" onClick={onAction}>{action}<ArrowUpRight size={14}/></button></article>
}
