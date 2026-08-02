# Study Planner v0.8.11 覆盖补丁说明

适用基线：v0.8.10。

该补丁修复 iPhone 复盘页面中未完成任务卡仍使用桌面双栏，造成任务标题竖排、日期选择框覆盖正文的问题。

覆盖方法：将补丁内文件按原目录覆盖到 v0.8.10 源码中，然后执行：

```bash
npm install
npm run typecheck
npm run test:mobile-review
npm run build
```

本补丁不修改数据结构、迁移逻辑、调度算法或用户数据。
