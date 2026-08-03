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
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SECRET_KEY=仅配置在Vercel服务端的sb_secret_key
```

修改环境变量后需要重新部署。

## 3. Supabase

在 SQL Editor 执行 `supabase-schema.sql`。它会创建个人快照表和访问日志表。访问日志表不允许 anon/authenticated 直接读写，只由 Vercel Function 使用 service role 写入。

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


## 6. 访问日志

部署后访问 `/api/visit-log` 由 Vercel Function 处理。直接在浏览器打开该地址会执行安全健康检查；正常返回 `ok: true` 与 `tableReady: true`。`SUPABASE_SECRET_KEY` 绝不能加 `VITE_` 前缀，也不能写入源码。位置来自 Vercel 的 IP 地理请求头，不是 GPS，可能存在误差。

若环境变量只配置在 Production，使用 Preview 部署地址测试时函数会报告缺少环境变量；修改变量后必须重新部署。

## 7. 访问计数与 README 徽章

访问日志修复后，部署完成应按顺序验证：

1. 在 Supabase SQL Editor 执行根目录的 `supabase-visit-log-migration.sql`（重复执行安全）。
2. 在 Vercel Production 环境确认已配置：

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

3. 重新部署 Production。
4. 浏览器打开：

```text
https://你的域名/api/visit-log
```

正常响应会包含：

```json
{
  "ok": true,
  "tableReady": true,
  "storedPageViews": 123,
  "countOffset": 0,
  "totalPageViews": 123
}
```

5. 实际打开应用后刷新上述接口，`storedPageViews` 应增加。

README 可直接使用：

```md
![网站累计访问](https://你的域名/api/visit-log?format=svg)
```

访问日志修复前已经丢失的历史事件无法还原明细。若从 Vercel Web Analytics 或其他可信来源得到一个明确的历史页浏览量，可在 Vercel 设置 `VISIT_COUNT_OFFSET`。显示总数为：

```text
Supabase 已存储 page_view + VISIT_COUNT_OFFSET
```

不要根据 GitHub stars、clones 或估算值随意填写这个基数。
