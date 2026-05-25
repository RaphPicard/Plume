// plume/app/vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Chemin relatif obligatoire pour fonctionner dans le WebView Capacitor (iOS)
  base: './',
  server: {
    host: '0.0.0.0',
  },
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main.js',
      },
    ]),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Plume',
        short_name: 'Plume',
        description: 'Gestion de flotte de chariots autonomes Plume',
        theme_color: '#0f0f12',
        background_color: '#0f0f12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
})