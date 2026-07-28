# 部署说明（GitHub + Vercel）

## 1. 推送到 GitHub

确保仓库根目录直接包含：

```text
src/
public/
package.json
vite.config.ts
supabase-schema.sql
```

## 2. Vercel 导入

- Framework Preset：Vite
- Install Command：`npm install`
- Build Command：`npm run build`
- Output Directory：`dist`
- Root Directory：仓库根目录

环境变量：

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

修改环境变量后需要重新部署。

## 3. Supabase

在 SQL Editor 执行 `supabase-schema.sql`。该表按 `user_id` 保存一个 JSON 快照，并启用 RLS，仅允许用户访问自己的数据。

Authentication → URL Configuration：

```text
Site URL: https://你的正式域名
Redirect URLs:
https://你的正式域名/**
https://你的项目.vercel.app/**
http://localhost:5173/**
```

## 4. 自定义域名

在 Vercel 项目 Settings → Domains 中添加域名，并按 Vercel 给出的 DNS 记录配置。

## 5. 隐私注意

不要把个人任务种子、导出的 JSON 备份、`.env` 或任何 secret/service_role key 提交到公开 GitHub 仓库。个人计划应只保存在 Supabase 账号快照或私有备份中。
