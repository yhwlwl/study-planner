# v0.8.14 覆盖补丁

基线：GitHub `yhwlwl/study-planner` 用户上传的 `main` 源码（v0.8.13）。

修复：过去未完成任务在复盘或待处理视图中顺延时，不再被错误判定为“过去日期已冻结”。

覆盖补丁根目录到项目根目录后执行：

```bash
npm install
npm run typecheck
npm run test:adjustment
npm run test:scenarios
npm run build
```

补丁不修改 AppState schema，不需要数据迁移。
