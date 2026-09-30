import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

declare const process: { cwd: () => string }

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.BACKEND_PORT || '3001'
  const backendBaseUrl = env.VITE_BACKEND_BASE_URL || `http://localhost:${backendPort}`

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
      proxy: {
        '/api': {
          target: backendBaseUrl,
          changeOrigin: true,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target: backendBaseUrl,
          changeOrigin: true,
        },
      },
    },
  }
})
