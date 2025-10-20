// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],

  // outDir is inside /public; do NOT copy /public into itself
  publicDir: false,

  build: {
    emptyOutDir: false,
    outDir: 'public/js/bundles',
    lib: {
      entry: path.resolve(__dirname, 'frontend/entry.jsx'),
      formats: ['iife'],
      name: 'GKEntry',
      fileName: () => 'entry.js',
    },
  },

  // IMPORTANT: remove all runtime `process`/`global` usage by inlining constants
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'global': 'window',
  },
})
