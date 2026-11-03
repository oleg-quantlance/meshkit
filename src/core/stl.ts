export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Triangle {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  normal?: Vec3;
}

export interface StlAuditMetrics {
  format: 'binary' | 'ascii';
  triangleCount: number;
  weldedVertexCount: number;
  boundaryEdges: number;
  holes: number;
  nonManifoldEdges: number;
  flippedFaces: number;
  degenerateFaces: number;
  isWatertight: boolean;
  isInsideOut: boolean;
  signedVolumeCm3: number;
  volumeCm3: number;
  surfaceAreaCm2: number;
  bboxMm: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    sizeX: number;
    sizeY: number;
    sizeZ: number;
  };
}

export type StlParseAndAuditResult =
  | {
      ok: true;
      metrics: StlAuditMetrics;
      triangles: Triangle[];
    }
  | {
      ok: false;
      errorCode: 'empty' | 'corrupt' | 'no_geometry';
      error: string;
    };

export type StlRepairResult =
  | {
      ok: true;
      repaired: boolean;
      statusMessage: string;
      before: StlAuditMetrics;
      after: StlAuditMetrics;
      triangles: Triangle[];
      binaryStl: ArrayBuffer;
    }
  | {
      ok: false;
      error: string;
    };

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function computeNormal(v0: Vec3, v1: Vec3, v2: Vec3): { normal: Vec3; areaMm2: number } {
  const ux = v1.x - v0.x;
  const uy = v1.y - v0.y;
  const uz = v1.z - v0.z;
  const vx = v2.x - v0.x;
  const vy = v2.y - v0.y;
  const vz = v2.z - v0.z;
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  const len = Math.hypot(cx, cy, cz);
  const areaMm2 = 0.5 * len;
  if (len > 0) {
    return {
      normal: { x: cx / len, y: cy / len, z: cz / len },
      areaMm2,
    };
  }
  return {
    normal: { x: 0, y: 0, z: 1 },
    areaMm2: 0,
  };
}

/**
 * Parses an STL buffer (ArrayBuffer, Uint8Array, or string).
 * Section 4.2 rule:
 * - A file is binary if its byte length equals 84 + 50 * N, where N is uint32 at byte 80.
 *   Never rely on 'solid' prefix alone because binary files often start with 'solid'.
 */
