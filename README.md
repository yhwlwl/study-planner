# Study Planner

一个可部署到 Vercel 的 React 学习计划管理应用，支持离线使用、Supabase 登录与云同步、可解释自动重排和游客演示数据。

## 主要功能

- 极简今日任务页：完成、部分完成、实际用时；开始计时后进入独立沉浸式计时页。
- 沉浸计时：超大计时、暂停/继续、结束记录、快捷键、退出后随时返回。
- 月历：日期格快捷拖拽、“+N 项”悬浮/抽屉面板、全天管理、任务快捷改期、实时负载提示。
- 自动重排：局部修复、全面重排、三种候选方案、逐日展开微调、双栏前后对比和预览内撤销。
- 尊重用户意图：手动移动优先保留，近期不拉回原日期，可锁定。
- 现实约束：每日容量、任务数量、同科目占比、记忆任务分散、缓冲日提醒。
- 统计：四页签数据中心、学习热力图、计划与实际趋势、双完成率、科目投入、预计准确度、执行质量和专注分析。
- 数据：IndexedDB 离线保存、JSON/CSV 导出、最近 10 次重排历史及可查看的前后差异。
- 隐私：游客、不同账号数据空间完全隔离；个人计划不内置在公开源码中。
- 访问日志：可选的 Vercel 服务端日志，记录访问时间、IP 与 IP 推断位置，不调用 GPS。

## 技术栈

React 18、TypeScript、Vite、PWA、Supabase、IndexedDB、Recharts。

## 本地运行

```bash
npm install
cp .env.example .env
npm run dev
```

`.env`：

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

浏览器端不要使用 `service_role` 或 `sb_secret_...`。访问日志的 service role 只允许配置在 Vercel 服务端环境变量，且不能使用 `VITE_` 前缀。

## Vercel 部署

1. 将项目推送到 GitHub。
2. 在 Vercel 导入仓库，框架选择 Vite。
3. Build Command：`npm run build`。
4. Output Directory：`dist`。
5. 添加浏览器端两个环境变量；启用访问日志时另外添加服务端 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY`。
6. 在 Supabase SQL Editor 执行 `supabase-schema.sql`。
7. 在 Supabase Authentication → URL Configuration 中设置正式域名和 Vercel 域名。

## 数据安全说明

- 未登录时只加载虚构演示计划，不读取任何用户空间。
- 登录后先从该账号云端恢复，再启用自动保存。
- 退出登录时立即显示隐私遮罩并切换回游客空间。
- 默认清理当前设备上的账号离线缓存；可在设置中选择保留。
- Supabase 表启用了 RLS，每个用户只能访问自己的快照。
- 个人学习任务应只存在于个人 Supabase 快照或本地备份中，不应写入公开 GitHub 源码。

## 验证

当前代码通过严格 TypeScript 静态检查；排期核心另有运行时回归测试，覆盖手动延期不回退、每日上限、记忆任务分散和游客数据隔离。


## 访问日志隐私说明

访问日志用于安全排查和基础使用统计。记录服务器时间、IP 地址、IP 推断的国家/地区/城市、页面路径、浏览器与屏幕信息。不会请求 GPS 权限。IP 定位是近似结果，可能受 VPN、代理和运营商出口影响。建议设置合理保留期限，并在对外使用前准备符合所在地要求的隐私说明。
