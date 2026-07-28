# 学习计划 Web App

面向本次 2026.7.28—2026.8.25 暑假作业的个人学习计划系统，同时可以继续用于开学后的长期计划。

## 两个可用版本

### 1. `standalone/`：可直接部署版

无需构建。将 `standalone` 文件夹内的文件完整上传到网站根目录即可。

已实现：

- 今日任务首页
- 完成勾选、部分完成、实际时间录入
- 开始、暂停、继续及记入计时器
- 月历查看、拖拽改期、日期类型与容量设置
- 批量移动、锁定任务、一键动态重排和重排预览
- 任务新增、编辑、复制、删除、筛选
- 计划与实际时间、科目时间、优先级进度等统计
- 预计完成日期和风险提醒
- IndexedDB 本地离线保存
- JSON/CSV 导入导出、打印/PDF、撤销与重置
- PWA 离线缓存
- Supabase 邮箱登录及跨设备同步
- DeepSeek 服务端接口预留说明

> PWA 与 Service Worker 在正式域名上需要 HTTPS；localhost 可例外。

### 2. 根目录：React + TypeScript + Vite 源码版

这是后续长期维护的目标工程，使用 React、TypeScript、Vite、PWA、IndexedDB、Recharts 和 Supabase。

```bash
npm install
cp .env.example .env
npm run dev
```

生产构建：

```bash
npm run build
```

将 `dist/` 部署到 Vercel、Cloudflare Pages、Netlify、Nginx 或其他静态托管平台。

## Supabase 配置

1. 在 Supabase 项目 SQL Editor 中运行根目录的 `supabase-schema.sql`。
2. 在 Authentication 中启用 Email 登录。
3. React 版：在 `.env` 中填写：

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

4. 直接部署版：在网页“设置 → Supabase 云同步”中填写相同信息。

`anon key` 本来就是前端可公开使用的客户端密钥，安全边界由 RLS 策略保证；不要在前端放 `service_role key`。

## 初始计划规则

- 优先级 5 越早完成越好。
- 除化学预习、每日单词外，核心必做任务目标为 8 月 8 日。
- 化学预习共 15 个，每个 60 分钟，每天最多 1 个，目标不晚于 8 月 20 日。
- 系统会为“每日数量受限”的任务预留必要的前置日期。
- 单词每日出现，默认不计入每日计划总时间，可在设置中开启统计。
- 旅游日默认容量为 20 分钟，普通任务不会自动排入旅游日。
- 日期类型变化、任务未完成或实际时长偏差后，可以先预览再应用重排。

初始自动排期会根据任务量把前期若干日期设置为学习日；所有日期类型都可手动修改。

## 照片任务说明

照片中能够确认的任务已经预置。以下名称因字迹不清，在系统中标有“待确认”，可直接在“全部任务”页面修改：

- 化学两个 75 分钟任务
- 英语 30 个、每个 20 分钟的任务名称
- 部分优先级 1、2 的具体名称

优先级 0 默认隐藏，可在筛选中显示。

## DeepSeek

第一版不把 AI 作为排期核心依赖。若后续接入，应采用：

```text
浏览器 → 自己的服务端/Serverless Function → DeepSeek API
```

不要把 DeepSeek API Key 写入前端文件。