export function parseStl(input: ArrayBuffer | Uint8Array | string): {
  ok: true;
  format: 'binary' | 'ascii';
  triangles: Triangle[];
} | {
  ok: false;
  errorCode: 'empty' | 'corrupt' | 'no_geometry';
  error: string;
} {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }

  if (bytes.byteLength === 0) {
    return {
      ok: false,
      errorCode: 'empty',
      error: 'This file is empty (0 bytes). Please choose another file.',
    };
  }

  // Reject PNG or obvious non-STL magic headers immediately
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return {
      ok: false,
      errorCode: 'corrupt',
      error: 'This file has a .stl name but is a PNG image, not an STL mesh.',
    };
  }

  // 1. Check exact binary STL formula: size === 84 + 50 * N
  if (bytes.byteLength >= 84) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const nTris = dv.getUint32(80, true);
    const expectedByteLen = 84 + 50 * nTris;

    if (bytes.byteLength === expectedByteLen) {
      if (nTris === 0) {
        return {
          ok: false,
          errorCode: 'no_geometry',
          error: 'No triangles were found in this STL file.',
        };
      }
      const triangles: Triangle[] = [];
      for (let i = 0; i < nTris; i++) {
        const off = 84 + i * 50;
        const nx = dv.getFloat32(off, true);
        const ny = dv.getFloat32(off + 4, true);
        const nz = dv.getFloat32(off + 8, true);
        const v0: Vec3 = {
          x: dv.getFloat32(off + 12, true),
          y: dv.getFloat32(off + 16, true),
          z: dv.getFloat32(off + 20, true),
        };
        const v1: Vec3 = {
          x: dv.getFloat32(off + 24, true),
          y: dv.getFloat32(off + 28, true),
          z: dv.getFloat32(off + 32, true),
        };
        const v2: Vec3 = {
          x: dv.getFloat32(off + 36, true),
          y: dv.getFloat32(off + 40, true),
          z: dv.getFloat32(off + 44, true),
        };

        if (!isFiniteVec3(v0) || !isFiniteVec3(v1) || !isFiniteVec3(v2)) {
          return {
            ok: false,
            errorCode: 'corrupt',
            error: 'This binary STL file contains invalid (NaN or Infinite) vertex coordinates.',
          };
        }

        triangles.push({
          v0,
          v1,
          v2,
          normal: Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)
            ? { x: nx, y: ny, z: nz }
            : undefined,
        });
      }
      return { ok: true, format: 'binary', triangles };
    }
  }

  // 2. If size !== 84 + 50 * N, check whether it is an ASCII STL or a truncated binary STL
  const checkLen = Math.min(bytes.byteLength, 65536);
  let hasNul = false;
  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0) {
      hasNul = true;
      break;
    }
  }

  const headText = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.byteLength, 512))
  );
  const startsWithSolid = headText.trimStart().toLowerCase().startsWith('solid');

  if (!startsWithSolid || hasNul) {
    if (bytes.byteLength >= 84) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const expectedN = dv.getUint32(80, true);
      const foundN = Math.max(0, Math.floor((bytes.byteLength - 84) / 50));
      if (expectedN > 0 && expectedN < 50_000_000) {
        return {
          ok: false,
          errorCode: 'corrupt',
          error: `This STL file is incomplete or damaged (expected ${expectedN.toLocaleString('en-US')} triangles, found ${foundN.toLocaleString('en-US')}).`,
        };
      }
    }
    return {
      ok: false,
      errorCode: 'corrupt',
      error: 'This STL file is incomplete or damaged.',
    };
  }

  // Parse as ASCII STL
  const fullText =
    typeof input === 'string'
      ? input
      : new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  const lines = fullText.split(/\r?\n/);
  const triangles: Triangle[] = [];
  let inFacet = false;
  let inLoop = false;
  let currentVertices: Vec3[] = [];
  let currentNormal: Vec3 | undefined;
  let sawEndSolid = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const lower = line.toLowerCase();

    if (lower.startsWith('endsolid')) {
      sawEndSolid = true;
      break;
    } else if (lower.startsWith('facet normal')) {
      if (inFacet) {
        return {
          ok: false,
          errorCode: 'corrupt',
          error: 'This ASCII STL file is damaged (nested facet without endfacet).',
        };
      }
      inFacet = true;
      currentVertices = [];
      const parts = line.split(/\s+/);
      if (parts.length >= 5) {
        const nx = Number(parts[2]);
        const ny = Number(parts[3]);
        const nz = Number(parts[4]);
        if (Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)) {
          currentNormal = { x: nx, y: ny, z: nz };
        }
      }
    } else if (lower.startsWith('outer loop')) {
      if (!inFacet) {
        return {
          ok: false,
          errorCode: 'corrupt',
          error: 'This ASCII STL file is damaged (outer loop outside facet).',
        };
      }
      inLoop = true;
    } else if (lower.startsWith('vertex')) {
      if (!inFacet || !inLoop) {
        return {
          ok: false,
          errorCode: 'corrupt',
          error: 'This ASCII STL file is damaged (vertex outside outer loop).',
        };
      }
      const parts = line.split(/\s+/);
      if (parts.length < 4) {
        return {
          ok: false,
          errorCode: 'corrupt',
          error: 'This ASCII STL file has an incomplete vertex line.',
        };
      }
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return {
          ok: false,
          errorCode: 'corrupt',
          error: 'This STL file contains invalid (NaN) vertex coordinates.',
        };
      }
      currentVertices.push({ x, y, z });
    } else if (lower.startsWith('endloop')) {
      inLoop = false;
    } else if (lower.startsWith('endfacet')) {
      if (!inFacet || inLoop || currentVertices.length !== 3) {
        return {
          ok: false,
          errorCode: 'corrupt',
          error: 'This ASCII STL file has an incomplete facet definition.',
        };
      }
      triangles.push({
        v0: currentVertices[0],
        v1: currentVertices[1],
        v2: currentVertices[2],
        normal: currentNormal,
      });
      inFacet = false;
      currentVertices = [];
      currentNormal = undefined;
    }
  }

  if (inFacet || inLoop || !sawEndSolid) {
    return {
      ok: false,
      errorCode: 'corrupt',
      error: 'This ASCII STL file is incomplete or cut off mid-facet.',
    };
  }

  if (triangles.length === 0) {
    return {
      ok: false,
      errorCode: 'no_geometry',
      error: 'No triangles were found in this STL file.',
    };
  }

  return { ok: true, format: 'ascii', triangles };
}

