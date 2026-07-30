import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg'],
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
                globPatterns: ['**/*.{js,css,html,svg,png,ico}']
            }
        })
    ]
});
