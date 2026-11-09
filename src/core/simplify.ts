/**
 * Mesh simplification by quadric error metric edge collapse (Garland &
 * Heckbert 1997), the algorithm behind MeshLab's "Quadric Edge Collapse
 * Decimation" and Blender's Decimate modifier.
 *
 * Pipeline: weld vertices → build index mesh → per-vertex quadrics from face
 * planes (+ boundary-edge quadrics so open edges stay put) → lazy priority
 * queue of edge collapses → remove degenerate / flipped faces → rebuild
 * Triangle[]. Deterministic, dependency-free, fast enough for ~1M triangles
 * in a worker.
 */
import { auditTriangles, type StlAuditMetrics, type Triangle, type Vec3 } from './stl';

export interface SimplifyOptions {
  /** Keep this fraction of the input triangles (0 < ratio ≤ 1). Ignored if targetTriangles is set. */
  ratio?: number;
  /** Absolute triangle target. */
  targetTriangles?: number;
  /** Stop early once the cheapest collapse exceeds this squared-distance error (output units²). */
  maxError?: number;
  /** Penalty weight that pins boundary edges (0 = free, 1000 = rigid). */
  boundaryWeight?: number;
  /** Reject collapses that flip a neighbouring face (recommended). */
  preventFlips?: boolean;
}

export interface SimplifyResult {
  triangles: Triangle[];
  before: StlAuditMetrics;
  after: StlAuditMetrics;
  inputTriangles: number;
  outputTriangles: number;
  collapses: number;
  /** Largest quadric error accepted (squared distance in model units). */
  maxErrorUsed: number;
  logs: string[];
}

// 4×4 symmetric quadric stored as 10 upper-triangle coefficients.
type Quadric = Float64Array;

function quadricFromPlane(a: number, b: number, c: number, d: number, w = 1): Quadric {
  const q = new Float64Array(10);
  q[0] = a * a * w; q[1] = a * b * w; q[2] = a * c * w; q[3] = a * d * w;
  q[4] = b * b * w; q[5] = b * c * w; q[6] = b * d * w;
  q[7] = c * c * w; q[8] = c * d * w;
  q[9] = d * d * w;
  return q;
}

function addQ(into: Quadric, q: Quadric): void {
  for (let i = 0; i < 10; i++) into[i] += q[i];
}

function sumQ(a: Quadric, b: Quadric): Quadric {
  const q = new Float64Array(10);
  for (let i = 0; i < 10; i++) q[i] = a[i] + b[i];
  return q;
}

function evalQ(q: Quadric, x: number, y: number, z: number): number {
  return (
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
    q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y +
    q[7] * z * z + 2 * q[8] * z +
    q[9]
  );
}

/** Solves for the optimal collapse position; falls back to best of endpoints/midpoint. */
function optimalPosition(q: Quadric, p1: Vec3, p2: Vec3): { p: Vec3; err: number } {
  const a = q[0], b = q[1], c = q[2], d = q[3], e = q[4], f = q[5], g = q[6], h = q[7], i = q[8];
  const det = a * (e * h - f * f) - b * (b * h - f * c) + c * (b * f - e * c);
  if (Math.abs(det) > 1e-12) {
    const inv = 1 / det;
    const x = -inv * (d * (e * h - f * f) - g * (b * h - f * c) + i * (b * f - e * c));
    const y = -inv * (a * (g * h - f * i) - b * (d * h - c * i) + c * (d * f - g * e));
    const z = -inv * (a * (e * i - g * f) - b * (b * i - g * c) + d * (b * f - e * c));
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      // Guard against wild solutions far from the edge (near-singular cases).
      const span = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z) * 4 + 1e-9;
      if (Math.hypot(x - p1.x, y - p1.y, z - p1.z) <= span) {
        return { p: { x, y, z }, err: evalQ(q, x, y, z) };
      }
    }
  }
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: (p1.z + p2.z) / 2 };
  const candidates = [p1, p2, mid];
  let best = candidates[0], bestErr = Infinity;
  for (const cnd of candidates) {
    const err = evalQ(q, cnd.x, cnd.y, cnd.z);
    if (err < bestErr) { bestErr = err; best = cnd; }
  }
  return { p: best, err: bestErr };
}