/**
 * Performs full topological edge analysis and signed volume calculation on triangles.
 */
export function auditTriangles(
  triangles: Triangle[],
  format: 'binary' | 'ascii' = 'binary'
): StlAuditMetrics {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    const verts = [t.v0, t.v1, t.v2];
    for (let j = 0; j < 3; j++) {
      const v = verts[j];
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }

  const sizeX = Number.isFinite(maxX - minX) ? maxX - minX : 0;
  const sizeY = Number.isFinite(maxY - minY) ? maxY - minY : 0;
  const sizeZ = Number.isFinite(maxZ - minZ) ? maxZ - minZ : 0;
  const diag = Math.hypot(sizeX, sizeY, sizeZ);
  const epsilon = Math.max(1e-9, diag * 1e-6);

  // Weld vertices using quantized grid coordinates
  const vertexMap = new Map<string, number>();
  const uniqueVerts: Vec3[] = [];

  function getWeldedIndex(v: Vec3): number {
    const qx = Math.round(v.x / epsilon);
    const qy = Math.round(v.y / epsilon);
    const qz = Math.round(v.z / epsilon);
    const key = `${qx}_${qy}_${qz}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const idx = uniqueVerts.length;
    uniqueVerts.push(v);
    vertexMap.set(key, idx);
    return idx;
  }

  interface IndexedFace {
    a: number;
    b: number;
    c: number;
    declaredNormal?: Vec3;
    windingNormal: Vec3;
  }

  const validFaces: IndexedFace[] = [];
  let degenerateFaces = 0;
  let totalAreaMm2 = 0;
  let signedVolumeMm3 = 0;

  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    const a = getWeldedIndex(t.v0);
    const b = getWeldedIndex(t.v1);
    const c = getWeldedIndex(t.v2);

    const { normal: windingNormal, areaMm2 } = computeNormal(t.v0, t.v1, t.v2);
    if (a === b || b === c || c === a || areaMm2 < 1e-12) {
      degenerateFaces++;
      continue;
    }

    totalAreaMm2 += areaMm2;
    // Signed tetrahedron volume: v0 · (v1 × v2) / 6
    const crossX = t.v1.y * t.v2.z - t.v1.z * t.v2.y;
    const crossY = t.v1.z * t.v2.x - t.v1.x * t.v2.z;
    const crossZ = t.v1.x * t.v2.y - t.v1.y * t.v2.x;
    signedVolumeMm3 += (t.v0.x * crossX + t.v0.y * crossY + t.v0.z * crossZ) / 6.0;

    validFaces.push({
      a,
      b,
      c,
      declaredNormal: t.normal,
      windingNormal,
    });
  }

  // Build undirected edge map -> list of { faceIdx, dir: 1 | -1, u, v }
  interface EdgeUse {
    faceIdx: number;
    dir: 1 | -1; // +1 if u < v, -1 if u > v
    u: number;
    v: number;
  }

  const edgeMap = new Map<string, EdgeUse[]>();

  function addDirectedEdge(faceIdx: number, u: number, v: number): void {
    const minV = u < v ? u : v;
    const maxV = u < v ? v : u;
    const dir: 1 | -1 = u < v ? 1 : -1;
    const key = `${minV}_${maxV}`;
    let list = edgeMap.get(key);
    if (!list) {
      list = [];
      edgeMap.set(key, list);
    }
    list.push({ faceIdx, dir, u, v });
  }

  for (let fIdx = 0; fIdx < validFaces.length; fIdx++) {
    const f = validFaces[fIdx];
    addDirectedEdge(fIdx, f.a, f.b);
    addDirectedEdge(fIdx, f.b, f.c);
    addDirectedEdge(fIdx, f.c, f.a);
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  const boundaryAdj = new Map<number, number[]>();

  // Adjacency list for dual-graph BFS orientation check:
  // If two faces share an undirected edge:
  // - same dir means their orientations conflict (relativeParity = 1)
  // - opposite dir means their orientations agree (relativeParity = 0)
  const faceAdj: Array<Array<{ neighbor: number; conflict: boolean }>> = Array.from(
    { length: validFaces.length },
    () => []
  );

  for (const uses of edgeMap.values()) {
    if (uses.length === 1) {
      boundaryEdges++;
      const { u, v } = uses[0];
      let uList = boundaryAdj.get(u);
      if (!uList) {
        uList = [];
        boundaryAdj.set(u, uList);
      }
      uList.push(v);

      let vList = boundaryAdj.get(v);
      if (!vList) {
        vList = [];
        boundaryAdj.set(v, vList);
      }
      vList.push(u);
    } else if (uses.length > 2) {
      nonManifoldEdges++;
    } else if (uses.length === 2) {
      const [u0, u1] = uses;
      const conflict = u0.dir === u1.dir;
      faceAdj[u0.faceIdx].push({ neighbor: u1.faceIdx, conflict });
      faceAdj[u1.faceIdx].push({ neighbor: u0.faceIdx, conflict });
    }
  }

  // Count boundary loops (connected components of boundary vertices)
  let holes = 0;
  const visitedBoundaryVerts = new Set<number>();
  for (const startV of boundaryAdj.keys()) {
    if (visitedBoundaryVerts.has(startV)) continue;
    holes++;
    const stack = [startV];
    visitedBoundaryVerts.add(startV);
    while (stack.length > 0) {
      const curr = stack.pop()!;
      const neighbors = boundaryAdj.get(curr) ?? [];
      for (const nxt of neighbors) {
        if (!visitedBoundaryVerts.has(nxt)) {
          visitedBoundaryVerts.add(nxt);
          stack.push(nxt);
        }
      }
    }
  }

  // Count flipped faces via BFS 2-coloring on the dual graph
  let flippedFaces = 0;
  const faceParity = new Int8Array(validFaces.length).fill(-1);
  for (let i = 0; i < validFaces.length; i++) {
    if (faceParity[i] !== -1) continue;
    faceParity[i] = 0;
    const queue = [i];
    let count0 = 0;
    let count1 = 0;
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (faceParity[curr] === 0) count0++;
      else count1++;
      for (const edge of faceAdj[curr]) {
        const expectedParity = edge.conflict ? 1 - faceParity[curr] : faceParity[curr];
        if (faceParity[edge.neighbor] === -1) {
          faceParity[edge.neighbor] = expectedParity;
          queue.push(edge.neighbor);
        }
      }
    }
    flippedFaces += Math.min(count0, count1);
  }

  // Also check if declared normals explicitly oppose winding normals when winding itself had 0 conflicts
  if (flippedFaces === 0) {
    let declaredConflicts = 0;
    for (const f of validFaces) {
      if (f.declaredNormal) {
        const nLen = Math.hypot(f.declaredNormal.x, f.declaredNormal.y, f.declaredNormal.z);
        if (nLen > 0.1) {
          const dot =
            f.declaredNormal.x * f.windingNormal.x +
            f.declaredNormal.y * f.windingNormal.y +
            f.declaredNormal.z * f.windingNormal.z;
          if (dot < -0.2) {
            declaredConflicts++;
          }
        }
      }
    }
    flippedFaces = declaredConflicts;
  }

  const signedVolumeCm3 = signedVolumeMm3 / 1000.0;
  const isInsideOut = signedVolumeCm3 < -1e-6;
  const volumeCm3 = Math.abs(signedVolumeCm3);
  const surfaceAreaCm2 = totalAreaMm2 / 100.0;
  const isWatertight =
    boundaryEdges === 0 && nonManifoldEdges === 0 && flippedFaces === 0 && validFaces.length > 0;

  return {
    format,
    triangleCount: triangles.length,
    weldedVertexCount: uniqueVerts.length,
    boundaryEdges,
    holes,
    nonManifoldEdges,
    flippedFaces,
    degenerateFaces,
    isWatertight,
    isInsideOut,
    signedVolumeCm3,
    volumeCm3,
    surfaceAreaCm2,
    bboxMm: {
      minX: Number.isFinite(minX) ? minX : 0,
      maxX: Number.isFinite(maxX) ? maxX : 0,
      minY: Number.isFinite(minY) ? minY : 0,
      maxY: Number.isFinite(maxY) ? maxY : 0,
      minZ: Number.isFinite(minZ) ? minZ : 0,
      maxZ: Number.isFinite(maxZ) ? maxZ : 0,
      sizeX,
      sizeY,
      sizeZ,
    },
  };
}

export function auditStl(input: ArrayBuffer | Uint8Array | string): StlParseAndAuditResult {
  const parsed = parseStl(input);
  if (!parsed.ok) return parsed;
  const metrics = auditTriangles(parsed.triangles, parsed.format);
  return {
    ok: true,
    metrics,
    triangles: parsed.triangles,
  };
}

/**
 * Exports a Triangle array as a standard binary STL ArrayBuffer of exact size 84 + 50 * N.
 */
export function exportBinaryStl(triangles: Triangle[]): ArrayBuffer {
  const byteLength = 84 + 50 * triangles.length;
  const buffer = new ArrayBuffer(byteLength);
  const bytes = new Uint8Array(buffer);
  const headerStr = 'MeshKit Watertight Binary STL Export';
  for (let i = 0; i < Math.min(80, headerStr.length); i++) {
    bytes[i] = headerStr.charCodeAt(i);
  }

  const dv = new DataView(buffer);
  dv.setUint32(80, triangles.length, true);

  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    const { normal } = computeNormal(t.v0, t.v1, t.v2);
    const off = 84 + i * 50;
    dv.setFloat32(off, normal.x, true);
    dv.setFloat32(off + 4, normal.y, true);
    dv.setFloat32(off + 8, normal.z, true);

    dv.setFloat32(off + 12, t.v0.x, true);
    dv.setFloat32(off + 16, t.v0.y, true);
    dv.setFloat32(off + 20, t.v0.z, true);

    dv.setFloat32(off + 24, t.v1.x, true);
    dv.setFloat32(off + 28, t.v1.y, true);
    dv.setFloat32(off + 32, t.v1.z, true);

    dv.setFloat32(off + 36, t.v2.x, true);
    dv.setFloat32(off + 40, t.v2.y, true);
    dv.setFloat32(off + 44, t.v2.z, true);

    dv.setUint16(off + 48, 0, true);
  }

  return buffer;
}

/**
 * Exports a Triangle array as an ASCII STL string.
 */
export function exportAsciiStl(triangles: Triangle[], solidName = 'meshkit_export'): string {
  const lines: string[] = [`solid ${solidName}`];
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    const { normal } = computeNormal(t.v0, t.v1, t.v2);
    lines.push(
      `  facet normal ${normal.x.toExponential(6)} ${normal.y.toExponential(6)} ${normal.z.toExponential(6)}`
    );
    lines.push('    outer loop');
    lines.push(
      `      vertex ${t.v0.x.toExponential(6)} ${t.v0.y.toExponential(6)} ${t.v0.z.toExponential(6)}`
    );
    lines.push(
      `      vertex ${t.v1.x.toExponential(6)} ${t.v1.y.toExponential(6)} ${t.v1.z.toExponential(6)}`
    );
    lines.push(
      `      vertex ${t.v2.x.toExponential(6)} ${t.v2.y.toExponential(6)} ${t.v2.z.toExponential(6)}`
    );
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${solidName}`);
  return lines.join('\n') + '\n';
}

