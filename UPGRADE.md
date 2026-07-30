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
