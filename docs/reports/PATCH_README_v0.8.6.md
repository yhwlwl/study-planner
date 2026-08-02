# Study Planner v0.8.6 覆盖补丁说明

基线：v0.8.5 完整源码。

覆盖内容：

- 手机 Today 首页大块空白修复；
- 硬冲突分类与逐项详情；
- 一次性例外逐项接受/拒绝；
- 按用户决定重新计算并再次预览；
- 最小任务范围例外；
- 冲突与无候选状态的可点击下一步；
- 新增验证脚本和 v0.8.6 文档。

使用方法：将补丁中的文件按原目录覆盖到 v0.8.5 源码，随后执行：

```bash
npm install
npm run typecheck
npm run test:adjustment
npm run test:scenarios
npm run validate:v08
npm run build
```
