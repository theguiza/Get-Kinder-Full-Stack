import react from '@vitejs/plugin-react'

export default {
  // We don't want Vite to copy a separate "public" dir; Express already serves /public.
  publicDir: false,

  plugins: [react()],

  // Replace at build time so React never hits a real `process` in the browser.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    // Some libs sniff for `global`; map it to window in browser builds.
    global: 'window',
  },

  build: {
    // Library mode → single IIFE file we can <script> on EJS
    lib: {
      entry: 'frontend/entry.jsx',
      name: 'BestieVibes',
      formats: ['iife'],
      fileName: () => 'bestie-vibes.js',
    },

    // ⬇️ Put the bundle in its own folder so it never collides with /public/js/chat.js
    outDir: 'public/js/bundles',
    emptyOutDir: true,          // it’s safe to clean /bundles each build

    rollupOptions: {
      external: [],             // bundle React/etc. into one file (simple drop-in)
    },
  },
}




