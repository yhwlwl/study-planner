# 部署说明

## 最快方式：直接部署 `standalone/`

把 `standalone` 内全部文件上传到域名根目录。不要只上传 `index.html`，否则样式、脚本、PWA 图标和离线缓存无法工作。

Nginx 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name plan.example.com;

    root /var/www/study-planner/standalone;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location = /sw.js {
        add_header Cache-Control "no-cache";
    }
}
```

Cloudflare Pages、Vercel 或 Netlify 可以直接把 `standalone` 设为发布目录，无需构建命令。

## React 版

构建命令：

```bash
npm install
npm run build
```

发布目录：

```text
dist
```

环境变量：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

## Supabase

运行 `supabase-schema.sql` 后再开启同步。表采用 `user_id` 主键，每个登录用户只有一个 JSON 快照，并通过 RLS 限制为仅能读写自己的数据。
