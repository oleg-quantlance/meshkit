import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  auditStl,
  repairStl,
  exportBinaryStl,
  exportAsciiStl,
} from '../../src/core/stl';

const cube10mmAscii = readFileSync(
  new URL('../fixtures/cube-10mm.stl', import.meta.url),
  'utf-8'
);

describe('STL Topology Audit & Repair Golden Vectors (C13–C14)', () => {
  it('C13: closed 10 mm cube (12 facets) -> Volume 1.000 cm³; area 6.00 cm²; 0 holes; bbox 10×10×10 mm', () => {
    const res = auditStl(cube10mmAscii);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const m = res.metrics;
    expect(m.triangleCount).toBe(12);
    expect(m.volumeCm3).toBeCloseTo(1.0, 3);
    expect(m.surfaceAreaCm2).toBeCloseTo(6.0, 2);
    expect(m.holes).toBe(0);
    expect(m.boundaryEdges).toBe(0);
    expect(m.nonManifoldEdges).toBe(0);
    expect(m.flippedFaces).toBe(0);
    expect(m.isWatertight).toBe(true);
    expect(m.bboxMm.sizeX).toBeCloseTo(10, 3);
    expect(m.bboxMm.sizeY).toBeCloseTo(10, 3);
    expect(m.bboxMm.sizeZ).toBeCloseTo(10, 3);
  });

  it('C14a: cube with top 2 facets removed -> 4 boundary edges, 1 hole, and repairStl seals it', () => {
    const parsed = auditStl(cube10mmAscii);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Remove the 2 top facets (indices 2 and 3, where z = 10)
    const openCubeTris = parsed.triangles.filter((_, idx) => idx !== 2 && idx !== 3);
    const openAscii = exportAsciiStl(openCubeTris, 'open_cube');
    const auditedOpen = auditStl(openAscii);
    expect(auditedOpen.ok).toBe(true);
    if (!auditedOpen.ok) return;

    expect(auditedOpen.metrics.triangleCount).toBe(10);
    expect(auditedOpen.metrics.boundaryEdges).toBe(4);
    expect(auditedOpen.metrics.holes).toBe(1);
    expect(auditedOpen.metrics.isWatertight).toBe(false);

    // Repair should close the 4-edge hole (+2 facets -> 12 facets, 0 holes, 1.000 cm³)
    const repaired = repairStl(openCubeTris);
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.repaired).toBe(true);
    expect(repaired.after.boundaryEdges).toBe(0);
    expect(repaired.after.holes).toBe(0);
    expect(repaired.after.triangleCount).toBe(12);
    expect(repaired.after.volumeCm3).toBeCloseTo(1.0, 3);
    expect(repaired.binaryStl.byteLength).toBe(84 + 50 * 12);
  });

  it('C14b: cube with 1 facet reversed -> 1 flipped face, and repairStl unifies normals', () => {
    const parsed = auditStl(cube10mmAscii);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const trisWithReversed = parsed.triangles.map((t, idx) =>
      idx === 0 ? { v0: t.v0, v1: t.v2, v2: t.v1 } : t
    );
    const bin = exportBinaryStl(trisWithReversed);
    const audited = auditStl(bin);
    expect(audited.ok).toBe(true);
    if (!audited.ok) return;

    expect(audited.metrics.flippedFaces).toBe(1);

    const repaired = repairStl(bin);
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.repaired).toBe(true);
    expect(repaired.after.flippedFaces).toBe(0);
    expect(repaired.after.volumeCm3).toBeCloseTo(1.0, 3);
  });

  it('detects inside-out mesh (negative signed volume) and flips outward on repair', () => {
    const parsed = auditStl(cube10mmAscii);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const invertedTris = parsed.triangles.map((t) => ({
      v0: t.v0,
      v1: t.v2,
      v2: t.v1,
    }));
    const audited = auditStl(exportBinaryStl(invertedTris));
    expect(audited.ok).toBe(true);
    if (!audited.ok) return;

    expect(audited.metrics.isInsideOut).toBe(true);
    expect(audited.metrics.signedVolumeCm3).toBeCloseTo(-1.0, 3);
    expect(audited.metrics.volumeCm3).toBeCloseTo(1.0, 3);

    const repaired = repairStl(invertedTris);
    expect(repaired.ok && repaired.after.isInsideOut).toBe(false);
    expect(repaired.ok && repaired.after.signedVolumeCm3).toBeCloseTo(1.0, 3);
  });
});
