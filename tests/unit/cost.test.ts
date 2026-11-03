import { describe, it, expect } from 'vitest';
import { calculatePrintCost } from '../../src/core/cost';
import { formatCurrency, formatDurationHours, parseStrictNumber } from '../../src/core/format';

describe('Cost & Format Golden Vectors (C1–C4) and Input Guards', () => {
  it('C1: G-code cost with Etsy (9.5% + $0.45) and 3.5x markup', () => {
    const r = calculatePrintCost({
      grams: 48.5,
      hours: 3.7,
      pricePerKg: 22,
      watts: 150,
      electricityRatePerKwh: 0.16,
      wearRatePerHour: 0.15,
      failurePct: 7,
      channelFeePct: 9.5,
      channelFixedFee: 0.45,
      markupMultiplier: 3.5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(formatCurrency(r.unitCost)).toBe('$1.83');
    expect(formatCurrency(r.sellingPrice)).toBe('$7.58');
    expect(formatCurrency(r.profit)).toBe('$4.58');
    expect(r.marginPct).toBe(60);
  });

  it('C2: Same as C1, channel Direct (0%, $0)', () => {
    const r = calculatePrintCost({
      grams: 48.5,
      hours: 3.7,
      pricePerKg: 22,
      watts: 150,
      electricityRatePerKwh: 0.16,
      wearRatePerHour: 0.15,
      failurePct: 7,
      channelFeePct: 0,
      channelFixedFee: 0,
      markupMultiplier: 3.5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(formatCurrency(r.sellingPrice)).toBe('$6.41');
    expect(formatCurrency(r.profit)).toBe('$4.58');
    expect(r.marginPct).toBe(71);
  });

  it('C3: All zeros, Direct channel -> Price $0.00; margin null (em dash); no NaN', () => {
    const r = calculatePrintCost({
      grams: 0,
      hours: 0,
      pricePerKg: 0,
      watts: 0,
      electricityRatePerKwh: 0,
      wearRatePerHour: 0,
      failurePct: 0,
      channelFeePct: 0,
      channelFixedFee: 0,
      markupMultiplier: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(formatCurrency(r.sellingPrice)).toBe('$0.00');
    expect(r.marginPct).toBeNull();
    expect(Number.isNaN(r.sellingPrice)).toBe(false);
    expect(Number.isNaN(r.profit)).toBe(false);
  });

  it('C4: Time formatter, 2.999 h -> 3h 00m (not 2h 60m)', () => {
    expect(formatDurationHours(2.999)).toBe('3h 00m');
  });

  it('Section 9.2 guards: rejects channel fee >= 100%, negative inputs, and flags markup < 1x', () => {
    const fee100 = calculatePrintCost({
      grams: 48.5,
      hours: 3.7,
      pricePerKg: 22,
      watts: 150,
      electricityRatePerKwh: 0.16,
      wearRatePerHour: 0.15,
      failurePct: 7,
      channelFeePct: 100,
      channelFixedFee: 0,
      markupMultiplier: 3.5,
    });
    expect(fee100.ok).toBe(false);

    const belowCost = calculatePrintCost({
      grams: 48.5,
      hours: 3.7,
      pricePerKg: 22,
      watts: 150,
      electricityRatePerKwh: 0.16,
      wearRatePerHour: 0.15,
      failurePct: 7,
      channelFeePct: 0,
      channelFixedFee: 0,
      markupMultiplier: 0.8,
    });
    expect(belowCost.ok && belowCost.belowCostWarning).toBe(true);

    expect(Number.isNaN(parseStrictNumber(''))).toBe(true);
    expect(Number.isNaN(parseStrictNumber('48,5'))).toBe(true);
    expect(Number.isNaN(parseStrictNumber('abc'))).toBe(true);
    expect(Number.isNaN(parseStrictNumber('1e12'))).toBe(true);
    expect(parseStrictNumber('0')).toBe(0);
  });
});
