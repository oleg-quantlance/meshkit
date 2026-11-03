import { defineConfig } from 'vite';

const r = (file: string) => new URL(file, import.meta.url).pathname;

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: r('./index.html'),
        costCalculator: r('./3d-print-cost-calculator.html'),
        stlRepair: r('./stl-repair-online.html'),
        stlVolume: r('./stl-volume-weight-calculator.html'),
        stepToStl: r('./step-to-stl-converter.html'),
        resinCalculator: r('./resin-3d-print-cost-calculator.html'),
        spoolCalculator: r('./filament-spool-weight-calculator.html'),
        spoolDatabase: r('./empty-spool-weight-database.html'),
        gramsToMeters: r('./filament-grams-to-meters.html'),
        notFound: r('./404.html'),
      },
    },
  },
});
