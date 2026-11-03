import { describe, it, expect } from 'vitest';
import { spoolRemaining, gramsToMeters, metersToGrams, willPrintFinish } from '../../src/core/spool';

describe('spoolRemaining & Spool Converters (C7–C9)', () => {
  it('C7: 412 g on a 250 g Bambu spool, PLA 1.24, 1.75 mm, 1 kg spool', () => {
    const r = spoolRemaining(412, 250, 1.24, 1.75, 1000);
    expect(r.ok && r.netG).toBe(162);
    expect(r.ok && r.meters).toBeCloseTo(54.3, 1);
    expect(r.ok && r.pctLeft).toBeCloseTo(16.2, 1);
  });

  it('C8: below tare gives 0 g and a warning', () => {
    const r = spoolRemaining(200, 250, 1.24, 1.75, 1000);
    expect(r.ok && r.netG).toBe(0);
    expect(r.ok && r.belowTare).toBe(true);
  });

  it('C9: net 500 g, PETG 1.27, 2.85 mm -> 61.7 m', () => {
    const r = spoolRemaining(500, 0, 1.27, 2.85, 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meters).toBeCloseTo(61.7, 1);

    const g2m = gramsToMeters(500, 1.27, 2.85);
    expect(g2m.ok && g2m.meters).toBeCloseTo(61.7, 1);

    const m2g = metersToGrams(61.7144, 1.27, 2.85);
    expect(m2g.ok && m2g.grams).toBeCloseTo(500, 1);
  });

  it('zero density, diameter, or spool size is rejected, never Infinity', () => {
    expect(spoolRemaining(412, 250, 0, 1.75, 1000).ok).toBe(false);
    expect(spoolRemaining(412, 250, 1.24, 0, 1000).ok).toBe(false);
    expect(spoolRemaining(412, 250, 1.24, 1.75, 0).ok).toBe(false);
  });

  it('willPrintFinish checks remaining filament vs job requirement', () => {
    const okPrint = willPrintFinish(162, 120);
    expect(okPrint.ok && okPrint.canFinish).toBe(true);
    expect(okPrint.ok && okPrint.marginG).toBe(42);

    const shortPrint = willPrintFinish(80, 120);
    expect(shortPrint.ok && shortPrint.canFinish).toBe(false);
  });
});
