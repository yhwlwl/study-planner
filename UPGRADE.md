# 从 V0.5.0 升级到 V0.6.0

1. 将补丁包中的全部文件上传到 GitHub 仓库根目录并覆盖同名文件。
2. 本次没有新增 Supabase 表、环境变量或 Vercel 配置，不需要重新执行 SQL。
3. 旧计划会在本地自动补齐新的重排设置、任务活动类型和缓冲日字段，无需手工迁移。
4. 为了正确识别每日上限，旧任务会按标题自动推断“文言文学习、默写、背诵、化学预习、数学整套试卷”；也可以在任务组编辑页手动修正活动类型。
5. 旧版设置的日期类型、手动移动和锁定状态会继续保留。手动设置的缓冲日会默认视为受保护日期。
6. 游客已有本地修改不会自动被新演示数据覆盖；在“设置 → 数据与恢复”中点击“恢复演示计划”才会载入新的完整演示。
7. 游客也可点击“从空白开始”，不必使用演示计划。
8. Vercel 会在提交后自动重新部署。

## 手机上传顺序

补丁包保持了仓库目录结构。手机端可分别进入对应目录上传并覆盖：

- 仓库根目录：`package.json`、`CHANGELOG.md`、`UPGRADE.md`、`IMPLEMENTATION_STATUS.md`
- `src/`：`App.tsx`、`AppContext.tsx`、`styles.css`、`types.ts`
- `src/components/`：`ReplanDialog.tsx`、`TaskCard.tsx`、`TaskGroupDialog.tsx`
- `src/lib/`：`date.ts`、`planner.ts`、`seed.ts`

不要把 ZIP 文件直接上传到仓库，也不要删除其他源码文件。
