import { describe, it, expect } from 'vitest';
import { spoolRemaining } from '../../src/core/spool';

describe('spoolRemaining', () => {
  it('C7: 412 g on a 250 g Bambu spool, PLA 1.75 mm', () => {
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
  it('zero density is rejected, never Infinity', () => {
    expect(spoolRemaining(412, 250, 0, 1.75, 1000).ok).toBe(false);
  });
});
