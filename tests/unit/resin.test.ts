import { describe, it, expect } from 'vitest';
import { calculateResinCost, calculateResinTime } from '../../src/core/resin';
import { formatCurrency } from '../../src/core/format';

describe('SLA Resin Calculator Golden Vectors (C10–C12) and Guards', () => {
  it('C10: 65 mL solid, 42% retained, 22% supports, $26/L -> 33.3 mL; $0.87', () => {
    const r = calculateResinCost({
      solidVolumeMl: 65,
      retainedFraction: 0.42,
      supportPct: 22,
      pricePerUnit: 26,
      priceBasis: 'per_liter',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resinMl).toBeCloseTo(33.3, 1);
    expect(formatCurrency(r.resinLiquidCost)).toBe('$0.87');
  });

  it('C11: Resin time: 120 mm, 0.05 mm layers, 2.4 s exposure, 4.0 s lift, 0 bottom layers -> 2,400 layers; 4h 16m', () => {
    const r = calculateResinTime({
      heightMm: 120,
      layerHeightMm: 0.05,
      exposureSec: 2.4,
      liftRetractSec: 4.0,
      bottomLayers: 0,
      bottomExposureSec: 30,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layers).toBe(2400);
    expect(r.formattedTime).toBe('4h 16m');
  });

  it('C12: Same as C11 plus 6 bottom layers at 30 s -> 4h 19m', () => {
    const r = calculateResinTime({
      heightMm: 120,
      layerHeightMm: 0.05,
      exposureSec: 2.4,
      liftRetractSec: 4.0,
      bottomLayers: 6,
      bottomExposureSec: 30,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.layers).toBe(2400);
    expect(r.formattedTime).toBe('4h 19m');
  });

  it('Section 9.2 guards: rejects layerHeight = 0 and printsPerFep = 0', () => {
    expect(
      calculateResinTime({
        heightMm: 120,
        layerHeightMm: 0,
        exposureSec: 2.4,
        liftRetractSec: 4.0,
      }).ok
    ).toBe(false);

    expect(
      calculateResinCost({
        solidVolumeMl: 65,
        retainedFraction: 1,
        supportPct: 20,
        pricePerUnit: 26,
        printsPerFep: 0,
      }).ok
    ).toBe(false);
  });
});
