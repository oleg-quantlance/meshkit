import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditTriangles, parseStl, type Triangle } from '../../src/core/stl';
import { applyScale, guessUnit } from '../../src/core/scale';
import { simplifyMesh } from '../../src/core/simplify';

const CUBE = (() => {
  const r = parseStl(new Uint8Array(readFileSync(resolve(__dirname, '../fixtures/cube-10mm.stl'))));
  if (!r.ok) throw new Error('fixture');
  return r.triangles;
})();

/** UV sphere as a triangle soup, outward wound. */
function sphere(radius: number, stacks: number, slices: number): Triangle[] {
  const p = (i: number, j: number) => {
    const th = (i / stacks) * Math.PI, ph = (j / slices) * Math.PI * 2;
    return { x: radius * Math.sin(th) * Math.cos(ph), y: radius * Math.sin(th) * Math.sin(ph), z: radius * Math.cos(th) };
  };
  const out: Triangle[] = [];
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
      if (i > 0) out.push({ v0: a, v1: b, v2: d });
      if (i < stacks - 1) out.push({ v0: b, v1: c, v2: d });
    }
  }
  return out;
}

describe('scale', () => {
  it('guesses units from extent', () => {
    expect(guessUnit(auditTriangles(CUBE)).unit).toBe('inch'); // 10 units
    const m = applyScale(CUBE, { factor: 0.01 }).after; // 0.1 units
    expect(guessUnit(m)).toMatchObject({ unit: 'm', confidence: 'high' });
    expect(guessUnit(applyScale(CUBE, { factor: 10 }).after)).toMatchObject({ unit: 'mm', confidence: 'high' });
    expect(guessUnit(applyScale(CUBE, { factor: 4 }).after).unit).toBe('cm');
    expect(guessUnit(applyScale(CUBE, { factor: 100 }).after).confidence).toBe('low');
  });

  it('converts units, applies factors and fit-to-size, keeping volume consistent', () => {
    const inch = applyScale(CUBE, { fromUnit: 'inch', toUnit: 'mm' });
    expect(inch.after.bboxMm.sizeX).toBeCloseTo(254);
    expect(inch.after.volumeCm3).toBeCloseTo(16387.064, 1);
    expect(inch.uniformFactor).toBeCloseTo(25.4);
    expect(inch.logs.join('\n')).toMatch(/inch → mm/);

    const fit = applyScale(CUBE, { fitAxis: 'z', fitSize: 50 });
    expect(fit.after.bboxMm.sizeZ).toBeCloseTo(50);
    expect(fit.after.bboxMm.sizeX).toBeCloseTo(50);

    const fitMax = applyScale(CUBE, { axisFactors: [2, 1, 1], fitAxis: 'max', fitSize: 100 });
    expect(Math.max(fitMax.after.bboxMm.sizeX, fitMax.after.bboxMm.sizeY)).toBeCloseTo(100 * 2); // fit computed before axis factors
    expect(fitMax.after.isWatertight).toBe(true);

    const toInch = applyScale(CUBE, { fromUnit: 'mm', toUnit: 'inch' });
    expect(toInch.after.bboxMm.sizeX).toBeCloseTo(10 / 25.4);
  });

  it('Y-up → Z-up rotates, mirroring flips winding, negative axis factor keeps normals outward', () => {
    const tall = applyScale(CUBE, { axisFactors: [1, 3, 1] }).triangles; // 10 × 30 × 10
    const rot = applyScale(tall, { yUpToZUp: true });
    expect(rot.after.bboxMm.sizeZ).toBeCloseTo(30);
    expect(rot.after.bboxMm.sizeY).toBeCloseTo(10);
    expect(rot.after.isInsideOut).toBe(false);
    expect(rot.after.volumeCm3).toBeCloseTo(3, 6);

    const mir = applyScale(CUBE, { mirror: 'x' });
    expect(mir.after.isInsideOut).toBe(false);
    expect(mir.after.volumeCm3).toBeCloseTo(1, 6);
    expect(mir.after.bboxMm.minX).toBeCloseTo(auditTriangles(CUBE).bboxMm.minX);

    const neg = applyScale(CUBE, { axisFactors: [-1, 1, 1] });
    expect(neg.after.isInsideOut).toBe(false);
    expect(neg.after.signedVolumeCm3).toBeGreaterThan(0);
  });

  it('centres on XY and drops to the bed', () => {
    const moved = applyScale(CUBE, { factor: 1, axisFactors: [1, 1, 1] }).triangles.map((t) => ({
      v0: { x: t.v0.x + 40, y: t.v0.y - 7, z: t.v0.z + 12 },
      v1: { x: t.v1.x + 40, y: t.v1.y - 7, z: t.v1.z + 12 },
      v2: { x: t.v2.x + 40, y: t.v2.y - 7, z: t.v2.z + 12 },
    }));
    const r = applyScale(moved, { centerXY: true, dropToBed: true });
    expect(r.after.bboxMm.minZ).toBeCloseTo(0);
    expect(r.after.bboxMm.minX + r.after.bboxMm.maxX).toBeCloseTo(0);
    expect(r.after.bboxMm.minY + r.after.bboxMm.maxY).toBeCloseTo(0);
    expect(r.logs.join('\n')).toMatch(/Dropped to bed/);
  });
});

