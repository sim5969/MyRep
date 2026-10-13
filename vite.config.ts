import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Относительные пути к ресурсам: сборка dist/ работает из любой папки
  // (общий диск P:, подпапка сайта), а не только с корня сервера
  base: './',
  server: {
    port: 5173,
    open: false,
    // Проект может лежать на сетевом диске, где нативный watch недоступен
    watch: { usePolling: true, interval: 500 },
  },
})
