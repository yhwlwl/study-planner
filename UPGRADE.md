# 从 V0.6.0 升级到 V0.6.1

1. 将补丁包中的文件按目录上传并覆盖同名文件。
2. 本次只优化前端数字输入体验，不修改计划数据结构、Supabase 表、环境变量或 Vercel 配置。
3. 旧计划、游客演示数据、重排历史和统计记录都无需迁移。
4. 更新后点击任意数字框会自动选中原值，直接输入即可替换；也可以先清空再输入，失去焦点时才校验范围。
5. “每日最多数量”留空表示使用活动类型默认值，不再用 0 表示。
6. Vercel 会在提交后自动重新部署。

## 手机上传顺序

- 仓库根目录：`package.json`、`CHANGELOG.md`、`UPGRADE.md`、`IMPLEMENTATION_STATUS.md`
- `src/`：`App.tsx`
- `src/components/`：`NumericInput.tsx`、`TaskGroupDialog.tsx`、`ReplanDialog.tsx`、`FocusTimerPage.tsx`

`NumericInput.tsx` 是新增文件，不要漏传。不要把 ZIP 文件直接上传到仓库。
