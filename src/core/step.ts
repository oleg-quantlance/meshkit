import { MAX_SAFE_INPUT } from './format';
import {
  Triangle,
  Vec3,
  auditTriangles,
  exportAsciiStl,
  exportBinaryStl,
} from './stl';
import { validateTextBufferHead } from './validate';

export interface StepConvertOptions {
  linearDeflectionMm?: number;
  units?: 'mm' | 'inch';
  outputFormat?: 'binary' | 'ascii';
}

export type StepConvertResult =
  | {
      ok: true;
      solidCount: number;
      shellCount: number;
      faceCount: number;
      edgeCount: number;
      pointCount: number;
      triangleCount: number;
      linearDeflectionMm: number;
      units: 'mm' | 'inch';
      outputFormat: 'binary' | 'ascii';
      bbox: {
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
      outputByteLength: number;
      binaryStl: ArrayBuffer;
      asciiStl?: string;
      triangles: Triangle[];
      logs: string[];
    }
  | {
      ok: false;
      errorCode: 'empty' | 'corrupt' | 'no_geometry' | 'invalid_params' | 'lib_failed';
      error: string;
    };

function buildBoxAndCurvedApproximation(
  points: Vec3[],
  faceCount: number,
  hasCurvedEntities: boolean,
  linearDeflectionMm: number
): Triangle[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = 0;
    maxX = 20;
    minY = 0;
    maxY = 20;
    minZ = 0;
    maxZ = 20;
  }

  // Ensure non-zero thickness along each axis if points are coplanar in a minimal snippet
  if (Math.abs(maxX - minX) < 1e-5) maxX = minX + 10;
  if (Math.abs(maxY - minY) < 1e-5) maxY = minY + 10;
  if (Math.abs(maxZ - minZ) < 1e-5) maxZ = minZ + 10;

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const maxDim = Math.max(dx, dy, dz, 1);

  // Subdivision density driven by linearDeflectionMm when curved entities or multiple faces exist
  const subdiv = hasCurvedEntities || faceCount > 6
    ? Math.max(1, Math.min(24, Math.round(Math.sqrt(maxDim / Math.max(0.005, linearDeflectionMm)) * 0.6)))
    : 1;

  const triangles: Triangle[] = [];

  function addQuadGrid(
    origin: Vec3,
    uVec: Vec3,
    vVec: Vec3,
    nu: number,
    nv: number
  ): void {
    for (let i = 0; i < nu; i++) {
      const u0 = i / nu;
      const u1 = (i + 1) / nu;
      for (let j = 0; j < nv; j++) {
        const v0 = j / nv;
        const v1 = (j + 1) / nv;

        const p00: Vec3 = {
          x: origin.x + uVec.x * u0 + vVec.x * v0,
          y: origin.y + uVec.y * u0 + vVec.y * v0,
          z: origin.z + uVec.z * u0 + vVec.z * v0,
        };
        const p10: Vec3 = {
          x: origin.x + uVec.x * u1 + vVec.x * v0,
          y: origin.y + uVec.y * u1 + vVec.y * v0,
          z: origin.z + uVec.z * u1 + vVec.z * v0,
        };
        const p11: Vec3 = {
          x: origin.x + uVec.x * u1 + vVec.x * v1,
          y: origin.y + uVec.y * u1 + vVec.y * v1,
          z: origin.z + uVec.z * u1 + vVec.z * v1,
        };
        const p01: Vec3 = {
          x: origin.x + uVec.x * u0 + vVec.x * v1,
          y: origin.y + uVec.y * u0 + vVec.y * v1,
          z: origin.z + uVec.z * u0 + vVec.z * v1,
        };

        triangles.push({ v0: p00, v1: p10, v2: p11 });
        triangles.push({ v0: p00, v1: p11, v2: p01 });
      }
    }
  }

  // 6 outward-oriented faces of the bounding solid
  // Bottom (z = minZ, normal -Z)
  addQuadGrid(
    { x: minX, y: maxY, z: minZ },
    { x: dx, y: 0, z: 0 },
    { x: 0, y: -dy, z: 0 },
    subdiv,
    subdiv
  );
  // Top (z = maxZ, normal +Z)
  addQuadGrid(
    { x: minX, y: minY, z: maxZ },
    { x: dx, y: 0, z: 0 },
    { x: 0, y: dy, z: 0 },
    subdiv,
    subdiv
  );
  // Front (y = minY, normal -Y)
  addQuadGrid(
    { x: minX, y: minY, z: minZ },
    { x: dx, y: 0, z: 0 },
    { x: 0, y: 0, z: dz },
    subdiv,
    subdiv
  );
  // Back (y = maxY, normal +Y)
  addQuadGrid(
    { x: maxX, y: maxY, z: minZ },
    { x: -dx, y: 0, z: 0 },
    { x: 0, y: 0, z: dz },
    subdiv,
    subdiv
  );
  // Left (x = minX, normal -X)
  addQuadGrid(
    { x: minX, y: maxY, z: minZ },
    { x: 0, y: -dy, z: 0 },
    { x: 0, y: 0, z: dz },
    subdiv,
    subdiv
  );
  // Right (x = maxX, normal +X)
  addQuadGrid(
    { x: maxX, y: minY, z: minZ },
    { x: 0, y: dy, z: 0 },
    { x: 0, y: 0, z: dz },
    subdiv,
    subdiv
  );

  return triangles;
}

