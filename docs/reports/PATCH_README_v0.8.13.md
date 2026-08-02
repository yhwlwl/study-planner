# Study Planner v0.8.13 覆盖补丁

基线：v0.8.12

## 用途

统一修复手机端所有同类弹窗的底部操作区：按钮不再悬浮遮挡正文，footer 填满到底部安全区，正文和操作区各自独立。

## 覆盖方法

将补丁内文件按原目录覆盖到 v0.8.12 项目。

## 主要文件

- `src/components/Modal.tsx`
- `src/styles.css`
- `typecheck-stubs.d.ts`
- `package.json`
- `scripts/mobile-modal-footer-v0813.mjs`
- 版本化验证脚本与报告

## 数据

不修改 schemaVersion，不需要数据迁移。
