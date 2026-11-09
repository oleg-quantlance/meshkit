import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Builds the embeddable widgets as single-file IIFE bundles with stable names
 * (no content hash: third-party sites hot-link them). Output goes into
 * dist/embed/ next to the main multi-page build; run after `vite build`.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    target: 'es2018',
    minify: 'esbuild',
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, 'src/embed/print-cost.ts'),
      name: 'MeshKitEmbed',
      formats: ['iife'],
      fileName: () => 'print-cost.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
