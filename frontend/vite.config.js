import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // In development the app calls /api/v1/... on its own origin and Vite forwards it to the backend (so no CORS setup is needed while developing).
  const target = env.DEV_API_TARGET || 'http://127.0.0.1:8000'
  return {
    plugins: [react()],
    server: { proxy: { '/api': { target, changeOrigin: true } } },
    preview: { proxy: { '/api': { target, changeOrigin: true } } }, // `vite preview` serves the production build the same way
    build: {
      rolldownOptions: {
        output: {
          // Every screen is a lazy chunk (see src/routes/lazyPage.js). The libraries they share are grouped by how often they change, so a deploy of the app's own code
          // does not make the browser download React, the charts or the PDF tooling again.
          codeSplitting: {
            groups: [
              { name: 'react-vendor', test: /node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler|clsx|axios|react-hook-form)[\/]/, priority: 40 },
              { name: 'charts', test: /node_modules[\/](recharts|d3-[^\/]+|victory-vendor|internmap|decimal\.js-light|es-toolkit)[\/]/, priority: 30 },
              { name: 'motion', test: /node_modules[\/](framer-motion|motion-dom|motion-utils)[\/]/, priority: 30 },
              { name: 'pdf-tools', test: /node_modules[\/](pdf-lib|pdfjs-dist|mammoth|jszip|@pdf-lib)[\/]/, priority: 30 },
            ],
          },
        },
      },
    },
  }
})
