# Study Planner README screenshot pack

Recommended README usage:

## Main README (recommended 7 images)

1. `01-rescheduling-preview.png`
   - Hero image directly below the one-line product positioning + Live Demo.
   - Proves: rescheduling proposal, minimal-change strategy, impact counts, conflict preview.

2. `03-calendar-month-view.png`
   - After `Key Features`, before `Typical Scenario`.
   - Proves: this is a real long-term study planner, not only a rescheduling dialog.

3. `02-today-execution.png`
   - Early inside `Typical Scenario`, after describing actual execution deviating from plan.
   - Proves: completion, actual time, unfinished review, execution-aware input.

4. `06-daily-workload-before-after.png`
   - Inside `Typical Scenario`, after explaining recalculation of future workload.
   - Proves: day-level workload changes before/after rescheduling.

5. `07-task-level-rescheduling.png`
   - Immediately after the workload screenshot.
   - Proves: task-level before/after and explanation of why a task could not be scheduled elsewhere.

6. `08-goal-impact.png`
   - Near the end of `Typical Scenario`.
   - Proves: rescheduling propagates to long-term goal completion dates and deadline risk.

7. `10-statistics-execution-status.png`
   - In/after the detailed `核心能力` section, near review/execution feedback.
   - Proves: planned-vs-actual, completion rate, delays, focus statistics.

## Optional / secondary screenshots

- `04-goals-overview.png`
  - Good for the detailed "目标驱动的计划设计" section.
  - Can replace the statistics image if you want the README to emphasize planning over analytics.

- `05-adjustment-strategy.png`
  - Good for the detailed "多方案调整 / 用户意图保护" section.
  - Useful if you want to show that users choose *why* and *how* to reorganize a plan.

- `11-statistics-by-subject.png`
  - Optional detailed analytics screenshot.
  - Better in docs than near the README top.

- `12-statistics-trends.png`
  - Optional trends/analytics screenshot.
  - Better in docs or a collapsible "More screenshots" section.

- `13-statistics-overview-heatmap.png`
  - Optional overview/heatmap screenshot.
  - Good if you want one visually rich analytics screenshot.

- `14-data-recovery-sync.png`
  - Put near `数据与隐私 / 本地数据与同步边界`, or keep in docs.
  - Do not put near the README top.

- `15-planning-settings.png`
  - Put near advanced scheduling/settings documentation.
  - Useful proof of capacity/date constraints, but too detailed for first-time visitors.

- `09-structure-changes.png`
  - Keep as advanced evidence / internal scheduling model documentation.
  - Not recommended for the main product story because `soft -> normal` is hard to understand without context.

## Suggested top-level visual flow

Positioning + Live Demo
→ `01-rescheduling-preview.png`
→ Key Features
→ `03-calendar-month-view.png`
→ Typical Scenario
   → `02-today-execution.png`
   → `06-daily-workload-before-after.png`
   → `07-task-level-rescheduling.png`
   → `08-goal-impact.png`
→ 这是什么 / 核心能力
→ `10-statistics-execution-status.png`
→ 设计原则 / 架构 / technical sections

This keeps the README focused on the product story:
Plan → Execute → Deviate → Reschedule → Explain → Check long-term goal impact.

## Review / 复盘 screenshots

These three screenshots are valuable because they prove that `execution-aware` is not just a slogan: the app records actual execution, compares planned vs. actual time, lets users decide what to do with unfinished tasks, learns from recent duration samples, and then feeds those results back into future planning.

- `16-review-summary-and-unfinished-tasks.png`
  - Recommended for the main README.
  - Place in `Typical Scenario` immediately after `02-today-execution.png`, or in `核心能力` next to the `复盘` bullet.
  - Proves: planned vs. actual time, completion rate, unfinished-task handling, and user-controlled next scheduling decisions.

- `17-review-adaptive-duration-suggestions.png`
  - Recommended in the main README if you want to emphasize adaptive planning.
  - Place after the review summary screenshot.
  - Proves: recent actual-duration samples are used to suggest more realistic future estimates without silently overwriting user settings.

- `18-review-statistics-and-next-actions.png`
  - Optional for the main README; excellent in a collapsible `More screenshots / 更多截图` section.
  - Proves: review analytics plus explicit next-step choices such as completing review, generating more plans, or keeping review without rescheduling.

### Updated recommended visual story

Positioning + Live Demo
→ `01-rescheduling-preview.png`
→ Key Features
→ `03-calendar-month-view.png`
→ Typical Scenario
   → `02-today-execution.png`
   → `16-review-summary-and-unfinished-tasks.png`
   → `17-review-adaptive-duration-suggestions.png`
   → `06-daily-workload-before-after.png`
   → `07-task-level-rescheduling.png`
   → `08-goal-impact.png`
→ 核心能力 / 复盘
   → optionally `18-review-statistics-and-next-actions.png`
→ technical sections

This makes the product loop visible:
Plan → Execute → Review → Learn from actual duration → Reschedule → Explain → Re-check long-term goals.

