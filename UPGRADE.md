# 从 V0.6.3 升级到 V0.6.4

本版本新增任务顺序冲突检测与可选重新编号，不改变 Supabase 表结构、RLS、环境变量或同步数据边界。

## 手机上上传

### 仓库根目录

- `package.json`
- `CHANGELOG.md`
- `UPGRADE.md`
- `IMPLEMENTATION_STATUS.md`

### `src/`

- `App.tsx`
- `AppContext.tsx`
- `styles.css`
- `types.ts`

### `src/lib/`

- `sequence.ts`（新增）

覆盖同名文件即可。不要上传 ZIP 文件本身，也不需要重新执行 Supabase SQL。

## 行为变化

- 手动或自动调整日期后，系统只检查本次发生日期变化的任务组。
- 若任务编号与当前日期顺序冲突，会弹出预览并询问是否重新编号。
- 可按组勾选；选择保留原编号不会修改数据。
- 重新编号只修改 `index` 与显示标题，其他任务数据全部保留。
- 同一天内按原编号排序，未安排任务放在已安排任务之后。
- 重复任务保持原有“标题 · 日期”格式，不参与重新编号。

## v0.6.4 → v0.6.5

1. 覆盖补丁中的源码文件，并新增 `api/visit-log.ts` 与 `src/lib/analytics.ts`。
2. 在 Supabase SQL Editor 重新执行 `supabase-schema.sql`，创建受保护的 `visit_logs` 表。
3. 在 Vercel 项目环境变量中新增：
   - `SUPABASE_URL`：与 `VITE_SUPABASE_URL` 相同。
   - `SUPABASE_SECRET_KEY`：Supabase 的新 Secret key（`sb_secret_...`），仅服务端使用，绝不能加 `VITE_` 前缀。旧项目也兼容 `SUPABASE_SERVICE_ROLE_KEY`。
4. 重新部署。访问日志可在 Supabase Table Editor 的 `visit_logs` 表查看。
