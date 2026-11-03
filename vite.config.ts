import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        costCalculator: resolve(__dirname, '3d-print-cost-calculator.html'),
        stlRepair: resolve(__dirname, 'stl-repair-online.html'),
        stlVolumeWeight: resolve(__dirname, 'stl-volume-weight-calculator.html'),
        stepToStl: resolve(__dirname, 'step-to-stl-converter.html'),
        resinCalculator: resolve(__dirname, 'resin-3d-print-cost-calculator.html'),
        spoolCalculator: resolve(__dirname, 'filament-spool-weight-calculator.html'),
        spoolDatabase: resolve(__dirname, 'empty-spool-weight-database.html'),
        gramsToMeters: resolve(__dirname, 'filament-grams-to-meters.html'),
        about: resolve(__dirname, 'about.html'),
        methodology: resolve(__dirname, 'methodology.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        notFound: resolve(__dirname, '404.html'),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      thresholds: {
        lines: 90,
      },
    },
  },
});
