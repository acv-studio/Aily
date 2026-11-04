import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { target: ['safari16.4', 'chrome111'] },
  server: {
    proxy: {
      '/api/magpie': {
        target: 'http://127.0.0.1:3425',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/magpie/, ''),
      },
    },
  },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
})
