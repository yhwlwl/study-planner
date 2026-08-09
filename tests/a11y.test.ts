// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import axe from 'axe-core'

describe('critical shell accessibility', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('has no axe violations for the tutorial/export interaction shell', async () => {
    document.body.innerHTML = `<main aria-labelledby="page-title"><h1 id="page-title">使用教程</h1><nav aria-label="教程章节"><a href="#first-plan">第一次建计划</a></nav><section id="first-plan"><h2>建立第一份计划</h2><label for="export-start">开始日期</label><input id="export-start" type="date" /><button type="button">下载统计 CSV</button></section></main>`
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => null })
    const result = await axe.run(document.body)
    expect(result.violations).toEqual([])
  })
})
