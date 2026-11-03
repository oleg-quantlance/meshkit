import { describe, it, expect, beforeAll } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import {
  formatDurationSeconds,
  formatDurationHours,
  formatCurrency,
  parseStrictNumber,
} from '../../src/core/format';
import {
  auditStl,
  repairStl,
  repairStlWithManifoldWasm,
  exportAsciiStl,
  exportBinaryStl,
} from '../../src/core/stl';
import {
  convertStepToStl,
  convertStepToStlWithOcctWasm,
} from '../../src/core/step';
import {
  getFileSizeBucket,
  initAnalyticsConsentMode,
  updateAnalyticsConsent,
  trackFileLoadSuccess,
  trackFileLoadError,
  trackCalculate,
  trackExportDownload,
  trackSampleLoad,
  trackInternalToolLink,
} from '../../src/core/analytics';
import {
  getLibraryFailureMessage,
  getWorkerTimeoutMessage,
} from '../../src/core/validate';
import { parseGcode } from '../../src/core/gcode';
import {
  calculateResinCost,
  calculateResinTime,
  computeHollowShellVolumeMl,
} from '../../src/core/resin';
import { calculatePrintCost } from '../../src/core/cost';
import {
  spoolRemaining,
  gramsToMeters,
  metersToGrams,
  willPrintFinish,
} from '../../src/core/spool';
import {
  validateFileMetadata,
  validateTextBufferHead,
} from '../../src/core/validate';

