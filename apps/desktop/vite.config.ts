import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // The ghostty core locates its WASM with `new URL(..., import.meta.url)`.
  // Pre-bundling rewrites that to `.vite/deps`, where the binary is not,
  // so the core throws on load in dev while the production build resolves
  // it correctly. Leaving the package unbundled keeps the one code path
  // working in both.
  optimizeDeps: {
    exclude: ['@wterm/ghostty'],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**', '**/companion/**', '**/website/**'],
    },
  },
}))
