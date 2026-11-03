import { describe, it, expect } from 'vitest';
import { parseGcode } from '../../src/core/gcode';

describe('G-code Parser Golden Vectors (C5–C6) and Modes', () => {
  it('C5: Absolute E: G1 X10 E5, G92 E0, G1 X20 E3 (PLA, 1.75 mm) -> 8.0 mm; 0.024 g', () => {
    const gcode = [
      'G21',
      'G90',
      'M82',
      'G1 X10 E5',
      'G92 E0',
      'G1 X20 E3',
    ].join('\n');

    const r = parseGcode(gcode, { densityGPerCm3: 1.24, diameterMm: 1.75 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filamentMm).toBeCloseTo(8.0, 4);
    expect(r.filamentGrams).toBeCloseTo(0.024, 3);
  });

  it('C6: Relative E (M83): E1, E1, E-0.5, E0.5 -> Net extrusion 2.0 mm', () => {
    const gcode = [
      'M83',
      'G1 X10 E1',
      'G1 X20 E1',
      'G1 E-0.5',
      'G1 X30 E0.5',
    ].join('\r\n');

    const r = parseGcode(gcode, { densityGPerCm3: 1.24, diameterMm: 1.75 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filamentMm).toBeCloseTo(2.0, 4);
  });

  it('supports G20 inches conversion and CRLF matching LF', () => {
    const inchGcode = 'G20\r\nM82\r\nG1 X1.0 E1.0\r\n';
    const r = parseGcode(inchGcode);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filamentMm).toBeCloseTo(25.4, 3);
  });

  it('rejects comments-only G-code with no_geometry', () => {
    const r = parseGcode('; header comment only\n; another comment\n');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe('no_geometry');
    }
  });
});