// Binary min-heap over edge records.
interface EdgeRec { a: number; b: number; err: number; px: number; py: number; pz: number; version: number }

class MinHeap {
  private h: EdgeRec[] = [];
  get size(): number { return this.h.length; }
  push(e: EdgeRec): void {
    const h = this.h; h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].err <= h[i].err) break;
      [h[p], h[i]] = [h[i], h[p]]; i = p;
    }
  }
  pop(): EdgeRec | undefined {
    const h = this.h;
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < h.length && h[l].err < h[m].err) m = l;
        if (r < h.length && h[r].err < h[m].err) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]]; i = m;
      }
    }
    return top;
  }
}

export function simplifyMesh(input: Triangle[], options: SimplifyOptions = {}): SimplifyResult {
  const before = auditTriangles(input, 'binary');
  const logs: string[] = [];
  const n = input.length;
  const ratio = options.ratio ?? 0.5;
  const target = Math.max(4, Math.min(n, options.targetTriangles ?? Math.round(n * ratio)));
  const boundaryWeight = options.boundaryWeight ?? 100;
  const preventFlips = options.preventFlips ?? true;
  const maxError = options.maxError ?? Infinity;

  // --- Weld to an index mesh -------------------------------------------
  const diag = Math.hypot(before.bboxMm.sizeX, before.bboxMm.sizeY, before.bboxMm.sizeZ) || 1;
  const eps = Math.max(1e-9, diag * 1e-6);
  const keyToIndex = new Map<string, number>();
  const px: number[] = [], py: number[] = [], pz: number[] = [];
  const faces: number[] = []; // 3 indices per face
  const idxOf = (v: Vec3): number => {
    const key = `${Math.round(v.x / eps)},${Math.round(v.y / eps)},${Math.round(v.z / eps)}`;
    let i = keyToIndex.get(key);
    if (i === undefined) { i = px.length; keyToIndex.set(key, i); px.push(v.x); py.push(v.y); pz.push(v.z); }
    return i;
  };
  for (const t of input) {
    const a = idxOf(t.v0), b = idxOf(t.v1), c = idxOf(t.v2);
    if (a === b || b === c || a === c) continue;
    faces.push(a, b, c);
  }
  const V = px.length;
  const F = faces.length / 3;
  logs.push(`Welded ${(n * 3).toLocaleString()} corners → ${V.toLocaleString()} vertices, ${F.toLocaleString()} faces`);

  if (F <= target) {
    logs.push('Target is not below the input size; nothing to do');
    return { triangles: input, before, after: before, inputTriangles: n, outputTriangles: n, collapses: 0, maxErrorUsed: 0, logs };
  }

  // --- Quadrics & adjacency --------------------------------------------
  const quadrics: Quadric[] = new Array(V);
  for (let i = 0; i < V; i++) quadrics[i] = new Float64Array(10);
  const faceAlive = new Uint8Array(F).fill(1);
  const vertFaces: number[][] = new Array(V);
  for (let i = 0; i < V; i++) vertFaces[i] = [];
  const edgeCount = new Map<number, number>(); // key = min*V+max → number of faces using edge
  const ekey = (a: number, b: number) => (a < b ? a * V + b : b * V + a);

  for (let f = 0; f < F; f++) {
    const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
    vertFaces[a].push(f); vertFaces[b].push(f); vertFaces[c].push(f);
    const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
    const vx = px[c] - px[a], vy = py[c] - py[a], vz = pz[c] - pz[a];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-18) { faceAlive[f] = 0; continue; }
    nx /= len; ny /= len; nz /= len;
    const d = -(nx * px[a] + ny * py[a] + nz * pz[a]);
    const q = quadricFromPlane(nx, ny, nz, d, len); // area-weighted
    addQ(quadrics[a], q); addQ(quadrics[b], q); addQ(quadrics[c], q);
    for (const [p, r] of [[a, b], [b, c], [c, a]] as const) {
      const k = ekey(p, r); edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }

  // Boundary edges get a perpendicular-plane quadric so they resist moving.
  let boundaryEdges = 0;
  for (let f = 0; f < F; f++) {
    if (!faceAlive[f]) continue;
    const tri = [faces[f * 3], faces[f * 3 + 1], faces[f * 3 + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3], c = tri[(e + 2) % 3];
      if ((edgeCount.get(ekey(a, b)) ?? 0) !== 1) continue;
      boundaryEdges++;
      const ex = px[b] - px[a], ey = py[b] - py[a], ez = pz[b] - pz[a];
      const fx = px[c] - px[a], fy = py[c] - py[a], fz = pz[c] - pz[a];
      let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; // face normal
      // plane containing the edge and perpendicular to the face: normal = edge × faceNormal
      let bx = ey * nz - ez * ny, by = ez * nx - ex * nz, bz = ex * ny - ey * nx;
      const bl = Math.hypot(bx, by, bz);
      if (bl < 1e-18) continue;
      bx /= bl; by /= bl; bz /= bl;
      const d = -(bx * px[a] + by * py[a] + bz * pz[a]);
      const q = quadricFromPlane(bx, by, bz, d, boundaryWeight * Math.hypot(ex, ey, ez));
      addQ(quadrics[a], q); addQ(quadrics[b], q);
      void nx; void ny; void nz;
    }
  }
  if (boundaryEdges) logs.push(`${boundaryEdges.toLocaleString()} boundary edges pinned (weight ${boundaryWeight})`);

  // --- Priority queue ----------------------------------------------------
  const version = new Uint32Array(V); // bump on vertex change → invalidates queued edges
  const alive = new Uint8Array(V).fill(1);
  const heap = new MinHeap();
  const pushEdge = (a: number, b: number) => {
    if (a === b || !alive[a] || !alive[b]) return;
    const q = sumQ(quadrics[a], quadrics[b]);
    const { p, err } = optimalPosition(q, { x: px[a], y: py[a], z: pz[a] }, { x: px[b], y: py[b], z: pz[b] });
    heap.push({ a, b, err, px: p.x, py: p.y, pz: p.z, version: version[a] + version[b] });
  };
  const seen = new Set<number>();
  for (let f = 0; f < F; f++) {
    if (!faceAlive[f]) continue;
    const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
    for (const [p, r] of [[a, b], [b, c], [c, a]] as const) {
      const k = ekey(p, r);
      if (!seen.has(k)) { seen.add(k); pushEdge(p, r); }
    }
  }

  // --- Collapse loop -----------------------------------------------------
  let liveFaces = 0;
  for (let f = 0; f < F; f++) liveFaces += faceAlive[f];
  let collapses = 0;
  let maxErrorUsed = 0;

  const wouldFlip = (v: number, other: number, nx: number, ny: number, nz: number): boolean => {
    for (const f of vertFaces[v]) {
      if (!faceAlive[f]) continue;
      const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
      if (a === other || b === other || c === other) continue; // face will be removed
      const ia = a === v ? [nx, ny, nz] : [px[a], py[a], pz[a]];
      const ib = b === v ? [nx, ny, nz] : [px[b], py[b], pz[b]];
      const ic = c === v ? [nx, ny, nz] : [px[c], py[c], pz[c]];
      const oux = px[b] - px[a], ouy = py[b] - py[a], ouz = pz[b] - pz[a];
      const ovx = px[c] - px[a], ovy = py[c] - py[a], ovz = pz[c] - pz[a];
      const on = [ouy * ovz - ouz * ovy, ouz * ovx - oux * ovz, oux * ovy - ouy * ovx];
      const nux = ib[0] - ia[0], nuy = ib[1] - ia[1], nuz = ib[2] - ia[2];
      const nvx = ic[0] - ia[0], nvy = ic[1] - ia[1], nvz = ic[2] - ia[2];
      const nn = [nuy * nvz - nuz * nvy, nuz * nvx - nux * nvz, nux * nvy - nuy * nvx];
      const dot = on[0] * nn[0] + on[1] * nn[1] + on[2] * nn[2];
      const nl = Math.hypot(nn[0], nn[1], nn[2]);
      if (dot < 0 || nl < 1e-18) return true;
    }
    return false;
  };

  while (liveFaces > target && heap.size > 0) {
    const e = heap.pop()!;
    if (!alive[e.a] || !alive[e.b]) continue;
    if (e.version !== version[e.a] + version[e.b]) continue; // stale
    if (e.err > maxError) break;
    // Edge must still exist (share a live face).
    let shared = 0;
    for (const f of vertFaces[e.a]) {
      if (!faceAlive[f]) continue;
      const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
      if (a === e.b || b === e.b || c === e.b) shared++;
    }
    if (shared === 0) continue;
    if (preventFlips && (wouldFlip(e.a, e.b, e.px, e.py, e.pz) || wouldFlip(e.b, e.a, e.px, e.py, e.pz))) continue;

    // Collapse b into a at the optimal position.
    const a = e.a, b = e.b;
    px[a] = e.px; py[a] = e.py; pz[a] = e.pz;
    addQ(quadrics[a], quadrics[b]);
    alive[b] = 0;
    version[a]++;
    for (const f of vertFaces[b]) {
      if (!faceAlive[f]) continue;
      const i0 = f * 3;
      const fa = faces[i0], fb = faces[i0 + 1], fc = faces[i0 + 2];
      if (fa === a || fb === a || fc === a) { faceAlive[f] = 0; liveFaces--; continue; } // shared face collapses
      if (fa === b) faces[i0] = a;
      if (fb === b) faces[i0 + 1] = a;
      if (fc === b) faces[i0 + 2] = a;
      vertFaces[a].push(f);
    }
    vertFaces[b] = [];
    collapses++;
    if (e.err > maxErrorUsed) maxErrorUsed = e.err;

    // Re-queue edges around a.
    const nbrs = new Set<number>();
    const kept: number[] = [];
    for (const f of vertFaces[a]) {
      if (!faceAlive[f]) continue;
      kept.push(f);
      const fa = faces[f * 3], fb = faces[f * 3 + 1], fc = faces[f * 3 + 2];
      if (fa !== a) nbrs.add(fa); if (fb !== a) nbrs.add(fb); if (fc !== a) nbrs.add(fc);
    }
    vertFaces[a] = kept;
    for (const nb of nbrs) pushEdge(a, nb);
  }

  // --- Rebuild -----------------------------------------------------------
  const out: Triangle[] = [];
  for (let f = 0; f < F; f++) {
    if (!faceAlive[f]) continue;
    const a = faces[f * 3], b = faces[f * 3 + 1], c = faces[f * 3 + 2];
    if (a === b || b === c || a === c) continue;
    out.push({ v0: { x: px[a], y: py[a], z: pz[a] }, v1: { x: px[b], y: py[b], z: pz[b] }, v2: { x: px[c], y: py[c], z: pz[c] } });
  }
  const after = auditTriangles(out, 'binary');
  logs.push(`${collapses.toLocaleString()} edge collapses → ${out.length.toLocaleString()} triangles (${((out.length / n) * 100).toFixed(1)}% of input)`);
  logs.push(`Max accepted error ${Math.sqrt(Math.max(0, maxErrorUsed)).toExponential(2)} (≈ distance units); volume ${before.volumeCm3.toFixed(3)} → ${after.volumeCm3.toFixed(3)} cm³ (${(((after.volumeCm3 - before.volumeCm3) / (before.volumeCm3 || 1)) * 100).toFixed(2)}%)`);
  if (before.isWatertight && !after.isWatertight) logs.push('Warning: mesh is no longer watertight — lower the reduction or raise the boundary weight');
  if (liveFaces > target && heap.size === 0) logs.push('Stopped early: no more collapses possible without flipping faces');
  return { triangles: out, before, after, inputTriangles: n, outputTriangles: out.length, collapses, maxErrorUsed, logs };
}
