import { describe, it, expect } from 'vitest';
import {
  buildGrid,
  buildWireframe,
  clampOrbit,
  computeBounds,
  computeFlatNormals,
  fitOrbit,
  gridStepFor,
  lookAt,
  multiply,
  orbitEye,
  panDelta,
  perspective,
  transformPoint,
  viewProjection,
} from '../../src/core/viewer-math';

// One triangle in the XY plane, CCW seen from +Z.
const TRI = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);

describe('viewer-math: geometry', () => {
  it('computes bounds, centre and radius', () => {
    const b = computeBounds(new Float32Array([0, 0, 0, 10, 20, 30]));
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max).toEqual([10, 20, 30]);
    expect(b.center).toEqual([5, 10, 15]);
    expect(b.radius).toBeCloseTo(Math.hypot(10, 20, 30) / 2);
    const empty = computeBounds(new Float32Array(0));
    expect(empty.radius).toBe(1);
  });

  it('flat normals point along +Z for a CCW XY triangle and are repeated per vertex', () => {
    const n = computeFlatNormals(TRI);
    expect(Array.from(n)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const degenerate = computeFlatNormals(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(Array.from(degenerate).every(Number.isFinite)).toBe(true);
  });

  it('wireframe emits three edges per triangle', () => {
    const w = buildWireframe(TRI);
    expect(w.length).toBe(18);
    expect(Array.from(w.slice(0, 6))).toEqual([0, 0, 0, 10, 0, 0]);
    expect(Array.from(w.slice(12, 18))).toEqual([0, 10, 0, 0, 0, 0]);
  });

  it('picks round grid steps and builds a grid on Z = 0 around the footprint', () => {
    expect(gridStepFor(computeBounds(new Float32Array([0, 0, 0, 20, 20, 20])))).toBe(2);
    expect(gridStepFor(computeBounds(new Float32Array([0, 0, 0, 120, 120, 20])))).toBe(10);
    expect(gridStepFor(computeBounds(new Float32Array([0, 0, 0, 1, 1, 1])))).toBe(0.1);
    const b = computeBounds(new Float32Array([0, 0, 5, 20, 20, 25]));
    const g = buildGrid(b, 5);
    expect(g.length % 6).toBe(0);
    for (let i = 2; i < g.length; i += 3) expect(g[i]).toBe(0);
  });
});

describe('viewer-math: camera', () => {
  it('perspective maps near plane to -1 and far plane to +1 in NDC', () => {
    const p = perspective(Math.PI / 2, 1, 1, 10);
    const near = transformPoint(p, [0, 0, -1]);
    const far = transformPoint(p, [0, 0, -10]);
    expect(near[2] / near[3]).toBeCloseTo(-1);
    expect(far[2] / far[3]).toBeCloseTo(1);
  });

  it('lookAt puts the target on the -Z axis of view space and handles up parallel to view', () => {
    const v = lookAt([0, -10, 0], [0, 0, 0], [0, 0, 1]);
    const t = transformPoint(v, [0, 0, 0]);
    expect(t[0]).toBeCloseTo(0);
    expect(t[1]).toBeCloseTo(0);
    expect(t[2]).toBeCloseTo(-10);
    const degenerate = lookAt([0, 0, 10], [0, 0, 0], [0, 0, 1]);
    expect(Array.from(degenerate).every(Number.isFinite)).toBe(true);
  });

  it('multiply composes as M = A·B (B applied first)', () => {
    const t = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1]); // translate x+5
    const s = new Float32Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]); // scale 2
    const p = transformPoint(multiply(t, s), [1, 0, 0]); // scale then translate → 7
    expect(p[0]).toBeCloseTo(7);
    const q = transformPoint(multiply(s, t), [1, 0, 0]); // translate then scale → 12
    expect(q[0]).toBeCloseTo(12);
  });

  it('orbit: eye position, clamping and fit framing', () => {
    const s = { target: [0, 0, 0] as [number, number, number], distance: 10, azimuth: 0, elevation: 0 };
    expect(orbitEye(s)).toEqual([10, 0, 0]);
    const up = orbitEye({ ...s, elevation: Math.PI / 2 });
    expect(up[2]).toBeCloseTo(10);
    const c = clampOrbit({ ...s, distance: 1000, elevation: 5 }, 1, 100);
    expect(c.distance).toBe(100);
    expect(c.elevation).toBeLessThan(Math.PI / 2);

    const b = computeBounds(new Float32Array([-10, -10, 0, 10, 10, 20]));
    const fit = fitOrbit(b, Math.PI / 4, 16 / 9);
    expect(fit.target).toEqual(b.center);
    expect(fit.distance).toBeGreaterThan(b.radius);
    // The whole bounding sphere must be inside the clip volume.
    const vp = viewProjection(fit, 16 / 9, Math.PI / 4, b.radius);
    for (const corner of [b.min, b.max, [b.min[0], b.max[1], b.min[2]] as [number, number, number]]) {
      const clip = transformPoint(vp, corner);
      expect(Math.abs(clip[0] / clip[3])).toBeLessThanOrEqual(1);
      expect(Math.abs(clip[1] / clip[3])).toBeLessThanOrEqual(1);
      expect(Math.abs(clip[2] / clip[3])).toBeLessThanOrEqual(1);
    }
  });

  it('pan moves the target in the screen plane, scaled by distance', () => {
    const s = { target: [0, 0, 0] as [number, number, number], distance: 100, azimuth: -Math.PI / 2, elevation: 0 };
    // Camera at (0,-100,0) looking +Y; screen-right is +X, screen-up is +Z.
    const d = panDelta(s, 10, 0, 500, Math.PI / 4);
    expect(d[0]).toBeLessThan(0); // dragging right moves the world right, i.e. target left
    expect(Math.abs(d[2])).toBeLessThan(1e-9);
    const d2 = panDelta({ ...s, distance: 200 }, 10, 0, 500, Math.PI / 4);
    expect(Math.abs(d2[0])).toBeCloseTo(Math.abs(d[0]) * 2);
    const dy = panDelta(s, 0, 10, 500, Math.PI / 4);
    expect(dy[2]).toBeGreaterThan(0);
  });
});
