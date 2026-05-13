// plume/app/vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'

export default defineConfig({
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
  ],
})