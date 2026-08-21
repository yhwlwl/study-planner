// 页面滚动锁（弹窗/抽屉共用）。用引用计数保证「多个弹窗乱序关闭」也不会把 body 锁死：
// 只要还有任意一个弹窗打开，滚动保持锁定；全部关闭后才恢复进入前的原始 overflow。
// 同时管理 <body> 与 <html> 两个层级，避免只锁一个时在部分浏览器（尤其 Windows 桌面
// Chrome/Edge）出现「整页滑不动、iOS 却不锁」的平台差异。
let depth = 0
let originalBodyOverflow = ''
let originalDocumentOverflow = ''

export function lockPageScroll(): () => void {
  if (depth === 0) {
    originalBodyOverflow = document.body.style.overflow
    originalDocumentOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
  }
  depth += 1
  let released = false
  return () => {
    if (released) return
    released = true
    depth = Math.max(0, depth - 1)
    if (depth === 0) {
      document.body.style.overflow = originalBodyOverflow
      document.documentElement.style.overflow = originalDocumentOverflow
      originalBodyOverflow = ''
      originalDocumentOverflow = ''
    }
  }
}
