import react from '@vitejs/plugin-react';

export default {
  publicDir: false,
  plugins: [react()],
  define: {
    // Replace at build time so React never hits a real `process` at runtime
    'process.env.NODE_ENV': JSON.stringify('production'),
    // Some libs look for `global`
    global: 'window',
  },
  build: {
    lib: {
      entry: 'frontend/entry.jsx',
      name: 'BestieVibes',
      formats: ['iife'],
      fileName: () => 'bestie-vibes.js',
    },
    outDir: 'public/js',
    rollupOptions: {
      external: [], // keep React bundled (single file)
    },
  },
};



