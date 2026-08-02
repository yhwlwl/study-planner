# Study Planner v0.8.5 覆盖补丁说明

基线：v0.8.4 完整源码。

本补丁重构计划调整协调层与展示层，不替换 v0.8.4 已有的目标、任务、约束、版本、迁移和同步体系。

## 主要变化

- 复盘已选日期和批量移动改为精确校验；
- 目标放宽、容量增加默认保持现有排期；
- 新任务、目标收紧和旅行范围显示推荐与备选；
- “计划太累”先询问具体减负结果；
- 所有智能改动先预览；
- 摘要计数可逐层展开；
- 强化选中态、红绿负载变化和手机全屏布局。

覆盖仓库同名文件后，在正常依赖环境执行：

```bash
npm install
npm run typecheck
npm run test:adjustment
npm run test:scenarios
npm run test:scale
npm run validate:v08
npm run build
```

完整新部署优先使用 v0.8.5 完整源码包，避免旧文件残留。
