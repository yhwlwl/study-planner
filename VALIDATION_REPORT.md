# Study Planner v0.8.6 完成性与验证报告

## 结论

v0.8.6 修复手机 Today 首页大块空白，并把“硬冲突导致所有按钮禁用”升级为完整的逐项冲突决策闭环。

## 已执行验证

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run test:adjustment` | 通过：部分接受/拒绝例外、从已选候选重算、最小任务授权 |
| `npm run test:scenarios` | 33 / 33 |
| `npm run test:scale` | 通过 |
| `npm run validate:v08` | 68 / 68 |

规模夹具包含 20 个目标、50 个任务组、500 项任务、30 个日期约束和 10 个本地计划版本。

## 生产构建说明

当前环境的 npm 内部镜像缺少 `@supabase/supabase-js`，依赖安装返回 404，因此无法完成真实 Vite 构建。严格 TypeScript 检查使用项目存根配置通过，构建尝试日志位于 `validation/生产构建尝试_v0.8.6.log`。请在正常 npm 网络环境执行 `npm install && npm run build`。