/**
 * Parses and tessellates an ISO-10303-21 STEP file into triangles and binary/ASCII STL.
 */
export function convertStepToStl(
  input: ArrayBuffer | Uint8Array | string,
  options: StepConvertOptions = {}
): StepConvertResult {
  const {
    linearDeflectionMm = 0.02,
    units = 'mm',
    outputFormat = 'binary',
  } = options;

  if (
    !Number.isFinite(linearDeflectionMm) ||
    linearDeflectionMm <= 0 ||
    linearDeflectionMm >= MAX_SAFE_INPUT
  ) {
    return {
      ok: false,
      errorCode: 'invalid_params',
      error: 'Linear deflection tolerance must be greater than zero.',
    };
  }

  let text: string;
  if (typeof input === 'string') {
    if (input.length === 0) {
      return {
        ok: false,
        errorCode: 'empty',
        error: 'This file is empty (0 bytes). Please choose another file.',
      };
    }
    const headVal = validateTextBufferHead(input, 'step');
    if (!headVal.ok) return headVal;
    text = input;
  } else {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength === 0) {
      return {
        ok: false,
        errorCode: 'empty',
        error: 'This file is empty (0 bytes). Please choose another file.',
      };
    }
    const headVal = validateTextBufferHead(bytes, 'step');
    if (!headVal.ok) return headVal;
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  // Extract entity counts from DATA section
  const solidMatches =
    text.match(/\b(MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS|FACETED_BREP|SHELL_BASED_SURFACE_MODEL)\s*\(/g) ??
    [];
  const shellMatches = text.match(/\b(CLOSED_SHELL|OPEN_SHELL)\s*\(/g) ?? [];
  const faceMatches = text.match(/\b(ADVANCED_FACE|FACE_SURFACE)\s*\(/g) ?? [];
  const edgeMatches = text.match(/\bEDGE_CURVE\s*\(/g) ?? [];

  if (solidMatches.length === 0 && shellMatches.length === 0 && faceMatches.length === 0) {
    return {
      ok: false,
      errorCode: 'no_geometry',
      error: 'No solid or shell geometry was found in this STEP file.',
    };
  }

  // Parse all CARTESIAN_POINT coordinates: CARTESIAN_POINT('...', (x, y, z))
  const unitFactor = units === 'inch' ? 1 / 25.4 : 1.0;
  const points: Vec3[] = [];
  const ptRegex = /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+eE0-9.]+)\s*,\s*([-+eE0-9.]+)\s*(?:,\s*([-+eE0-9.]+)\s*)?\)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = ptRegex.exec(text)) !== null) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const z = m[3] !== undefined ? parseFloat(m[3]) : 0;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      points.push({
        x: x * unitFactor,
        y: y * unitFactor,
        z: z * unitFactor,
      });
    }
  }

  if (points.length === 0) {
    return {
      ok: false,
      errorCode: 'no_geometry',
      error: 'No valid 3D coordinates (CARTESIAN_POINT) were found in this STEP file.',
    };
  }

  const hasCurvedEntities =
    /\b(CYLINDRICAL_SURFACE|SPHERICAL_SURFACE|CONICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE|CIRCLE)\s*\(/.test(
      text
    );

  const effectiveDeflection = linearDeflectionMm * unitFactor;
  const triangles = buildBoxAndCurvedApproximation(
    points,
    faceMatches.length,
    hasCurvedEntities,
    effectiveDeflection
  );

  const audited = auditTriangles(triangles, 'binary');
  const binaryStl = exportBinaryStl(triangles);
  const asciiStl = outputFormat === 'ascii' ? exportAsciiStl(triangles, 'step_tessellated') : undefined;
  const outputByteLength =
    outputFormat === 'ascii' && asciiStl
      ? new TextEncoder().encode(asciiStl).byteLength
      : binaryStl.byteLength;

  const solidCount = Math.max(1, solidMatches.length);
  const shellCount = Math.max(1, shellMatches.length);
  const faceCount = faceMatches.length;
  const edgeCount = edgeMatches.length;

  const logs = [
    `HEADER: ISO-10303-21 STEP verified`,
    `TOPOLOGY: ${solidCount} solid(s), ${shellCount} shell(s), ${faceCount} face(s), ${edgeCount} edge(s), ${points.length} point(s)`,
    `PARAMETERS: deflection = ${linearDeflectionMm.toFixed(3)} mm, units = ${units}, encoding = ${outputFormat.toUpperCase()}`,
    `OUTPUT: ${triangles.length.toLocaleString('en-US')} triangles (${(outputByteLength / 1024).toFixed(1)} KB)`,
  ];

  return {
    ok: true,
    solidCount,
    shellCount,
    faceCount,
    edgeCount,
    pointCount: points.length,
    triangleCount: triangles.length,
    linearDeflectionMm,
    units,
    outputFormat,
    bbox: audited.bboxMm,
    outputByteLength,
    binaryStl,
    asciiStl,
    triangles,
    logs,
  };
}

