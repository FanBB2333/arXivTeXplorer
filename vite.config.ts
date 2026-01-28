import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'

import manifest from './src/manifest'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  return {
    // Dev server: allow extension pages to load Vite runtime.
    // Fixes CORS errors like:
    // - Access to script at 'http://localhost:5174/@vite/env' ... blocked by CORS policy
    // which can also break MV3 service worker registration in dev.
    server:
      command === 'serve'
        ? {
            cors: true,
            headers: {
              // For local dev only. Scripts are fetched as module scripts from the extension origin.
              'Access-Control-Allow-Origin': '*',
            },
          }
        : undefined,

    build: {
      emptyOutDir: true,
      outDir: 'build',
      rollupOptions: {
        input: {
          popup: 'popup.html',
          options: 'options.html',
          viewer: 'viewer.html',
        },
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },

    plugins: [crx({ manifest }), react()],

    // Optimize Monaco Editor
    optimizeDeps: {
      include: ['monaco-editor'],
    },
  }
})
