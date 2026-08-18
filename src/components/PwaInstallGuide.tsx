import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, CheckCircle2, Download, X } from 'lucide-react'
import {
  PWA_INSTALL_EVENT,
  installPlatform,
  isIosSafari,
  isStandaloneMode,
  neverShowInstallPrompt,
  recordBrowserVisit,
  shouldAutoOfferInstall,
  snoozeInstallPrompt,
  type BeforeInstallPromptEvent,
  type InstallPlatform,
} from '../pwa-install'
import '../pwa-install.css'

const IOS_GUIDE_IMAGE = 'https://images.tenorshare.cn/topics/iphone-tips/llqsctj2.png'
const ANDROID_GUIDE_IMAGE = 'https://meta.appinn.net/uploads/default/original/2X/6/601259bd6228c0b470ad5c29f3084f8e6ae216ea.jpeg'
const DESKTOP_GUIDE_IMAGE = 'https://cdn3.linux.do/original/4X/3/d/4/3d4a0358fecd6549e02a883b2f145b612d88275e.jpeg'

const APPLE_SUPPORT_URL = 'https://support.apple.com/zh-cn/guide/iphone/iph42ab2f3a7/ios'
const CHROME_SUPPORT_URL = 'https://support.google.com/chrome/answer/9658361?hl=zh-Hans'

type InstallRequestDetail = { open?: boolean; install?: boolean }

function platformLabel(platform: InstallPlatform) {
  if (platform === 'ios') return 'iPhone / iPad'
  if (platform === 'android') return 'Android'
  if (platform === 'desktop') return '电脑'
  return '当前设备'
}

function platformSummary(platform: InstallPlatform) {
  if (platform === 'ios') return 'Safari 需要通过“共享 → 添加到主屏幕”手动完成。'
  if (platform === 'android') return 'Chrome 通常可以直接安装，也可以从右上角菜单进入“安装应用”。'
  if (platform === 'desktop') return 'Chrome / Edge 可通过地址栏安装图标，或菜单中的“将网页安装为应用”。'
  return '支持安装的浏览器通常会在地址栏或浏览器菜单提供“安装应用 / 添加到主屏幕”。'
}