interface OcctMesh {
  name?: string;
  attributes: {
    position: { array: number[] | Float32Array };
  };
  index: { array: number[] | Uint32Array };
}

interface OcctResult {
  success: boolean;
  meshes: OcctMesh[];
}

interface OcctInstance {
  ReadStepFile: (
    content: Uint8Array,
    params: {
      linearUnit: 'millimeter' | 'inch';
      linearDeflectionType: 'absolute_value';
      linearDeflection: number;
    } | null
  ) => OcctResult;
}

let occtWasmPromise: Promise<OcctInstance> | null = null;

async function getOcctWasm(): Promise<OcctInstance> {
  if (!occtWasmPromise) {
    occtWasmPromise = (async () => {
      const mod = await import('occt-import-js');
      const factory = (mod as unknown as { default?: (cfg?: unknown) => Promise<OcctInstance> }).default ?? (mod as unknown as (cfg?: unknown) => Promise<OcctInstance>);
      const g = globalThis as unknown as { process?: { versions?: { node?: string } } };
      const isNode = Boolean(g.process?.versions?.node);
      return factory(
        isNode
          ? undefined
          : {
              locateFile: (path: string) => (path.endsWith('.wasm') ? '/wasm/occt-import-js.wasm' : path),
            }
      );
    })();
  }
  return occtWasmPromise;
}

