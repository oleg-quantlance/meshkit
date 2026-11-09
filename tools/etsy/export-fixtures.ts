/**
 * Exports golden cases from MeshKit's print-cost engine for the Etsy
 * spreadsheet parity check (tools/etsy/build_pricing.py --verify).
 *
 * Run from the repo root:
 *   npx vite-node tools/etsy/export-fixtures.ts
 *
 * Writes tools/etsy/fixtures/<case>.json with the engine inputs and result.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculatePrintCost, type PrintCostInput } from '../../src/core/cost.ts';

const OUT = resolve(process.cwd(), 'tools', 'etsy', 'fixtures');

const base = {
  grams: 48.5,
  hours: 3.7,
  pricePerKg: 22,
  watts: 150,
  electricityRatePerKwh: 0.16,
  wearRatePerHour: 0.15,
  failurePct: 7,
};

const CASES: Record<string, PrintCostInput> = {
  // Golden vector C1 from tests/unit/cost.test.ts: 3.5x markup, Etsy 9.5% + $0.45.
  'multiplier-etsy': {
    ...base,
    channelFeePct: 9.5,
    channelFixedFee: 0.45,
    pricingMode: 'multiplier',
    markupMultiplier: 3.5,
  },
  // Same costs, priced for a 50% margin after Etsy fees.
  'target-margin-etsy': {
    ...base,
    channelFeePct: 9.5,
    channelFixedFee: 0.45,
    pricingMode: 'target_margin',
    targetMarginPct: 50,
  },
  // Direct sale (no fees), slicer time corrected +12%, 3x markup.
  'multiplier-direct-timecorr': {
    ...base,
    grams: 120,
    hours: 6.25,
    pricePerKg: 26,
    channelFeePct: 0,
    channelFixedFee: 0,
    pricingMode: 'multiplier',
    markupMultiplier: 3,
    timeCorrectionPct: 12,
  },
  // Target margin 40% on Shopify (2.9% + $0.30), bigger printer, no failure buffer.
  'target-margin-shopify': {
    grams: 310,
    hours: 14.5,
    pricePerKg: 19.99,
    watts: 350,
    electricityRatePerKwh: 0.21,
    wearRatePerHour: 0.3,
    failurePct: 0,
    channelFeePct: 2.9,
    channelFixedFee: 0.3,
    pricingMode: 'target_margin',
    targetMarginPct: 40,
  },
};

mkdirSync(OUT, { recursive: true });
for (const [name, input] of Object.entries(CASES)) {
  const result = calculatePrintCost(input);
  if (!result.ok) {
    throw new Error(`${name}: engine rejected input: ${result.error}`);
  }
  const payload = { case: name, input, result };
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(payload, null, 2) + '\n');
  console.log(
    `${name}: unitCost=${result.unitCost.toFixed(4)} price=${result.sellingPrice.toFixed(4)} ` +
      `fees=${result.channelFees.toFixed(4)} profit=${result.profit.toFixed(4)} margin=${result.marginPct}`,
  );
}
