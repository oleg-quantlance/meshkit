import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Builds one embeddable widget as a single-file IIFE with a stable name
 * (third-party sites hot-link it). Vite's lib mode allows one IIFE entry per
 * build, so `npm run build:embed` runs this once per widget via EMBED_ENTRY.
 * Output lands in dist/embed/ next to the main multi-page build.
 */
const ENTRIES: Record<string, string> = {
  'print-cost': 'src/embed/print-cost.ts',
  'spool-left': 'src/embed/spool-left.ts',
};
const name = process.env.EMBED_ENTRY ?? 'print-cost';
if (!ENTRIES[name]) throw new Error(`Unknown EMBED_ENTRY ${name}`);

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/embed',
    emptyOutDir: false,
    target: 'es2018',
    minify: 'esbuild',
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, ENTRIES[name]),
      name: 'MeshKitEmbed',
      formats: ['iife'],
      fileName: () => `${name}.js`,
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