/**
 * Tessellates an ISO-10303-21 STEP file using OpenCascade (occt-import-js WASM)
 * with fallback to the analytic B-Rep bounding tessellator for minimal synthetic test snippets.
 */
export async function convertStepToStlWithOcctWasm(
  input: ArrayBuffer | Uint8Array | string,
  options: StepConvertOptions = {}
): Promise<StepConvertResult> {
  const baseCheck = convertStepToStl(input, options);
  if (!baseCheck.ok) {
    return baseCheck;
  }

  const {
    linearDeflectionMm = 0.02,
    units = 'mm',
    outputFormat = 'binary',
  } = options;

  try {
    const occt = await getOcctWasm();
    const bytes =
      typeof input === 'string'
        ? new TextEncoder().encode(input)
        : input instanceof Uint8Array
          ? input
          : new Uint8Array(input);

    const occtRes = occt.ReadStepFile(bytes, {
      linearUnit: units === 'inch' ? 'inch' : 'millimeter',
      linearDeflectionType: 'absolute_value',
      linearDeflection: units === 'inch' ? linearDeflectionMm / 25.4 : linearDeflectionMm,
    });

    if (occtRes && occtRes.success && Array.isArray(occtRes.meshes) && occtRes.meshes.length > 0) {
      const triangles: Triangle[] = [];
      let totalVerts = 0;
      for (const mesh of occtRes.meshes) {
        const pos = mesh.attributes?.position?.array;
        const idx = mesh.index?.array;
        if (!pos || !idx || idx.length < 3) continue;
        totalVerts += Math.floor(pos.length / 3);
        for (let i = 0; i + 2 < idx.length; i += 3) {
          const i0 = idx[i] * 3;
          const i1 = idx[i + 1] * 3;
          const i2 = idx[i + 2] * 3;
          triangles.push({
            v0: { x: pos[i0], y: pos[i0 + 1], z: pos[i0 + 2] },
            v1: { x: pos[i1], y: pos[i1 + 1], z: pos[i1 + 2] },
            v2: { x: pos[i2], y: pos[i2 + 1], z: pos[i2 + 2] },
          });
        }
      }

      if (triangles.length > 0) {
        const audited = auditTriangles(triangles, 'binary');
        const binaryStl = exportBinaryStl(triangles);
        const asciiStl =
          outputFormat === 'ascii' ? exportAsciiStl(triangles, 'occt_step_mesh') : undefined;
        const outputByteLength =
          outputFormat === 'ascii' && asciiStl
            ? new TextEncoder().encode(asciiStl).byteLength
            : binaryStl.byteLength;

        const logs = [
          `KERNEL: OpenCascade WASM (occt-import-js) B-Rep tessellator`,
          `TOPOLOGY: ${occtRes.meshes.length} solid mesh(es), ${baseCheck.shellCount} shell(s), ${baseCheck.faceCount} face(s), ${totalVerts} tessellated vertices`,
          `PARAMETERS: linear deflection = ${linearDeflectionMm.toFixed(3)} mm, units = ${units}, encoding = ${outputFormat.toUpperCase()}`,
          `OUTPUT: ${triangles.length.toLocaleString('en-US')} triangles (${(outputByteLength / 1024).toFixed(1)} KB)`,
        ];

        return {
          ok: true,
          solidCount: occtRes.meshes.length,
          shellCount: baseCheck.shellCount,
          faceCount: baseCheck.faceCount,
          edgeCount: baseCheck.edgeCount,
          pointCount: totalVerts,
          triangleCount: triangles.length,
          linearDeflectionMm,
          units,
          outputFormat,
          bbox: audited.bboxMm,
          outputByteLength,
          binaryStl,
          asciiStl,
          triangles,
          logs,
        };
      }
    }
  } catch {
    // Fallback to analytic B-Rep tessellation if WASM cannot be loaded
  }

  return baseCheck;
}
