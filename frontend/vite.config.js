import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        main:     resolve(__dirname, 'index.html'),
        admin:    resolve(__dirname, 'admin.html'),
        launcher: resolve(__dirname, 'launcher.html'),
        cabin360: resolve(__dirname, 'cabin360.html'),
      },
    },
  },
})