/**
 * Repairs a mesh by:
 * 1. Welding coincident vertices (epsilon = 1e-6 * bbox diagonal)
 * 2. Removing zero-area degenerate triangles
 * 3. Unifying face normals across connected components via BFS
 * 4. Filling open boundary loops via ear-clipping / fan triangulation
 * 5. Ensuring outward-facing signed volume (> 0)
 * 6. Re-auditing the result and reporting honestly whether 0 defects remain
 */
export function repairStl(input: ArrayBuffer | Uint8Array | string | Triangle[]): StlRepairResult {
  let initialTriangles: Triangle[];
  let beforeMetrics: StlAuditMetrics;

  if (Array.isArray(input)) {
    if (input.length === 0) {
      return { ok: false, error: 'No triangles to repair.' };
    }
    initialTriangles = input;
    beforeMetrics = auditTriangles(initialTriangles, 'binary');
  } else {
    const audited = auditStl(input);
    if (!audited.ok) {
      return { ok: false, error: audited.error };
    }
    initialTriangles = audited.triangles;
    beforeMetrics = audited.metrics;
  }

  const { sizeX, sizeY, sizeZ } = beforeMetrics.bboxMm;
  const diag = Math.hypot(sizeX, sizeY, sizeZ);
  const epsilon = Math.max(1e-9, diag * 1e-6);

  const vertexMap = new Map<string, number>();
  const uniqueVerts: Vec3[] = [];

  function getWeldedIndex(v: Vec3): number {
    const qx = Math.round(v.x / epsilon);
    const qy = Math.round(v.y / epsilon);
    const qz = Math.round(v.z / epsilon);
    const key = `${qx}_${qy}_${qz}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const idx = uniqueVerts.length;
    uniqueVerts.push({ x: v.x, y: v.y, z: v.z });
    vertexMap.set(key, idx);
    return idx;
  }

  // Step 1 & 2: Weld vertices and cull degenerate faces
  const faces: Array<[number, number, number]> = [];
  for (const t of initialTriangles) {
    const a = getWeldedIndex(t.v0);
    const b = getWeldedIndex(t.v1);
    const c = getWeldedIndex(t.v2);
    if (a === b || b === c || c === a) continue;
    const { areaMm2 } = computeNormal(uniqueVerts[a], uniqueVerts[b], uniqueVerts[c]);
    if (areaMm2 < 1e-12) continue;
    faces.push([a, b, c]);
  }

  if (faces.length === 0) {
    return { ok: false, error: 'All triangles in this mesh are degenerate (zero area).' };
  }

  // Step 3: Unify face normal orientation across manifold edges
  interface HalfEdgeRef {
    faceIdx: number;
    dir: 1 | -1;
  }
  const edgeToFaces = new Map<string, HalfEdgeRef[]>();
  function registerEdge(faceIdx: number, u: number, v: number): void {
    const minV = u < v ? u : v;
    const maxV = u < v ? v : u;
    const dir: 1 | -1 = u < v ? 1 : -1;
    const key = `${minV}_${maxV}`;
    let list = edgeToFaces.get(key);
    if (!list) {
      list = [];
      edgeToFaces.set(key, list);
    }
    list.push({ faceIdx, dir });
  }

  for (let i = 0; i < faces.length; i++) {
    const [a, b, c] = faces[i];
    registerEdge(i, a, b);
    registerEdge(i, b, c);
    registerEdge(i, c, a);
  }

  const adj: Array<Array<{ neighbor: number; conflict: boolean }>> = Array.from(
    { length: faces.length },
    () => []
  );
  for (const refs of edgeToFaces.values()) {
    if (refs.length === 2) {
      const [r0, r1] = refs;
      const conflict = r0.dir === r1.dir;
      adj[r0.faceIdx].push({ neighbor: r1.faceIdx, conflict });
      adj[r1.faceIdx].push({ neighbor: r0.faceIdx, conflict });
    }
  }

  const flipFlag = new Int8Array(faces.length).fill(-1);
  for (let i = 0; i < faces.length; i++) {
    if (flipFlag[i] !== -1) continue;
    flipFlag[i] = 0;
    const queue = [i];
    const group0: number[] = [];
    const group1: number[] = [];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (flipFlag[curr] === 0) group0.push(curr);
      else group1.push(curr);
      for (const edge of adj[curr]) {
        const nextFlag = edge.conflict ? 1 - flipFlag[curr] : flipFlag[curr];
        if (flipFlag[edge.neighbor] === -1) {
          flipFlag[edge.neighbor] = nextFlag;
          queue.push(edge.neighbor);
        }
      }
    }
    const toFlip = group1.length <= group0.length ? group1 : group0;
    for (const fIdx of toFlip) {
      const [a, b, c] = faces[fIdx];
      faces[fIdx] = [a, c, b];
    }
  }

  // Step 4: Close open boundary loops
  const directedHalfEdges = new Map<string, number>();
  for (const [a, b, c] of faces) {
    directedHalfEdges.set(`${a}_${b}`, (directedHalfEdges.get(`${a}_${b}`) ?? 0) + 1);
    directedHalfEdges.set(`${b}_${c}`, (directedHalfEdges.get(`${b}_${c}`) ?? 0) + 1);
    directedHalfEdges.set(`${c}_${a}`, (directedHalfEdges.get(`${c}_${a}`) ?? 0) + 1);
  }

  // A boundary edge (u -> v) on the existing mesh needs a patching face with half-edge (v -> u)
  const nextBoundaryVertex = new Map<number, number[]>();
  for (const [key, count] of directedHalfEdges.entries()) {
    const [uStr, vStr] = key.split('_');
    const u = Number(uStr);
    const v = Number(vStr);
    const revCount = directedHalfEdges.get(`${v}_${u}`) ?? 0;
    if (count === 1 && revCount === 0) {
      // Missing half-edge is v -> u
      let list = nextBoundaryVertex.get(v);
      if (!list) {
        list = [];
        nextBoundaryVertex.set(v, list);
      }
      list.push(u);
    }
  }

  const usedBoundaryEdges = new Set<string>();
  for (const startV of nextBoundaryVertex.keys()) {
    const startTargets = nextBoundaryVertex.get(startV) ?? [];
    for (const firstNext of startTargets) {
      if (usedBoundaryEdges.has(`${startV}_${firstNext}`)) continue;
      const loop: number[] = [startV];
      usedBoundaryEdges.add(`${startV}_${firstNext}`);
      let curr = firstNext;
      let steps = 0;
      while (curr !== startV && steps < 10000) {
        loop.push(curr);
        const candidates = nextBoundaryVertex.get(curr) ?? [];
        const nxt = candidates.find((c) => !usedBoundaryEdges.has(`${curr}_${c}`));
        if (nxt === undefined) break;
        usedBoundaryEdges.add(`${curr}_${nxt}`);
        curr = nxt;
        steps++;
      }

      if (curr === startV && loop.length >= 3) {
        const anchor = loop[0];
        for (let k = 1; k < loop.length - 1; k++) {
          faces.push([anchor, loop[k], loop[k + 1]]);
        }
      }
    }
  }

  // Build repaired triangles
  let repairedTriangles: Triangle[] = faces.map(([a, b, c]) => {
    const v0 = uniqueVerts[a];
    const v1 = uniqueVerts[b];
    const v2 = uniqueVerts[c];
    const { normal } = computeNormal(v0, v1, v2);
    return { v0, v1, v2, normal };
  });

  // Step 5: Check signed volume; if negative (inside-out), flip all triangles outward
  let afterMetrics = auditTriangles(repairedTriangles, 'binary');
  if (afterMetrics.signedVolumeCm3 < 0) {
    repairedTriangles = repairedTriangles.map((t) => {
      const { normal } = computeNormal(t.v0, t.v2, t.v1);
      return { v0: t.v0, v1: t.v2, v2: t.v1, normal };
    });
    afterMetrics = auditTriangles(repairedTriangles, 'binary');
  }

  const repaired =
    afterMetrics.boundaryEdges === 0 &&
    afterMetrics.nonManifoldEdges === 0 &&
    afterMetrics.flippedFaces === 0;

  const statusMessage = repaired
    ? `Repaired: 0 boundary edges, 0 non-manifold edges (${afterMetrics.triangleCount.toLocaleString('en-US')} facets, ${afterMetrics.volumeCm3.toFixed(3)} cm³).`
    : `Partial repair: ${afterMetrics.boundaryEdges} boundary edges, ${afterMetrics.nonManifoldEdges} non-manifold edges, and ${afterMetrics.flippedFaces} flipped faces remain.`;

  const binaryStl = exportBinaryStl(repairedTriangles);

  return {
    ok: true,
    repaired,
    statusMessage,
    before: beforeMetrics,
    after: afterMetrics,
    triangles: repairedTriangles,
    binaryStl,
  };
}

let manifoldWasmPromise: Promise<import('manifold-3d').ManifoldToplevel> | null = null;

async function getManifoldWasm(): Promise<import('manifold-3d').ManifoldToplevel> {
  if (!manifoldWasmPromise) {
    manifoldWasmPromise = (async () => {
      const mod = await import('manifold-3d');
      const g = globalThis as unknown as { process?: { versions?: { node?: string } } };
      const isNode = Boolean(g.process?.versions?.node);
      const instance = await mod.default(
        isNode ? undefined : { locateFile: () => '/wasm/manifold.wasm' }
      );
      instance.setup();
      return instance;
    })();
  }
  return manifoldWasmPromise;
}

/**
 * Repairs an STL mesh using the topological solver + manifold-3d WASM kernel verification/merging.
 */
export async function repairStlWithManifoldWasm(
  input: ArrayBuffer | Uint8Array | string | Triangle[]
): Promise<StlRepairResult> {
  const baseRepair = repairStl(input);
  if (!baseRepair.ok) return baseRepair;

  try {
    const wasm = await getManifoldWasm();
    const tris = baseRepair.triangles;
    const vertProperties = new Float32Array(tris.length * 9);
    const triVerts = new Uint32Array(tris.length * 3);

    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      const baseV = i * 9;
      vertProperties[baseV] = t.v0.x;
      vertProperties[baseV + 1] = t.v0.y;
      vertProperties[baseV + 2] = t.v0.z;
      vertProperties[baseV + 3] = t.v1.x;
      vertProperties[baseV + 4] = t.v1.y;
      vertProperties[baseV + 5] = t.v1.z;
      vertProperties[baseV + 6] = t.v2.x;
      vertProperties[baseV + 7] = t.v2.y;
      vertProperties[baseV + 8] = t.v2.z;

      const baseT = i * 3;
      triVerts[baseT] = i * 3;
      triVerts[baseT + 1] = i * 3 + 1;
      triVerts[baseT + 2] = i * 3 + 2;
    }

    const mesh = new wasm.Mesh({
      numProp: 3,
      vertProperties,
      triVerts,
    });
    mesh.merge();

    const manifold = new wasm.Manifold(mesh);
    const statusVal = manifold.status() as unknown;
    if ((statusVal === 0 || statusVal === 'NoError') && manifold.numTri() > 0) {
      const outMesh = manifold.getMesh();
      const outTris: Triangle[] = [];
      const numTri = outMesh.numTri;
      for (let i = 0; i < numTri; i++) {
        const iv = outMesh.verts(i);
        const p0 = outMesh.position(iv[0]);
        const p1 = outMesh.position(iv[1]);
        const p2 = outMesh.position(iv[2]);
        const v0 = { x: p0[0], y: p0[1], z: p0[2] };
        const v1 = { x: p1[0], y: p1[1], z: p1[2] };
        const v2 = { x: p2[0], y: p2[1], z: p2[2] };
        const { normal } = computeNormal(v0, v1, v2);
        outTris.push({ v0, v1, v2, normal });
      }
      manifold.delete();
      const afterMetrics = auditTriangles(outTris, 'binary');
      const binaryStl = exportBinaryStl(outTris);
      const repaired =
        afterMetrics.boundaryEdges === 0 &&
        afterMetrics.nonManifoldEdges === 0 &&
        afterMetrics.flippedFaces === 0;
      return {
        ok: true,
        repaired,
        statusMessage: repaired
          ? `Repaired via manifold-3d WASM: 0 boundary edges, 0 non-manifold edges (${afterMetrics.triangleCount.toLocaleString('en-US')} facets, ${afterMetrics.volumeCm3.toFixed(3)} cm³).`
          : baseRepair.statusMessage,
        before: baseRepair.before,
        after: afterMetrics,
        triangles: outTris,
        binaryStl,
      };
    }
    manifold.delete();
  } catch {
    // Fall back to baseRepair if WASM fails to initialize in restricted environment
  }

  return baseRepair;
}
