import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
    // Inline next-auth so Vite's resolver (and the 'next/server' alias below)
    // intercepts its extensionless imports instead of Node's ESM resolver,
    // which can't map them under Next 16.
    server: { deps: { inline: ['next-auth', '@auth/core'] } },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // next-auth's env.js imports the extensionless 'next/server', which Node's
      // ESM resolver can't map under Next 16. Point it at the real file so tests
      // can import the Node auth module. Production/Next bundler is unaffected.
      'next/server': resolve(__dirname, './node_modules/next/server.js'),
    },
  },
})