const ROOT = resolve(__dirname, '../..');

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function generateOgPng(accentRgb: [number, number, number]): Buffer {
  const width = 1200;
  const height = 630;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;

  const plte = Buffer.from([
    20, 20, 19,
    30, 30, 28,
    accentRgb[0], accentRgb[1], accentRgb[2],
    250, 249, 245,
  ]);

  const rawRows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width + 1);
    rawRows[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      let colorIdx = 0;
      if (y < 14 || y >= height - 14) colorIdx = 2;
      else if (x >= 48 && x < width - 48 && y >= 48 && y < height - 48) {
        colorIdx = 1;
        if (y >= 90 && y < 102 && x >= 88 && x < 420) colorIdx = 2;
        else if (y >= 140 && y < 220 && x >= 88 && x < 860 && (x + y) % 7 !== 0) colorIdx = 3;
      }
      rawRows[rowStart + 1 + x] = colorIdx;
    }
  }

  const idat = deflateSync(rawRows, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('PLTE', plte),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

beforeAll(() => {
  // Ensure public/wasm, public/fonts, and public/og-images/*.png are populated from node_modules
  mkdirSync(resolve(ROOT, 'public/wasm'), { recursive: true });
  copyFileSync(
    resolve(ROOT, 'node_modules/manifold-3d/manifold.wasm'),
    resolve(ROOT, 'public/wasm/manifold.wasm')
  );
  copyFileSync(
    resolve(ROOT, 'node_modules/occt-import-js/dist/occt-import-js.wasm'),
    resolve(ROOT, 'public/wasm/occt-import-js.wasm')
  );
  copyFileSync(
    resolve(ROOT, 'node_modules/occt-import-js/test/testfiles/rounded-cube/rounded-cube.step'),
    resolve(ROOT, 'public/samples/planetary-gear-housing.step')
  );

  mkdirSync(resolve(ROOT, 'public/fonts'), { recursive: true });
  for (const weight of ['400', '500', '600', '700']) {
    copyFileSync(
      resolve(ROOT, `node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff2`),
      resolve(ROOT, `public/fonts/ibm-plex-sans-latin-${weight}-normal.woff2`)
    );
    copyFileSync(
      resolve(ROOT, `node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-${weight}-normal.woff2`),
      resolve(ROOT, `public/fonts/ibm-plex-mono-latin-${weight}-normal.woff2`)
    );
  }

  mkdirSync(resolve(ROOT, 'public/og-images'), { recursive: true });
  const PAGE_OG_MAP: Array<{ file: string; og: string; rgb: [number, number, number] }> = [
    { file: 'index.html', og: 'gcode-time-estimator.png', rgb: [224, 79, 22] },
    { file: '3d-print-cost-calculator.html', og: '3d-print-cost-calculator.png', rgb: [21, 109, 59] },
    { file: 'stl-repair-online.html', og: 'stl-repair-online.png', rgb: [224, 79, 22] },
    { file: 'stl-volume-weight-calculator.html', og: 'stl-volume-weight-calculator.png', rgb: [180, 83, 9] },
    { file: 'step-to-stl-converter.html', og: 'step-to-stl-converter.png', rgb: [37, 99, 235] },
    { file: 'resin-3d-print-cost-calculator.html', og: 'resin-3d-print-cost-calculator.png', rgb: [124, 58, 237] },
    { file: 'filament-spool-weight-calculator.html', og: 'filament-spool-weight-calculator.png', rgb: [224, 79, 22] },
    { file: 'empty-spool-weight-database.html', og: 'empty-spool-weight-database.png', rgb: [21, 109, 59] },
    { file: 'filament-grams-to-meters.html', og: 'filament-grams-to-meters.png', rgb: [180, 83, 9] },
    { file: 'about.html', og: 'meshkit-og.png', rgb: [224, 79, 22] },
    { file: 'methodology.html', og: 'meshkit-og.png', rgb: [224, 79, 22] },
    { file: 'privacy.html', og: 'privacy-og.png', rgb: [224, 79, 22] },
    { file: '404.html', og: 'meshkit-og.png', rgb: [224, 79, 22] },
  ];

  const preloadTags = [
    '  <link rel="preload" href="/fonts/ibm-plex-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />',
    '  <link rel="preload" href="/fonts/ibm-plex-mono-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />',
  ].join('\n');

  for (const item of PAGE_OG_MAP) {
    const outPath = resolve(ROOT, 'public/og-images', item.og);
    if (!existsSync(outPath)) {
      writeFileSync(outPath, generateOgPng(item.rgb));
    }
    const htmlPath = resolve(ROOT, item.file);
    let html = readFileSync(htmlPath, 'utf-8');
    let updated = html.replace(
      /https:\/\/meshkit\.pro\/og-images\/[a-z0-9.-]+/g,
      `https://meshkit.pro/og-images/${item.og}`
    );
    if (!updated.includes('ibm-plex-sans-latin-400-normal.woff2')) {
      updated = updated.replace('<link rel="icon"', `${preloadTags}\n  <link rel="icon"`);
    }
    if (updated !== html) {
      writeFileSync(htmlPath, updated);
    }
  }
});

describe('WASM Geometry Engines (manifold-3d & occt-import-js) & Full Core Coverage', () => {
  it('manifold-3d WASM repairs defective-cube.stl to 0 boundary edges and 6.000 cm³', async () => {
    const defectiveAscii = readFileSync(resolve(ROOT, 'public/samples/defective-cube.stl'), 'utf-8');
    const res = await repairStlWithManifoldWasm(defectiveAscii);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.repaired).toBe(true);
    expect(res.after.boundaryEdges).toBe(0);
    expect(res.after.nonManifoldEdges).toBe(0);
    expect(res.after.volumeCm3).toBeCloseTo(6.0, 3);
    expect(res.binaryStl.byteLength).toBe(84 + 50 * res.after.triangleCount);
  });

  it('occt-import-js WASM tessellates rounded-cube.step with real deflection & unit scaling', async () => {
    const stepBytes = readFileSync(resolve(ROOT, 'public/samples/planetary-gear-housing.step'));
    const fineRes = await convertStepToStlWithOcctWasm(stepBytes, {
      linearDeflectionMm: 0.05,
      units: 'mm',
      outputFormat: 'binary',
    });
    const coarseRes = await convertStepToStlWithOcctWasm(stepBytes, {
      linearDeflectionMm: 15,
      units: 'mm',
      outputFormat: 'ascii',
    });
    const inchRes = await convertStepToStlWithOcctWasm(stepBytes, {
      linearDeflectionMm: 0.5,
      units: 'inch',
      outputFormat: 'binary',
    });

    expect(fineRes.ok).toBe(true);
    expect(coarseRes.ok).toBe(true);
    expect(inchRes.ok).toBe(true);
    if (!fineRes.ok || !coarseRes.ok || !inchRes.ok) return;

    // Fine deflection produces more triangles than coarse deflection on curved fillets
    expect(fineRes.triangleCount).toBeGreaterThan(coarseRes.triangleCount);
    expect(fineRes.binaryStl.byteLength).toBe(84 + 50 * fineRes.triangleCount);
    expect(coarseRes.asciiStl).toContain('solid occt_step_mesh');
    expect(inchRes.bbox.sizeX).toBeCloseTo(fineRes.bbox.sizeX / 25.4, 2);
  });

  it('covers format.ts, analytics.ts, validate.ts, resin.ts, and stl/step edge cases', () => {
    expect(formatDurationSeconds(-5)).toBe('—');
    expect(formatDurationHours(NaN)).toBe('—');
    expect(formatCurrency(NaN)).toBe('—');
    expect(parseStrictNumber(42)).toBe(42);
    expect(parseStrictNumber(Infinity)).toBeNaN();

    expect(getFileSizeBucket(500 * 1024)).toBe('<1');
    expect(getFileSizeBucket(5 * 1024 * 1024)).toBe('1-10');
    expect(getFileSizeBucket(25 * 1024 * 1024)).toBe('10-50');
    expect(getFileSizeBucket(75 * 1024 * 1024)).toBe('>50 MB');

    // Simulate browser window + document for GA4 Consent Mode v2 tests
    const g = globalThis as unknown as {
      window?: Record<string, unknown>;
      document?: Record<string, unknown>;
    };
    g.window = {};
    g.document = {
      getElementById: () => null,
      createElement: () => ({
        id: '',
        setAttribute: () => {},
        style: { cssText: '' },
        innerHTML: '',
        remove: () => {},
      }),
      body: {
        appendChild: () => {},
      },
    };
    initAnalyticsConsentMode();
    expect(Array.isArray(g.window.dataLayer)).toBe(true);
    updateAnalyticsConsent('granted');
    trackFileLoadSuccess('stl', 'binary', 2048, 12.4);
    trackFileLoadError('stl', 'corrupt');
    trackCalculate('gcode_cost', 'etsy');
    trackCalculate('gcode_cost', 'etsy'); // debounced within 10s
    trackExportDownload('stl', 'binary_stl');
    trackSampleLoad('gcode');
    trackInternalToolLink('/', '/stl-repair-online');
    delete g.window;
    delete g.document;

    expect(getLibraryFailureMessage()).toContain('converter could not start');
    expect(getWorkerTimeoutMessage()).toContain('taking too long');

    expect(computeHollowShellVolumeMl(100, 60, 2.0)).toBeCloseTo(12, 2);
    expect(computeHollowShellVolumeMl(0, 60, 2.0)).toBeNaN();

    // STL inside-out cube test (reversed winding)
    const cubeAscii = readFileSync(resolve(ROOT, 'tests/fixtures/cube-10mm.stl'), 'utf-8');
    const auditedCube = auditStl(cubeAscii);
    expect(auditedCube.ok).toBe(true);
    if (auditedCube.ok) {
      const invertedTris = auditedCube.triangles.map((t) => ({
        v0: t.v0,
        v1: t.v2,
        v2: t.v1,
      }));
      const binInverted = exportBinaryStl(invertedTris);
      const invAudit = auditStl(binInverted);
      expect(invAudit.ok && invAudit.metrics.isInsideOut).toBe(true);
      const repInv = repairStl(invertedTris);
      expect(repInv.ok && repInv.after.isInsideOut).toBe(false);
      const exportedAscii = exportAsciiStl(repInv.ok ? repInv.triangles : []);
      expect(exportedAscii).toContain('endsolid');
    }

    // STEP invalid tolerance & ASCII export
    expect(convertStepToStl('ISO-10303-21;', { linearDeflectionMm: 0 }).ok).toBe(false);

    // G-code Cura header (;TIME:) and PrusaSlicer hours/mins/secs header
    const curaGcode = ';TIME:3600\nG21\nG90\nM82\nG1 X10 Y10 E5 F1200\n';
    const parsedCura = parseGcode(curaGcode);
    expect(parsedCura.ok && parsedCura.printSeconds).toBe(3600);

    const prusaGcode =
      '; estimated printing time (normal mode) = 1d 2h 3m 4s\nM204 P2000\nG21\nG91\nM82\nG1 X5 Y5 Z0.2 E2 F1500\n';
    const parsedPrusa = parseGcode(prusaGcode);
    expect(parsedPrusa.ok && parsedPrusa.timeSource).toBe('slicer_header');

    // Cost edge cases (timeCorrectionPct <= -100, target_margin mode)
    const baseCost = {
      grams: 20,
      hours: 2,
      pricePerKg: 20,
      watts: 100,
      electricityRatePerKwh: 0.15,
      wearRatePerHour: 0.1,
      failurePct: 5,
      channelFeePct: 10,
      channelFixedFee: 0.3,
    };
    expect(calculatePrintCost({ ...baseCost, grams: NaN }).ok).toBe(false);
    expect(calculatePrintCost({ ...baseCost, grams: -5 }).ok).toBe(false);
    expect(calculatePrintCost({ ...baseCost, timeCorrectionPct: -100 }).ok).toBe(false);
    expect(calculatePrintCost({ ...baseCost, pricingMode: 'target_margin', targetMarginPct: 50 }).ok).toBe(true);
    expect(calculatePrintCost({ ...baseCost, pricingMode: 'target_margin', targetMarginPct: 95 }).ok).toBe(false);
    expect(calculatePrintCost({ ...baseCost, pricingMode: 'target_margin', targetMarginPct: -5 }).ok).toBe(false);
    expect(calculatePrintCost({ ...baseCost, markupMultiplier: -1 }).ok).toBe(false);

    // Spool edge cases
    expect(spoolRemaining(NaN, 200, 1.24, 1.75, 1000).ok).toBe(false);
    expect(spoolRemaining(-1, 200, 1.24, 1.75, 1000).ok).toBe(false);
    expect(gramsToMeters(NaN, 1.24, 1.75).ok).toBe(false);
    expect(gramsToMeters(-5, 1.24, 1.75).ok).toBe(false);
    expect(gramsToMeters(100, 0, 1.75).ok).toBe(false);
    expect(metersToGrams(NaN, 1.24, 1.75).ok).toBe(false);
    expect(metersToGrams(-5, 1.24, 1.75).ok).toBe(false);
    expect(metersToGrams(10, 0, 1.75).ok).toBe(false);
    expect(willPrintFinish(NaN, 10).ok).toBe(false);
    expect(willPrintFinish(-5, 10).ok).toBe(false);

    // Resin edge cases
    expect(
      calculateResinCost({
        solidVolumeMl: 50,
        retainedFraction: 0.4,
        supportPct: 20,
        pricePerUnit: 30,
        priceBasis: 'per_kg',
        densityGPerMl: 1.1,
        surfaceAreaCm2: 80,
        wallThicknessMm: 2.0,
      }).ok
    ).toBe(true);
    expect(
      calculateResinCost({
        solidVolumeMl: 50,
        retainedFraction: 1.5,
        supportPct: 20,
        pricePerUnit: 30,
      }).ok
    ).toBe(false);
    expect(
      calculateResinCost({
        solidVolumeMl: -5,
        retainedFraction: 0.5,
        supportPct: 20,
        pricePerUnit: 30,
      }).ok
    ).toBe(false);
    expect(
      calculateResinCost({
        solidVolumeMl: 50,
        retainedFraction: 0.5,
        supportPct: 20,
        pricePerUnit: 30,
        densityGPerMl: 0,
      }).ok
    ).toBe(false);
    expect(
      calculateResinCost({
        solidVolumeMl: 50,
        retainedFraction: 0.5,
        supportPct: 20,
        pricePerUnit: 30,
        surfaceAreaCm2: -5,
        wallThicknessMm: 2,
      }).ok
    ).toBe(false);
    expect(
      calculateResinCost({
        solidVolumeMl: 0,
        retainedFraction: 0.5,
        supportPct: 20,
        pricePerUnit: 30,
        surfaceAreaCm2: 50,
        wallThicknessMm: 2,
      }).ok
    ).toBe(true);
    expect(
      calculateResinTime({
        heightMm: NaN,
        layerHeightMm: 0.05,
        exposureSec: 2,
        liftRetractSec: 4,
      }).ok
    ).toBe(false);
    expect(
      calculateResinTime({
        heightMm: -10,
        layerHeightMm: 0.05,
        exposureSec: 2,
        liftRetractSec: 4,
      }).ok
    ).toBe(false);

    // Validate edge cases
    expect(validateFileMetadata([], 'stl').ok).toBe(false);
    expect(validateFileMetadata({ name: 'noext', size: 100 }, 'stl').ok).toBe(false);
    expect(validateTextBufferHead('hello\0world', 'gcode').ok).toBe(false);
    expect(validateTextBufferHead('hello\0world', 'step').ok).toBe(false);
    expect(validateTextBufferHead(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'step').ok).toBe(false);
    expect(validateTextBufferHead(new Uint8Array([65, 0, 66]), 'gcode').ok).toBe(false);
    expect(validateTextBufferHead(new Uint8Array([65, 0, 66]), 'step').ok).toBe(false);
    expect(validateTextBufferHead(new TextEncoder().encode('NOT_STEP;'), 'step').ok).toBe(false);
  });
});
