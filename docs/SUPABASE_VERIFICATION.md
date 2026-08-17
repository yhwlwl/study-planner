# Supabase 全链路验证

这个项目把 Supabase 当作独立外部依赖验证，而不是只检查某一张表或某一个字段。目标是尽早发现 Auth、Data API、RLS、schema、上传/恢复协议和并发控制的漂移。

## 验证层级

### 1. `public` smoke

只需要项目 URL 和 publishable/anon key，不创建账号、不写业务数据：

- 密码登录接口可达，并能对无效凭据返回正常认证错误；
- 注册接口可达，并能对无效输入返回正常校验错误；
- `study_snapshots` Data API 可访问；
- `user_id`、`data`、`client_updated_at`、`updated_at`、`revision` 关键列都可被 PostgREST 解析；
- 匿名角色读不到任何用户快照，防止 RLS 意外泄漏。

### 2. `full` smoke

除上述检查外，使用服务端 secret key 创建两个隔离临时账号，并在 `finally` 中自动清理：

- 创建并确认临时 Auth 用户；
- 使用 publishable key 走真实 `signInWithPassword`；
- `getSession` 能读取当前 session；
- 新账号第一次恢复应为空；
- 首次上传 `revision = 1`；
- 同一用户重复首次 `INSERT` 返回唯一键冲突；
- 上传后能完整下载/恢复；
- `revision 1 -> 2` 更新成功；
- 旧 revision 更新返回 0 行，验证乐观并发冲突语义；
- 第二个用户不能读取第一个用户的快照；
- 第二个用户不能更新第一个用户的快照；
- `signOut({ scope: 'local' })` 后当前 session 被清除；
- 测试快照和临时 Auth 用户自动删除。

测试账号使用 `example.invalid` 域名，避免向真实邮箱发送邮件；账号由 Admin API 直接设为已确认，不依赖生产邮件配置。

## 本地运行

```bash
SUPABASE_URL='https://PROJECT.supabase.co' \
SUPABASE_PUBLISHABLE_KEY='sb_publishable_...' \
SUPABASE_SMOKE_MODE=public \
npm run test:supabase:smoke
```

完整链路：

```bash
SUPABASE_URL='https://PROJECT.supabase.co' \
SUPABASE_PUBLISHABLE_KEY='sb_publishable_...' \
SUPABASE_SECRET_KEY='sb_secret_...' \
SUPABASE_SMOKE_MODE=full \
npm run test:supabase:smoke
```

`SUPABASE_SECRET_KEY` 只允许出现在服务端环境或 GitHub Secrets 中，绝不能加 `VITE_` 前缀，也不要写入仓库。

## GitHub Actions

`.github/workflows/supabase-smoke.yml` 支持手动运行，并每天自动跑一次 `full` smoke。仓库需要配置：

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

缺少任何 full 模式必需变量时，workflow 会明确失败，而不是静默跳过，避免出现“绿色但实际上没验证”的假象。

## 事故定位意义

如果 smoke 失败，可以按失败项快速区分：

- 登录/注册接口失败：Auth/Gateway/项目配置问题；
- schema 探测失败：迁移未执行、列缺失、Data API schema cache 或 grant 问题；
- 上传失败：INSERT policy、FK、Data API 或 schema 问题；
- 恢复失败：SELECT policy、schema 或序列化链路问题；
- revision 更新失败：并发协议/schema 漂移；
- 跨用户读写成功：RLS 严重安全问题；
- 登出/session 失败：Auth session 行为或 SDK 行为变化。