function GuideVisual({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <div className="pwa-guide-visual-fallback" role="img" aria-label={alt}><Download size={32}/><span>图片暂时加载失败，请按文字步骤操作。</span></div>
  return <img className="pwa-guide-visual" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
}

function PlatformIcon() {
  return <span className="pwa-guide-platform-icon" aria-hidden="true"><Download size={17}/></span>
}

export function PwaInstallGuideContent({ platform = installPlatform(), compact = false }: { platform?: InstallPlatform; compact?: boolean }) {
  const standalone = isStandaloneMode()
  const iosSafari = platform !== 'ios' || isIosSafari()

  if (standalone) {
    return <div className="pwa-installed-state"><CheckCircle2 size={22}/><div><strong>已经是应用模式</strong><p>你现在就是从主屏幕 / 已安装应用打开的，不需要再次安装。</p></div></div>
  }

  return <div className={`pwa-guide-content ${compact ? 'is-compact' : ''}`}>
    <div className="pwa-guide-current">
      <span>{platformLabel(platform)}</span>
      <strong>{platformSummary(platform)}</strong>
      {platform === 'ios' && !iosSafari && <p>当前不是 Safari。iPhone / iPad 建议复制网址到 Safari 后再按下面步骤操作。</p>}
    </div>

    <div className="pwa-guide-platforms">
      <article className={`pwa-guide-platform ${platform === 'ios' ? 'is-current' : ''}`}>
        <div className="pwa-guide-platform-title"><PlatformIcon/><div><strong>iPhone / iPad</strong><span>Safari</span></div></div>
        <ol>
          <li><b>1</b><span>用 Safari 打开学习计划网站。</span></li>
          <li><b>2</b><span>点浏览器的“共享”按钮，再向下找到“添加到主屏幕”。</span></li>
          <li><b>3</b><span>如有“作为网页 App 打开”，保持开启，然后点“添加”。</span></li>
        </ol>
        {!compact && <GuideVisual src={IOS_GUIDE_IMAGE} alt="iPhone Safari 简体中文界面的添加到主屏幕操作示意图"/>}
        <small className="pwa-guide-image-note">不同 iOS 版本的按钮位置可能略有差异，以“共享 → 添加到主屏幕”为准。</small>
        <a href={APPLE_SUPPORT_URL} target="_blank" rel="noreferrer">Apple 官方说明<ArrowUpRight size={13}/></a>
      </article>

      <article className={`pwa-guide-platform ${platform === 'android' ? 'is-current' : ''}`}>
        <div className="pwa-guide-platform-title"><PlatformIcon/><div><strong>Android</strong><span>Chrome</span></div></div>
        <ol>
          <li><b>1</b><span>用 Chrome 打开学习计划网站。</span></li>
          <li><b>2</b><span>点右上角“⋮”菜单，选择“安装应用”或“添加到主屏幕”。</span></li>
          <li><b>3</b><span>在系统安装框中确认“安装”。</span></li>
        </ol>
        {!compact && <GuideVisual src={ANDROID_GUIDE_IMAGE} alt="Android Chrome 简体中文界面的添加到主屏幕操作示意图"/>}
        <a href={CHROME_SUPPORT_URL} target="_blank" rel="noreferrer">Chrome 官方说明<ArrowUpRight size={13}/></a>
      </article>

      <article className={`pwa-guide-platform ${platform === 'desktop' ? 'is-current' : ''}`}>
        <div className="pwa-guide-platform-title"><PlatformIcon/><div><strong>Windows / Mac</strong><span>Chrome / Edge</span></div></div>
        <ol>
          <li><b>1</b><span>打开学习计划网站，查看地址栏右侧是否出现安装图标。</span></li>
          <li><b>2</b><span>没有图标时，打开浏览器菜单，选择“将网页安装为应用 / 安装应用”。</span></li>
          <li><b>3</b><span>确认安装后，可以从桌面、Dock 或开始菜单直接打开。</span></li>
        </ol>
        {!compact && <GuideVisual src={DESKTOP_GUIDE_IMAGE} alt="Chrome 桌面端简体中文界面的将网页作为应用安装操作示意图"/>}
        <a href={CHROME_SUPPORT_URL} target="_blank" rel="noreferrer">Chrome 官方说明<ArrowUpRight size={13}/></a>
      </article>
    </div>
  </div>
}

export function PwaInstallGuideSection() {
  const platform = useMemo(() => installPlatform(), [])
  return <section className="guide-section pwa-guide-section" id="install-app">
    <div className="guide-section-heading"><div><span className="guide-eyebrow">更像 App 一样使用</span><h3>添加到主屏幕</h3><p>如果你经常用学习计划，建议安装到主屏幕。以后可以直接点图标打开，不用每次从浏览器标签页里找。</p></div></div>
    <PwaInstallGuideContent platform={platform}/>
  </section>
}

export function PwaInstallPrompt() {
  const [visible, setVisible] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent>()
  const deferredPromptRef = useRef<BeforeInstallPromptEvent>()
  const [installing, setInstalling] = useState(false)
  const [platform] = useState<InstallPlatform>(() => installPlatform())

  useEffect(() => {
    if (isStandaloneMode()) return
    const visitCount = recordBrowserVisit()
    const timers = new Set<number>()
    let interactionTimer: number | undefined

    const schedule = (callback: () => void, delay: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        callback()
      }, delay)
      timers.add(id)
      return id
    }

    const busyWithAnotherFlow = () => Boolean(document.querySelector(
      '.guide-page, .tutorial-coachmark, .tutorial-offer-copy, .modal-backdrop, .drawer-backdrop, .pwa-guide-modal-backdrop'
    ))

    const showIfUseful = () => {
      if (!shouldAutoOfferInstall(visitCount) || busyWithAnotherFlow()) return
      setVisible(true)
    }

    const showGuideAfterTutorial = (attempt = 0) => {
      if (!shouldAutoOfferInstall(visitCount)) return
      if (busyWithAnotherFlow()) {
        if (attempt < 8) schedule(() => showGuideAfterTutorial(attempt + 1), 350)
        return
      }
      setVisible(false)
      setGuideOpen(true)
    }

    // 首次访问也应有机会看到安装提示，但先留足时间给注册、首次建档或教程选择。
    schedule(showIfUseful, 6500)

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : undefined
      const button = target?.closest('button')
      const finishingTutorial = Boolean(button?.closest('.tutorial-coachmark') && button.textContent?.trim() === '开始我的计划')
      if (finishingTutorial) {
        // 完整互动教程结束后直接接图文 PWA 教程，而不是再等下一次访问。
        schedule(() => showGuideAfterTutorial(), 700)
        return
      }
      if (interactionTimer !== undefined) {
        window.clearTimeout(interactionTimer)
        timers.delete(interactionTimer)
      }
      // 新用户关闭首次引导、直接开始空白计划等场景，在原弹窗真正消失后再轻提示。
      interactionTimer = schedule(showIfUseful, 1000)
    }

    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      const prompt = event as BeforeInstallPromptEvent
      deferredPromptRef.current = prompt
      setDeferredPrompt(prompt)
    }
    const onInstalled = () => {
      deferredPromptRef.current = undefined
      setVisible(false)
      setGuideOpen(false)
      setDeferredPrompt(undefined)
    }
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<InstallRequestDetail>).detail
      setVisible(false)
      const prompt = deferredPromptRef.current
      if (detail?.install && prompt) {
        void runNativeInstall(prompt, setInstalling, next => {
          deferredPromptRef.current = next
          setDeferredPrompt(next)
        }, setGuideOpen)
      } else {
        setGuideOpen(true)
      }
    }

    document.addEventListener('click', onDocumentClick, true)
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener(PWA_INSTALL_EVENT, onRequest)
    return () => {
      timers.forEach(id => window.clearTimeout(id))
      document.removeEventListener('click', onDocumentClick, true)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener(PWA_INSTALL_EVENT, onRequest)
    }
  }, [])

  if (isStandaloneMode()) return null

  const updateDeferredPrompt = (next: BeforeInstallPromptEvent | undefined) => {
    deferredPromptRef.current = next
    setDeferredPrompt(next)
  }

  const install = async () => {
    const prompt = deferredPromptRef.current ?? deferredPrompt
    if (!prompt) { setVisible(false); setGuideOpen(true); return }
    await runNativeInstall(prompt, setInstalling, updateDeferredPrompt, setGuideOpen)
    setVisible(false)
  }

  const later = () => {
    snoozeInstallPrompt()
    setVisible(false)
  }

  const never = () => {
    neverShowInstallPrompt()
    setVisible(false)
    setGuideOpen(false)
  }

  return <>
    {visible && <aside className="pwa-install-nudge" role="status" aria-live="polite">
      <button type="button" className="pwa-install-close" aria-label="关闭安装提示" onClick={later}><X size={17}/></button>
      <div className="pwa-install-nudge-icon"><Download size={20}/></div>
      <div className="pwa-install-nudge-copy"><strong>添加到主屏幕，打开更方便</strong><p>{platformSummary(platform)}</p></div>
      <div className="pwa-install-nudge-actions">
        <button type="button" className="primary-button" disabled={installing} onClick={() => void install()}>{installing ? '正在打开…' : deferredPrompt ? '直接安装' : '查看安装方法'}</button>
        <button type="button" className="text-button" onClick={later}>7 天后提醒</button>
        <button type="button" className="text-button pwa-install-never" onClick={never}>不再提醒</button>
      </div>
    </aside>}

    {guideOpen && <div className="pwa-guide-modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setGuideOpen(false) }}>
      <section className="pwa-guide-modal" role="dialog" aria-modal="true" aria-label="添加到主屏幕教程">
        <div className="pwa-guide-modal-head"><div><span>安装学习计划</span><strong>把网站放到主屏幕 / 桌面</strong></div><button type="button" aria-label="关闭安装教程" onClick={() => setGuideOpen(false)}><X size={19}/></button></div>
        <PwaInstallGuideContent platform={platform}/>
        <div className="pwa-guide-modal-actions">
          {deferredPrompt && <button type="button" className="primary-button" disabled={installing} onClick={() => void install()}><Download size={15}/>{installing ? '正在打开…' : '直接安装'}</button>}
          <button type="button" className="secondary-button" onClick={() => setGuideOpen(false)}>我知道了</button>
        </div>
      </section>
    </div>}
  </>
}

async function runNativeInstall(
  prompt: BeforeInstallPromptEvent,
  setInstalling: (value: boolean) => void,
  setDeferredPrompt: (value: BeforeInstallPromptEvent | undefined) => void,
  setGuideOpen: (value: boolean) => void,
) {
  setInstalling(true)
  try {
    await prompt.prompt()
    const choice = await prompt.userChoice
    setDeferredPrompt(undefined)
    if (choice.outcome === 'accepted') setGuideOpen(false)
    else snoozeInstallPrompt()
  } catch {
    setGuideOpen(true)
  } finally {
    setInstalling(false)
  }
}
