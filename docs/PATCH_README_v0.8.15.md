# v0.8.15 覆盖补丁

基线：Study Planner v0.8.14。

## 修复内容

- 修复自定义域名经过 Vercel 转发时，访问日志 POST 可能被错误判定为跨域的问题。
- 访问事件先保存到浏览器持久待发送队列，离线或短暂失败后自动补写。
- 新增累计访问 JSON 与 GitHub README SVG 徽章。
- 新增 `VISIT_COUNT_OFFSET`，用于补入外部可信来源确认的历史访问基数。
- 新增访问日志专项 SQL 迁移和验证脚本。

覆盖后请执行 `supabase-visit-log-migration.sql`，确认 Vercel Production 环境已配置服务端 Supabase 变量，再重新部署。
