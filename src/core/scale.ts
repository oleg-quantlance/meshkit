/**
 * Mesh transforms for the "Scale & Units Fixer" page: unit conversion,
 * uniform/axis scaling, fit-to-size, Y-up → Z-up, mirroring, centring and
 * dropping to the bed. Pure functions over Triangle[]; the page wraps them.
 */
import { auditTriangles, type StlAuditMetrics, type Triangle, type Vec3 } from './stl';

export type LengthUnit = 'mm' | 'cm' | 'm' | 'inch' | 'foot';

export const UNIT_TO_MM: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000, inch: 25.4, foot: 304.8 };

export interface ScaleOptions {
  /** Interpret the file's numbers as this unit… */
  fromUnit?: LengthUnit;
  /** …and write them out in this unit (default mm). */
  toUnit?: LengthUnit;
  /** Extra uniform factor applied after unit conversion (default 1). */
  factor?: number;
  /** Per-axis factors applied after the uniform factor. */
  axisFactors?: [number, number, number];
  /** Scale uniformly so the given axis extent becomes this many output units. */
  fitAxis?: 'x' | 'y' | 'z' | 'max';
  fitSize?: number;
  /** Rotate so the file's +Y becomes +Z (Blender / Maya / glTF exports). */
  yUpToZUp?: boolean;
  /** Mirror across a plane through the model's centre. */
  mirror?: 'x' | 'y' | 'z' | null;
  /** Translate so the XY centre is at the origin. */
  centerXY?: boolean;
  /** Translate so the lowest point sits on Z = 0. */
  dropToBed?: boolean;
}

export interface ScaleResult {
  triangles: Triangle[];
  before: StlAuditMetrics;
  after: StlAuditMetrics;
  /** Final uniform factor actually applied (unit × factor × fit). */
  uniformFactor: number;
  logs: string[];
}

