/**
 * Wavefront OBJ reader — the geometry subset that matters for printing.
 *
 * Reads `v` and `f` records (polygons are fan-triangulated, negative indices
 * resolved relative to the vertex count so far), honours `o`/`g` only for
 * object counting, and ignores normals, texture coordinates, materials,
 * free-form curves/surfaces and everything else. OBJ has no units; callers
 * pick a scale (most CAD exports are mm, most game/scan assets are m or cm).
 */
import { auditTriangles, type StlAuditMetrics, type Triangle, type Vec3 } from './stl';

export type ObjUnit = 'millimeter' | 'centimeter' | 'meter' | 'inch';

export const OBJ_UNIT_TO_MM: Record<ObjUnit, number> = {
  millimeter: 1,
  centimeter: 10,
  meter: 1000,
  inch: 25.4,
};

export interface ObjParseInfo {
  vertexCount: number;
  faceCount: number;
  /** Faces with more than three corners, before fan triangulation. */
  polygonFaceCount: number;
  objectCount: number;
  groupCount: number;
  hasNormals: boolean;
  hasTexCoords: boolean;
  materialLibs: string[];
  skippedFaces: number;
  logs: string[];
}

export type ObjParseResult =
  | { ok: true; triangles: Triangle[]; info: ObjParseInfo }
  | { ok: false; errorCode: 'empty' | 'corrupt' | 'no_geometry'; error: string };

export interface ObjParseOptions {
  /** Multiply every coordinate by this unit's mm factor. Default millimeter (×1). */
  unit?: ObjUnit;
  /** Swap Y and Z (and negate the new Y) for Y-up assets so Z ends up vertical. */
  yUpToZUp?: boolean;
}

function toText(input: ArrayBuffer | Uint8Array | string): string {
  if (typeof input === 'string') return input;
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** Resolves an OBJ 1-based index (negative = relative) to a 0-based array index, or -1. */
function resolveIndex(raw: string, count: number): number {
  const slash = raw.indexOf('/');
  const token = slash >= 0 ? raw.slice(0, slash) : raw;
  const n = Number(token);
  if (!Number.isInteger(n) || n === 0) return -1;
  const idx = n > 0 ? n - 1 : count + n;
  return idx >= 0 && idx < count ? idx : -1;
}

export function parseObj(input: ArrayBuffer | Uint8Array | string, options: ObjParseOptions = {}): ObjParseResult {
  const text = toText(input);
  if (text.length === 0) {
    return { ok: false, errorCode: 'empty', error: 'This file is empty (0 bytes). Please choose another file.' };
  }
  if (text.charCodeAt(0) === 0 || text.startsWith('\u0089PNG') || text.startsWith('PK\u0003\u0004')) {
    return { ok: false, errorCode: 'corrupt', error: 'This file has an .obj name but is not a text Wavefront OBJ file.' };
  }

  const scale = OBJ_UNIT_TO_MM[options.unit ?? 'millimeter'];
  const swap = options.yUpToZUp === true;
  const vertices: Vec3[] = [];
  const triangles: Triangle[] = [];
  const info: ObjParseInfo = {
    vertexCount: 0,
    faceCount: 0,
    polygonFaceCount: 0,
    objectCount: 0,
    groupCount: 0,
    hasNormals: false,
    hasTexCoords: false,
    materialLibs: [],
    skippedFaces: 0,
    logs: [],
  };

  let sawAnyRecord = false;
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li];
    // Line continuation with trailing backslash.
    while (line.endsWith('\\') && li + 1 < lines.length) {
      line = line.slice(0, -1) + ' ' + lines[++li];
    }
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;

    const sp = line.indexOf(' ');
    const key = sp >= 0 ? line.slice(0, sp) : line;
    const rest = sp >= 0 ? line.slice(sp + 1).trim() : '';

    switch (key) {
      case 'v': {
        sawAnyRecord = true;
        const p = rest.split(/\s+/);
        const x = Number(p[0]);
        const y = Number(p[1]);
        const z = Number(p[2]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          return { ok: false, errorCode: 'corrupt', error: `Vertex on line ${li + 1} is not three numbers: "${lines[li].trim().slice(0, 60)}"` };
        }
        vertices.push(swap ? { x: x * scale, y: -z * scale, z: y * scale } : { x: x * scale, y: y * scale, z: z * scale });
        break;
      }
      case 'f': {
        sawAnyRecord = true;
        const corners = rest.split(/\s+/).filter(Boolean);
        if (corners.length < 3) {
          info.skippedFaces++;
          break;
        }
        const idx = corners.map((c) => resolveIndex(c, vertices.length));
        if (idx.some((i) => i < 0)) {
          info.skippedFaces++;
          break;
        }
        info.faceCount++;
        if (corners.length > 3) info.polygonFaceCount++;
        const a = vertices[idx[0]];
        for (let k = 1; k + 1 < idx.length; k++) {
          triangles.push({ v0: a, v1: vertices[idx[k]], v2: vertices[idx[k + 1]] });
        }
        break;
      }
      case 'vn':
        sawAnyRecord = true;
        info.hasNormals = true;
        break;
      case 'vt':
        sawAnyRecord = true;
        info.hasTexCoords = true;
        break;
      case 'o':
        info.objectCount++;
        break;
      case 'g':
        info.groupCount++;
        break;
      case 'mtllib':
        if (rest) info.materialLibs.push(rest);
        break;
      default:
        // usemtl, s, l, p, curv, surf, … are ignored on purpose.
        break;
    }
  }

  info.vertexCount = vertices.length;

  if (!sawAnyRecord) {
    return { ok: false, errorCode: 'corrupt', error: 'No OBJ records (v / f) found — this does not look like a Wavefront OBJ file.' };
  }
  if (triangles.length === 0) {
    return {
      ok: false,
      errorCode: 'no_geometry',
      error:
        vertices.length > 0
          ? `The file has ${vertices.length.toLocaleString()} vertices but no usable faces (point clouds and line-only OBJ files cannot be printed).`
          : 'The file contains no vertices or faces.',
    };
  }

  info.logs.push(`Vertices: ${vertices.length.toLocaleString()}, faces: ${info.faceCount.toLocaleString()} (${info.polygonFaceCount.toLocaleString()} polygons fan-triangulated)`);
  if (info.objectCount || info.groupCount) info.logs.push(`Objects: ${info.objectCount}, groups: ${info.groupCount} — merged into one mesh`);
  if (info.hasNormals || info.hasTexCoords) info.logs.push(`Ignored ${[info.hasNormals ? 'vertex normals' : '', info.hasTexCoords ? 'texture coordinates' : ''].filter(Boolean).join(' and ')} (STL stores neither)`);
  if (info.materialLibs.length) info.logs.push(`Ignored material library: ${info.materialLibs.join(', ')}`);
  if (info.skippedFaces) info.logs.push(`Skipped ${info.skippedFaces} face(s) with fewer than 3 corners or out-of-range indices`);
  info.logs.push(`Scale: ${options.unit ?? 'millimeter'} (×${scale} → mm)${swap ? ', Y-up converted to Z-up' : ''}`);

  return { ok: true, triangles, info };
}

export function auditObjTriangles(triangles: Triangle[]): StlAuditMetrics {
  return auditTriangles(triangles, 'ascii');
}
