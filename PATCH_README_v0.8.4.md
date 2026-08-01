# Study Planner v0.8.4 覆盖补丁说明

基线：v0.8.3。

本补丁重点修复三大系统的行为闭环：

- 方案内单项改期、保留原日和锁定结果均重新验算；
- 稳定性评分与文案一致；
- 复盘纳入原计划和真实执行，并保存不可被后续状态重写的历史快照；
- 目标记录实际达成日期和按期结果；
- 空目标不自动完成；
- 进行中目标不能直接归档绕过约束；
- 任务组完成时间使用真实完成记录。

覆盖仓库同名文件后，在正常依赖环境执行：

```bash
npm install
npm run typecheck
npm run validate:v08
npm run test:scenarios
npm run test:scale
npm run build
```

完整新部署优先使用 v0.8.4 完整源码包，避免旧文件残留。
