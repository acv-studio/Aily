import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { target: ['safari16.4', 'chrome111'] },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
})
