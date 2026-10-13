import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Playground root is this folder; it imports the adapter source (../src) and the
// generated client (../gen/ts), so allow serving files from the repo root.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    fs: { allow: ['..'] },
  },
  optimizeDeps: {
    // vrf ships as a prebuilt CommonJS bundle.
    include: ['vrf'],
  },
})
