import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: '学习计划',
        short_name: '学习计划',
        description: '可动态调整、记录实际用时的个人学习计划工具',
        theme_color: '#f6f8fb',
        background_color: '#f6f8fb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        // 管理后台由独立私有服务响应，不能被 SPA 的 navigation fallback
        // 接管，否则已安装的 Service Worker 会把 /mg 错误返回为主站 index.html。
        navigateFallbackDenylist: [/^\/mg(?:\/|$)/],
        // Guide screenshots are loaded on demand; keeping them out of the
        // first offline cache prevents a tutorial image from dominating PWA startup.
        globPatterns: ['**/*.{js,css,html,svg,ico}']
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('recharts')) return 'charts'
          if (id.includes('date-fns')) return 'date-fns'
          if (id.includes('lucide-react')) return 'icons'
          return 'vendor'
        }
      }
    }
  }
})
