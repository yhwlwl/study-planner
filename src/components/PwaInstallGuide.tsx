import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, ExternalLink, Laptop, MoreHorizontal, Share2, Smartphone, X } from 'lucide-react'
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

const IOS_GUIDE_IMAGE = 'https://content.antistatique.net/app/uploads/2023/07/IOSPWAINSTALL-1.jpg'
const ANDROID_GUIDE_IMAGE = 'https://media.datacamp.com/cms/ad_4nxe49nq6tr5_ztlcs1479onosgbrp7gefrnim_l68opzhvpkrkaqzc_zhvx7gbbdpqjjzpcskoqxntiv27-qpoqdwvnyanssvlgnij1nwohes2ondrc4x36gekqvz9cww_c_my6h2g.png'
const DESKTOP_GUIDE_IMAGE = 'https://nimboard.com/images/pwa-chrome.png'

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
  if (failed) return <div className="pwa-guide-visual-fallback" role="img" aria-label={alt}><Smartphone size={32}/><span>图片暂时加载失败，请按文字步骤操作。</span></div>
  return <img className="pwa-guide-visual" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
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
        <div className="pwa-guide-platform-title"><Smartphone size={18}/><div><strong>iPhone / iPad</strong><span>Safari</span></div></div>
        <ol>
          <li><b>1</b><span>用 Safari 打开学习计划网站。</span></li>
          <li><b>2</b><span>点浏览器的 <Share2 size={14}/>“共享”，向下找到“添加到主屏幕”。</span></li>
          <li><b>3</b><span>如有“作为网页 App 打开”，保持开启，然后点“添加”。</span></li>
        </ol>
        {!compact && <GuideVisual src={IOS_GUIDE_IMAGE} alt="iPhone Safari 添加到主屏幕的操作示意图"/>}
        <a href={APPLE_SUPPORT_URL} target="_blank" rel="noreferrer">Apple 官方说明<ExternalLink size={13}/></a>
      </article>

      <article className={`pwa-guide-platform ${platform === 'android' ? 'is-current' : ''}`}>
        <div className="pwa-guide-platform-title"><Smartphone size={18}/><div><strong>Android</strong><span>Chrome</span></div></div>
        <ol>
          <li><b>1</b><span>用 Chrome 打开学习计划网站。</span></li>
          <li><b>2</b><span>点右上角 <MoreHorizontal size={14}/> 菜单，选择“安装应用”或“添加到主屏幕”。</span></li>
          <li><b>3</b><span>在系统安装框中确认“安装”。</span></li>
        </ol>
        {!compact && <GuideVisual src={ANDROID_GUIDE_IMAGE} alt="Android Chrome 安装网页应用的操作示意图"/>}
        <a href={CHROME_SUPPORT_URL} target="_blank" rel="noreferrer">Chrome 官方说明<ExternalLink size={13}/></a>
      </article>

      <article className={`pwa-guide-platform ${platform === 'desktop' ? 'is-current' : ''}`}>
        <div className="pwa-guide-platform-title"><Laptop size={18}/><div><strong>Windows / Mac</strong><span>Chrome / Edge</span></div></div>
        <ol>
          <li><b>1</b><span>打开学习计划网站，查看地址栏右侧是否出现安装图标。</span></li>
          <li><b>2</b><span>没有图标时，打开浏览器菜单，选择“将网页安装为应用 / 安装应用”。</span></li>
          <li><b>3</b><span>确认安装后，可以从桌面、Dock 或开始菜单直接打开。</span></li>
        </ol>
        {!compact && <GuideVisual src={DESKTOP_GUIDE_IMAGE} alt="Chrome 桌面端安装网页应用的操作示意图"/>}
        <a href={CHROME_SUPPORT_URL} target="_blank" rel="noreferrer">Chrome 官方说明<ExternalLink size={13}/></a>
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
  const [installing, setInstalling] = useState(false)
  const [platform] = useState<InstallPlatform>(() => installPlatform())

  useEffect(() => {
    if (isStandaloneMode()) return
    const visitCount = recordBrowserVisit()
    let timer = 0

    const showIfUseful = () => {
      if (!shouldAutoOfferInstall(visitCount)) return
      if (document.querySelector('.guide-page, .tutorial-coachmark, .tutorial-offer-copy')) return
      setVisible(true)
    }

    timer = window.setTimeout(showIfUseful, 2200)

    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setVisible(false)
      setGuideOpen(false)
      setDeferredPrompt(undefined)
    }
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<InstallRequestDetail>).detail
      setVisible(false)
      if (detail?.install && deferredPrompt) {
        void runNativeInstall(deferredPrompt, setInstalling, setDeferredPrompt, setGuideOpen)
      } else {
        setGuideOpen(true)
      }
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener(PWA_INSTALL_EVENT, onRequest)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener(PWA_INSTALL_EVENT, onRequest)
    }
  }, [deferredPrompt])

  if (isStandaloneMode()) return null

  const install = async () => {
    if (!deferredPrompt) { setVisible(false); setGuideOpen(true); return }
    await runNativeInstall(deferredPrompt, setInstalling, setDeferredPrompt, setGuideOpen)
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
  } catch {
    setGuideOpen(true)
  } finally {
    setInstalling(false)
  }
}