describe('simplifyMesh', () => {
  it('reduces a dense sphere to the target while keeping it watertight and its volume within 2%', () => {
    const s = sphere(20, 40, 80); // 6,240 triangles
    const before = auditTriangles(s);
    expect(before.isWatertight).toBe(true);
    const r = simplifyMesh(s, { ratio: 0.2 });
    expect(r.outputTriangles).toBeLessThanOrEqual(Math.round(s.length * 0.2) + 2);
    expect(r.outputTriangles).toBeGreaterThan(s.length * 0.15);
    expect(r.after.isWatertight).toBe(true);
    expect(r.after.isInsideOut).toBe(false);
    expect(Math.abs(r.after.volumeCm3 - before.volumeCm3) / before.volumeCm3).toBeLessThan(0.02);
    expect(r.collapses).toBeGreaterThan(0);
    expect(r.logs.join('\n')).toMatch(/edge collapses/);
  });

  it('honours an absolute triangle target and maxError early stop', () => {
    const s = sphere(10, 24, 48);
    const r = simplifyMesh(s, { targetTriangles: 300 });
    expect(r.outputTriangles).toBeLessThanOrEqual(302);
    expect(r.outputTriangles).toBeGreaterThanOrEqual(250);

    const tiny = simplifyMesh(s, { targetTriangles: 10, maxError: 1e-9 });
    expect(tiny.outputTriangles).toBe(s.length); // nothing cheap enough → stops immediately
  });

  it('does not collapse a cube below its 12 faces into garbage, and preserves open boundaries', () => {
    // A closed surface with 6 triangles has only 5 vertices, so a cube cannot be halved and
    // stay a cube; every collapse removes a corner. With an error cap the simplifier must
    // recognise that no collapse is cheap enough and leave the cube untouched.
    const capped = simplifyMesh(CUBE, { ratio: 0.5, maxError: 1e-6 });
    expect(capped.outputTriangles).toBe(12);
    expect(capped.after.volumeCm3).toBeCloseTo(1, 6);
    // Without a cap it does what it is told, stays closed, and says how much volume moved.
    const r = simplifyMesh(CUBE, { ratio: 0.5 });
    expect(r.outputTriangles).toBeLessThan(12);
    expect(r.after.isWatertight).toBe(true);
    expect(r.logs.join('\n')).toMatch(/volume 1\.000 → /);

    // Open hemisphere: rim must stay at z ≈ 0 thanks to boundary quadrics.
    const hemi = sphere(20, 40, 80).filter((t) => t.v0.z >= -1e-9 && t.v1.z >= -1e-9 && t.v2.z >= -1e-9);
    const hb = auditTriangles(hemi);
    expect(hb.boundaryEdges).toBeGreaterThan(0);
    const hr = simplifyMesh(hemi, { ratio: 0.25 });
    expect(hr.after.boundaryEdges).toBeGreaterThan(0);
    expect(hr.after.bboxMm.minZ).toBeGreaterThan(-0.5);
    expect(hr.after.bboxMm.maxZ).toBeCloseTo(20, 0);
  });

  it('returns the input untouched when the target is not smaller', () => {
    const r = simplifyMesh(CUBE, { ratio: 1 });
    expect(r.outputTriangles).toBe(12);
    expect(r.collapses).toBe(0);
    expect(r.logs.join('\n')).toMatch(/nothing to do/);
  });
});