export interface UnitGuess {
  unit: LengthUnit;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Guesses the unit a mesh was authored in from its largest extent, assuming
 * the thing is a printable part (roughly 5 mm – 400 mm in real life).
 */
export function guessUnit(m: StlAuditMetrics): UnitGuess {
  const maxDim = Math.max(m.bboxMm.sizeX, m.bboxMm.sizeY, m.bboxMm.sizeZ);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return { unit: 'mm', confidence: 'low', reason: 'empty bounding box' };
  if (maxDim < 1.5) return { unit: 'm', confidence: 'high', reason: `largest extent ${maxDim.toFixed(4)} — a part under 1.5 units is almost certainly metres` };
  if (maxDim < 25) return { unit: 'inch', confidence: 'medium', reason: `largest extent ${maxDim.toFixed(2)} — plausible as inches (${(maxDim * 25.4).toFixed(0)} mm) or a very small mm part` };
  if (maxDim < 60) return { unit: 'cm', confidence: 'low', reason: `largest extent ${maxDim.toFixed(1)} — could be cm (${(maxDim * 10).toFixed(0)} mm) or a small mm part` };
  if (maxDim <= 500) return { unit: 'mm', confidence: 'high', reason: `largest extent ${maxDim.toFixed(1)} fits a printer bed as millimetres` };
  return { unit: 'mm', confidence: 'low', reason: `largest extent ${maxDim.toFixed(0)} — larger than any desktop bed; may be over-scaled or in microns` };
}

function mapVertices(triangles: Triangle[], fn: (v: Vec3) => Vec3, flipWinding: boolean): Triangle[] {
  const out = new Array<Triangle>(triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    const a = fn(t.v0), b = fn(t.v1), c = fn(t.v2);
    out[i] = flipWinding ? { v0: a, v1: c, v2: b } : { v0: a, v1: b, v2: c };
  }
  return out;
}

export function applyScale(input: Triangle[], options: ScaleOptions = {}): ScaleResult {
  const before = auditTriangles(input, 'binary');
  const logs: string[] = [];
  const fromUnit = options.fromUnit ?? 'mm';
  const toUnit = options.toUnit ?? 'mm';
  let uniform = (UNIT_TO_MM[fromUnit] / UNIT_TO_MM[toUnit]) * (options.factor ?? 1);
  if (fromUnit !== toUnit) logs.push(`Units: ${fromUnit} → ${toUnit} (×${(UNIT_TO_MM[fromUnit] / UNIT_TO_MM[toUnit]).toPrecision(6)})`);
  if (options.factor && options.factor !== 1) logs.push(`Uniform factor ×${options.factor}`);

  // Orientation first (so fit/axis operations refer to the final axes).
  let tris = input;
  if (options.yUpToZUp) {
    tris = mapVertices(tris, (v) => ({ x: v.x, y: -v.z, z: v.y }), false);
    logs.push('Rotated +90° about X: file Y-up → Z-up');
  }

  if (options.fitAxis && options.fitSize && options.fitSize > 0) {
    const m = auditTriangles(tris, 'binary');
    const ext =
      options.fitAxis === 'x' ? m.bboxMm.sizeX :
      options.fitAxis === 'y' ? m.bboxMm.sizeY :
      options.fitAxis === 'z' ? m.bboxMm.sizeZ :
      Math.max(m.bboxMm.sizeX, m.bboxMm.sizeY, m.bboxMm.sizeZ);
    if (ext > 0) {
      const fit = options.fitSize / (ext * uniform);
      uniform *= fit;
      logs.push(`Fit ${options.fitAxis.toUpperCase()} extent to ${options.fitSize} ${toUnit}: additional ×${fit.toPrecision(6)}`);
    }
  }

  const [ax, ay, az] = options.axisFactors ?? [1, 1, 1];
  if (ax !== 1 || ay !== 1 || az !== 1) logs.push(`Per-axis factors ×${ax} / ×${ay} / ×${az}`);
  const sx = uniform * ax, sy = uniform * ay, sz = uniform * az;
  const negativeAxes = [sx, sy, sz].filter((s) => s < 0).length;
  tris = mapVertices(tris, (v) => ({ x: v.x * sx, y: v.y * sy, z: v.z * sz }), negativeAxes % 2 === 1);

  if (options.mirror) {
    const m = auditTriangles(tris, 'binary');
    const cx = (m.bboxMm.minX + m.bboxMm.maxX) / 2, cy = (m.bboxMm.minY + m.bboxMm.maxY) / 2, cz = (m.bboxMm.minZ + m.bboxMm.maxZ) / 2;
    const ax2 = options.mirror;
    tris = mapVertices(
      tris,
      (v) => ({ x: ax2 === 'x' ? 2 * cx - v.x : v.x, y: ax2 === 'y' ? 2 * cy - v.y : v.y, z: ax2 === 'z' ? 2 * cz - v.z : v.z }),
      true
    );
    logs.push(`Mirrored across ${ax2.toUpperCase()} through the model centre (winding flipped to keep normals outward)`);
  }

  if (options.centerXY || options.dropToBed) {
    const m = auditTriangles(tris, 'binary');
    const dx = options.centerXY ? -(m.bboxMm.minX + m.bboxMm.maxX) / 2 : 0;
    const dy = options.centerXY ? -(m.bboxMm.minY + m.bboxMm.maxY) / 2 : 0;
    const dz = options.dropToBed ? -m.bboxMm.minZ : 0;
    tris = mapVertices(tris, (v) => ({ x: v.x + dx, y: v.y + dy, z: v.z + dz }), false);
    if (options.centerXY) logs.push(`Centred on origin in XY (moved ${dx.toFixed(2)}, ${dy.toFixed(2)})`);
    if (options.dropToBed) logs.push(`Dropped to bed: Z min ${m.bboxMm.minZ.toFixed(2)} → 0`);
  }

  const after = auditTriangles(tris, 'binary');
  logs.push(
    `Bounding box ${before.bboxMm.sizeX.toFixed(2)} × ${before.bboxMm.sizeY.toFixed(2)} × ${before.bboxMm.sizeZ.toFixed(2)} → ` +
      `${after.bboxMm.sizeX.toFixed(2)} × ${after.bboxMm.sizeY.toFixed(2)} × ${after.bboxMm.sizeZ.toFixed(2)} ${toUnit}`
  );
  if (after.isInsideOut !== before.isInsideOut) logs.push('Warning: orientation changed — check normals in the viewer');
  return { triangles: tris, before, after, uniformFactor: uniform, logs };
}
