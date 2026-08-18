// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PwaInstallGuideContent, PwaInstallPrompt } from '../src/components/PwaInstallGuide'
import {
  isStandaloneMode,
  recordBrowserVisit,
  resetInstallPromptPreference,
  shouldAutoOfferInstall,
  snoozeInstallPrompt,
} from '../src/pwa-install'

function setStandalone(value: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: value && query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  setStandalone(false)
  resetInstallPromptPreference()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PWA 安装引导', () => {
  it('同一浏览器会话只累计一次访问，并允许新用户首个会话收到提示', () => {
    expect(recordBrowserVisit()).toBe(1)
    expect(recordBrowserVisit()).toBe(1)
    expect(shouldAutoOfferInstall(1)).toBe(true)

    window.sessionStorage.clear()
    expect(recordBrowserVisit()).toBe(2)
    expect(shouldAutoOfferInstall(2)).toBe(true)
  })

  it('用户选择稍后后 7 天内不会再次自动提示', () => {
    window.localStorage.setItem('study-planner:pwa-browser-visits-v1', '3')
    expect(shouldAutoOfferInstall(3)).toBe(true)
    snoozeInstallPrompt()
    expect(shouldAutoOfferInstall(3)).toBe(false)
  })

  it('已经从主屏幕 / PWA 打开时不再提示安装', () => {
    setStandalone(true)
    expect(isStandaloneMode()).toBe(true)
    expect(shouldAutoOfferInstall(8)).toBe(false)
  })

  it('全局安装提示不使用轮询，避免给主线程增加常驻负担', () => {
    const intervalSpy = vi.spyOn(window, 'setInterval')
    render(<PwaInstallPrompt />)
    expect(intervalSpy).not.toHaveBeenCalled()
  })

  it('iPhone 教程包含共享与添加到主屏幕步骤', () => {
    render(<PwaInstallGuideContent platform="ios" compact />)
    expect(screen.getAllByText(/共享/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/添加到主屏幕/).length).toBeGreaterThan(0)
    expect(screen.getByText('Apple 官方说明')).toBeTruthy()
  })

  it('iPhone 截图必须完整显示，不能再用 cover 裁掉“添加到主屏幕”', () => {
    const css = readFileSync(join(process.cwd(), 'src/pwa-install.css'), 'utf8')
    const visualRule = css.match(/\.pwa-guide-visual\s*\{[\s\S]*?\}/)?.[0] ?? ''
    expect(visualRule).toContain('object-fit: contain')
    expect(visualRule).not.toContain('object-fit: cover')
  })

  it('桌面截图即使第三方图片失效，也显示内置中文安装菜单示意图', () => {
    render(<PwaInstallGuideContent platform="desktop" />)
    const image = screen.getByAltText('Chrome 桌面端中文界面的将网页作为应用安装操作示意图')
    fireEvent.error(image)
    expect(screen.getByText('将网页作为应用安装…')).toBeTruthy()
    expect(screen.getByText(/关键位置：浏览器菜单/)).toBeTruthy()
  })

  it('iPhone 截图失效时的兜底图仍直接标出添加到主屏幕', () => {
    render(<PwaInstallGuideContent platform="ios" />)
    const image = screen.getByAltText('iPhone Safari 简体中文界面的添加到主屏幕操作示意图')
    fireEvent.error(image)
    expect(screen.getByText('添加到主屏幕 ＋')).toBeTruthy()
    expect(screen.getByText(/关键位置：共享/)).toBeTruthy()
  })
})
