import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Tailwind is wired up through PostCSS (see postcss.config.js), NOT through
// @tailwindcss/vite. That plugin is ESM-only, and this config is loaded as CJS
// when package.json has no "type": "module" -- which makes the dev server fail
// with "ESM file cannot be loaded by require" on Node versions that lack
// require(esm) support. PostCSS handles the same transformation, is CJS-safe,
// and is already configured.
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
