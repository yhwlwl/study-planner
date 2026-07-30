# v0.7.0 · 手机端专项体验优化

- 月历在手机上固定显示完整 7 列，不再横向滚动；新增月/周视图切换。
- 周视图使用纵向任务列表；月视图左右滑月份，周视图左右滑星期。
- 点击日期以底部抽屉展示详情；长按月历、周视图或日期抽屉中的任务后，点击目标日期即可移动。
- 今日页增加移动端快速操作按钮。
- 重排中心在 iPhone PWA 中改为全屏布局，所有日期、任务名、原因和按钮在边框内完整换行。
- “方案后果”可展开查看全部待处理问题、移动任务明细和计划扰动指标，不删减原有解释。
- 增加 iPhone 主屏幕 PWA 的安全区域、动态视口高度和 Home Indicator 适配。


## 手机上上传

### 仓库根目录

- `package.json`
- `CHANGELOG.md`
- `UPGRADE.md`
- `IMPLEMENTATION_STATUS.md`
- `typecheck-stubs.d.ts`

### `api/`

- `visit-log.ts`

### `src/`

- `App.tsx`
- `styles.css`

### `src/components/`

- `Modal.tsx`
- `ReplanDialog.tsx`
- `TaskGroupDialog.tsx`
- `HistoryDiffDialog.tsx`

### `src/lib/`

- `analytics.ts`

覆盖后重新部署即可。数据库结构、Supabase RLS 和环境变量均无变化，不需要再次执行 SQL。

# 从 v0.6.5 升级到 v0.6.6

本版本修复访问日志诊断与触发可靠性，并移除侧边栏中的访问日志提示。

## 手机上上传

### 仓库根目录

- `package.json`
- `CHANGELOG.md`
- `UPGRADE.md`
- `IMPLEMENTATION_STATUS.md`
- `DEPLOYMENT.md`

### `api/`

- `visit-log.ts`

### `src/`

- `App.tsx`
- `main.tsx`
- `styles.css`

### `src/lib/`

- `analytics.ts`

覆盖后在 Vercel 重新部署。数据库结构未变化；已经执行过 v0.6.5 的 `supabase-schema.sql` 时不必再次执行。若尚未创建 `visit_logs` 表，仍需执行最新版 `supabase-schema.sql`。

## 部署后检查

打开：

```text
https://你的域名/api/visit-log
```

正常应返回：

```json
{
  "ok": true,
  "version": "0.6.6",
  "configured": true,
  "tableReady": true
}
```

常见诊断代码：

- `missing_environment`：Vercel 缺少 URL 或 Secret key。
- `invalid_supabase_url`：URL 格式错误。
- `visit_logs_table_missing`：尚未执行创建日志表的 SQL。
- `supabase_key_rejected`：Secret/service-role key 不正确或环境范围未覆盖当前部署。
- `supabase_timeout` / `supabase_unreachable`：Vercel 到 Supabase 的请求超时或暂时不可达。

环境变量修改后必须重新部署；同时确认变量至少勾选 Production，预览域名测试时还需勾选 Preview。
