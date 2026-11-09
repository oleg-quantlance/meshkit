/**
 * 3MF (3D Manufacturing Format, ISO/ASTM 52915) read/write.
 *
 * A 3MF file is a ZIP (Open Packaging Conventions) containing an XML model
 * part, normally `3D/3dmodel.model`. The model holds `<object>`s with either
 * a `<mesh>` (vertices + triangles) or `<components>` that reference other
 * objects with a 3×4 affine transform. `<build><item>` says which objects
 * are actually on the plate, again with a transform.
 *
 * Slicer "project" 3MFs (Bambu Studio, Orca, PrusaSlicer) keep the plate in
 * `3dmodel.model` and each mesh in its own part under `3D/Objects/*.model`,
 * referenced through a component's `p:path` attribute (Production extension).
 * That is handled here too, because it is what people actually drag in.
 *
 * Everything runs on plain strings and typed arrays so it works inside a Web
 * Worker, where `DOMParser` does not exist. The XML scanner is deliberately
 * narrow: it understands exactly the elements the core spec defines for
 * geometry and ignores the rest (colors, materials, slicer metadata).
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { auditTriangles, type StlAuditMetrics, type Triangle, type Vec3 } from './stl';

export type ThreeMfUnit = 'micron' | 'millimeter' | 'centimeter' | 'inch' | 'foot' | 'meter';

const UNIT_TO_MM: Record<ThreeMfUnit, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

/** Row-major 3×4 affine matrix as written in 3MF: `m00 m01 m02 m10 … m30 m31 m32`. */
export type Transform3mf = [
  number, number, number,
  number, number, number,
  number, number, number,
  number, number, number,
];

export const IDENTITY_3MF: Transform3mf = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export interface ThreeMfMeshInfo {
  /** Object id inside its model part. */
  id: number;
  name: string;
  /** Model part path the object came from (e.g. `/3D/3dmodel.model`). */
  partPath: string;
  vertexCount: number;
  triangleCount: number;
}

export interface ThreeMfParseInfo {
  unit: ThreeMfUnit;
  scaleToMm: number;
  modelPartPath: string;
  buildItemCount: number;
  /** Objects whose geometry ended up in the output (after component expansion). */
  meshes: ThreeMfMeshInfo[];
  /** Slicer that wrote the file, when it says so in metadata. */
  application?: string;
  hasProductionExtension: boolean;
  logs: string[];
}

export type ThreeMfParseResult =
  | { ok: true; triangles: Triangle[]; info: ThreeMfParseInfo }
  | { ok: false; errorCode: 'empty' | 'corrupt' | 'no_geometry'; error: string };

// ---------------------------------------------------------------------------
// Minimal XML scanning helpers (no DOM in workers)
// ---------------------------------------------------------------------------

/** Parses `a="1" b='2'` attribute lists. Handles namespaced names like `p:path`. */
function parseAttributes(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagBody)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return attrs;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strips XML comments and CDATA so they can't confuse the scanner. */
function stripNoise(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
}

/**
 * Finds the body of the first `<name …> … </name>` element starting at `from`.
 * Returns null when the element is absent or self-closing.
 */
function findElement(
  xml: string,
  localName: string,
  from = 0
): { attrs: Record<string, string>; body: string; start: number; end: number } | null {
  const open = new RegExp(`<(?:[\\w.-]+:)?${localName}(\\s[^>]*)?>`, 'g');
  open.lastIndex = from;
  const m = open.exec(xml);
  if (!m) return null;
  const tagBody = m[1] ?? '';
  if (tagBody.trim().endsWith('/')) {
    return { attrs: parseAttributes(tagBody), body: '', start: m.index, end: open.lastIndex };
  }
  const close = new RegExp(`</(?:[\\w.-]+:)?${localName}\\s*>`, 'g');
  close.lastIndex = open.lastIndex;
  const c = close.exec(xml);
  if (!c) return null;
  return {
    attrs: parseAttributes(tagBody),
    body: xml.slice(open.lastIndex, c.index),
    start: m.index,
    end: close.lastIndex,
  };
}

/** Iterates every `<name …/>` or `<name …>…</name>` directly within `xml`. */
function* iterateElements(
  xml: string,
  localName: string
): Generator<{ attrs: Record<string, string>; body: string }> {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}(\\s[^>]*)?>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tagBody = m[1] ?? '';
    if (tagBody.trim().endsWith('/')) {
      yield { attrs: parseAttributes(tagBody), body: '' };
      continue;
    }
    const close = new RegExp(`</(?:[\\w.-]+:)?${localName}\\s*>`, 'g');
    close.lastIndex = re.lastIndex;
    const c = close.exec(xml);
    if (!c) return;
    yield { attrs: parseAttributes(tagBody), body: xml.slice(re.lastIndex, c.index) };
    re.lastIndex = close.lastIndex;
  }
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export function parseTransform(value: string | undefined): Transform3mf | null {
  if (!value) return IDENTITY_3MF;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 12 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts as Transform3mf;
}

/** 3MF applies the matrix as a row vector: p' = [x y z 1] · M. */
export function applyTransform(t: Transform3mf, v: Vec3): Vec3 {
  return {
    x: v.x * t[0] + v.y * t[3] + v.z * t[6] + t[9],
    y: v.x * t[1] + v.y * t[4] + v.z * t[7] + t[10],
    z: v.x * t[2] + v.y * t[5] + v.z * t[8] + t[11],
  };
}

/** Composes `inner` then `outer` (child transform first, then parent). */
export function composeTransforms(outer: Transform3mf, inner: Transform3mf): Transform3mf {
  const o = outer;
  const i = inner;
  const r = new Array<number>(12) as Transform3mf;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      r[row * 3 + col] = i[row * 3] * o[col] + i[row * 3 + 1] * o[3 + col] + i[row * 3 + 2] * o[6 + col];
    }
  }
  for (let col = 0; col < 3; col++) {
    r[9 + col] = i[9] * o[col] + i[10] * o[3 + col] + i[11] * o[6 + col] + o[9 + col];
  }
  return r;
}

export function transformDeterminant(t: Transform3mf): number {
  return (
    t[0] * (t[4] * t[8] - t[5] * t[7]) -
    t[1] * (t[3] * t[8] - t[5] * t[6]) +
    t[2] * (t[3] * t[7] - t[4] * t[6])
  );
}

// ---------------------------------------------------------------------------
// Package (ZIP) layer
// ---------------------------------------------------------------------------

interface PackageFiles {
  /** Keys normalised to a leading slash, forward slashes. */
  get(path: string): Uint8Array | undefined;
  keys(): string[];
}

function normalisePartPath(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  // Collapse `/3D/../3D/x` style references.
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return '/' + out.join('/');
}

function openPackage(bytes: Uint8Array): PackageFiles | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return null;
  }
  const map = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    map.set(normalisePartPath(name), data);
    // Some writers percent-encode spaces in part names.
    try {
      map.set(normalisePartPath(decodeURIComponent(name)), data);
    } catch {
      // ignore malformed escapes
    }
  }
  return {
    get: (path) => map.get(normalisePartPath(path)),
    keys: () => Array.from(new Set(map.keys())),
  };
}

const MODEL_REL_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

/** Locates the root model part via `_rels/.rels`, falling back to convention. */
function findModelPartPath(pkg: PackageFiles): string | null {
  const rels = pkg.get('/_rels/.rels');
  if (rels) {
    const xml = strFromU8(rels);
    for (const rel of iterateElements(xml, 'Relationship')) {
      if (rel.attrs.Type === MODEL_REL_TYPE && rel.attrs.Target) {
        const target = normalisePartPath(decodeXmlEntities(rel.attrs.Target));
        if (pkg.get(target)) return target;
      }
    }
  }
  if (pkg.get('/3D/3dmodel.model')) return '/3D/3dmodel.model';
  const anyModel = pkg.keys().find((k) => k.toLowerCase().endsWith('.model'));
  return anyModel ?? null;
}

// ---------------------------------------------------------------------------
// Model layer
// ---------------------------------------------------------------------------

interface MeshObject {
  kind: 'mesh';
  id: number;
  name: string;
  type: string;
  vertices: Vec3[];
  /** Flat index triples. */
  triangles: Uint32Array;
}

interface ComponentRef {
  objectId: number;
  /** Absolute part path when the Production extension points elsewhere. */
  partPath?: string;
  transform: Transform3mf;
}

interface ComponentObject {
  kind: 'components';
  id: number;
  name: string;
  type: string;
  components: ComponentRef[];
}

type ModelObject = MeshObject | ComponentObject;

interface ModelPart {
  path: string;
  unit: ThreeMfUnit;
  objects: Map<number, ModelObject>;
  buildItems: ComponentRef[];
  application?: string;
  hasProductionExtension: boolean;
  warnings: string[];
}

function parseUnit(value: string | undefined): ThreeMfUnit {
  const v = (value ?? 'millimeter').trim().toLowerCase();
  return (Object.keys(UNIT_TO_MM) as ThreeMfUnit[]).includes(v as ThreeMfUnit)
    ? (v as ThreeMfUnit)
    : 'millimeter';
}

function parseMesh(meshBody: string): { vertices: Vec3[]; triangles: Uint32Array } | null {
  const verticesEl = findElement(meshBody, 'vertices');
  const trianglesEl = findElement(meshBody, 'triangles');
  if (!verticesEl || !trianglesEl) return null;

  const vertices: Vec3[] = [];
  const vre = /<(?:[\w.-]+:)?vertex\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = vre.exec(verticesEl.body)) !== null) {
    const a = parseAttributes(m[1]);
    const x = Number(a.x);
    const y = Number(a.y);
    const z = Number(a.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    vertices.push({ x, y, z });
  }

  const indices: number[] = [];
  const tre = /<(?:[\w.-]+:)?triangle\b([^>]*)\/?>/g;
  while ((m = tre.exec(trianglesEl.body)) !== null) {
    const a = parseAttributes(m[1]);
    const v1 = Number(a.v1);
    const v2 = Number(a.v2);
    const v3 = Number(a.v3);
    if (
      !Number.isInteger(v1) || !Number.isInteger(v2) || !Number.isInteger(v3) ||
      v1 < 0 || v2 < 0 || v3 < 0 ||
      v1 >= vertices.length || v2 >= vertices.length || v3 >= vertices.length
    ) {
      return null;
    }
    indices.push(v1, v2, v3);
  }
  return { vertices, triangles: Uint32Array.from(indices) };
}

function parseModelPart(path: string, xml: string): ModelPart | null {
  const clean = stripNoise(xml);
  const modelEl = findElement(clean, 'model');
  if (!modelEl) return null;

  const part: ModelPart = {
    path,
    unit: parseUnit(modelEl.attrs.unit),
    objects: new Map(),
    buildItems: [],
    hasProductionExtension: /xmlns:p\s*=\s*["']http:\/\/schemas\.microsoft\.com\/3dmanufacturing\/production\//.test(
      modelEl.attrs ? clean.slice(modelEl.start, modelEl.start + 2000) : ''
    ),
    warnings: [],
  };

  for (const meta of iterateElements(modelEl.body, 'metadata')) {
    if (meta.attrs.name === 'Application' && meta.body.trim()) {
      part.application = decodeXmlEntities(meta.body.trim());
    }
  }

  const resourcesEl = findElement(modelEl.body, 'resources');
  if (resourcesEl) {
    for (const obj of iterateElements(resourcesEl.body, 'object')) {
      const id = Number(obj.attrs.id);
      if (!Number.isInteger(id)) continue;
      const name = decodeXmlEntities(obj.attrs.name ?? obj.attrs['p:name'] ?? '');
      const type = (obj.attrs.type ?? 'model').toLowerCase();

      const meshEl = findElement(obj.body, 'mesh');
      if (meshEl) {
        const mesh = parseMesh(meshEl.body);
        if (!mesh) {
          part.warnings.push(`Object ${id} has a malformed <mesh>; skipped.`);
          continue;
        }
        part.objects.set(id, { kind: 'mesh', id, name, type, ...mesh });
        continue;
      }

      const componentsEl = findElement(obj.body, 'components');
      if (componentsEl) {
        const components: ComponentRef[] = [];
        for (const comp of iterateElements(componentsEl.body, 'component')) {
          const objectId = Number(comp.attrs.objectid);
          const transform = parseTransform(comp.attrs.transform);
          if (!Number.isInteger(objectId) || !transform) {
            part.warnings.push(`Object ${id} has a malformed <component>; skipped.`);
            continue;
          }
          const rawPath = comp.attrs['p:path'] ?? comp.attrs.path;
          components.push({
            objectId,
            transform,
            partPath: rawPath ? normalisePartPath(decodeXmlEntities(rawPath)) : undefined,
          });
        }
        part.objects.set(id, { kind: 'components', id, name, type, components });
      }
    }
  }

  const buildEl = findElement(modelEl.body, 'build');
  if (buildEl) {
    for (const item of iterateElements(buildEl.body, 'item')) {
      const objectId = Number(item.attrs.objectid);
      const transform = parseTransform(item.attrs.transform);
      if (!Number.isInteger(objectId) || !transform) {
        part.warnings.push('A <build><item> is malformed; skipped.');
        continue;
      }
      const rawPath = item.attrs['p:path'] ?? item.attrs.path;
      part.buildItems.push({
        objectId,
        transform,
        partPath: rawPath ? normalisePartPath(decodeXmlEntities(rawPath)) : undefined,
      });
    }
  }

  return part;
}

// ---------------------------------------------------------------------------
// Public: parse
// ---------------------------------------------------------------------------

const MAX_COMPONENT_DEPTH = 32;

export function parse3mf(input: ArrayBuffer | Uint8Array): ThreeMfParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength === 0) {
    return { ok: false, errorCode: 'empty', error: 'This file is empty (0 bytes). Please choose another file.' };
  }
  // ZIP local file header magic "PK\x03\x04" (or empty archive "PK\x05\x06").
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return {
      ok: false,
      errorCode: 'corrupt',
      error: 'This is not a 3MF package: a .3mf file must be a ZIP archive containing 3D/3dmodel.model.',
    };
  }

  const pkg = openPackage(bytes);
  if (!pkg) {
    return { ok: false, errorCode: 'corrupt', error: 'The 3MF archive is damaged and could not be unzipped.' };
  }

  const rootPath = findModelPartPath(pkg);
  if (!rootPath) {
    return {
      ok: false,
      errorCode: 'no_geometry',
      error: 'No 3D model part found inside the archive (expected 3D/3dmodel.model).',
    };
  }

  const parts = new Map<string, ModelPart>();
  const logs: string[] = [];

  function loadPart(path: string): ModelPart | null {
    const cached = parts.get(path);
    if (cached) return cached;
    const data = pkg!.get(path);
    if (!data) return null;
    const part = parseModelPart(path, strFromU8(data));
    if (!part) return null;
    parts.set(path, part);
    logs.push(...part.warnings);
    return part;
  }

  const root = loadPart(rootPath);
  if (!root) {
    return { ok: false, errorCode: 'corrupt', error: `The model part ${rootPath} is not valid 3MF XML.` };
  }

  const scaleToMm = UNIT_TO_MM[root.unit];
  const triangles: Triangle[] = [];
  const meshesUsed = new Map<string, ThreeMfMeshInfo>();

  function emitMesh(part: ModelPart, obj: MeshObject, transform: Transform3mf): void {
    const unitScale = UNIT_TO_MM[part.unit];
    const flip = transformDeterminant(transform) < 0;
    const pts = obj.vertices.map((v) => {
      const p = applyTransform(transform, v);
      return { x: p.x * unitScale, y: p.y * unitScale, z: p.z * unitScale };
    });
    const idx = obj.triangles;
    for (let i = 0; i < idx.length; i += 3) {
      const a = pts[idx[i]];
      const b = pts[idx[i + 1]];
      const c = pts[idx[i + 2]];
      triangles.push(flip ? { v0: a, v1: c, v2: b } : { v0: a, v1: b, v2: c });
    }
    const key = `${part.path}#${obj.id}`;
    if (!meshesUsed.has(key)) {
      meshesUsed.set(key, {
        id: obj.id,
        name: obj.name,
        partPath: part.path,
        vertexCount: obj.vertices.length,
        triangleCount: idx.length / 3,
      });
    }
  }

  function emitObject(part: ModelPart, objectId: number, transform: Transform3mf, depth: number): void {
    if (depth > MAX_COMPONENT_DEPTH) {
      logs.push(`Component nesting deeper than ${MAX_COMPONENT_DEPTH} at object ${objectId}; stopped.`);
      return;
    }
    const obj = part.objects.get(objectId);
    if (!obj) {
      logs.push(`Object ${objectId} referenced in ${part.path} does not exist; skipped.`);
      return;
    }
    if (obj.type === 'support' || obj.type === 'surface') {
      logs.push(`Object ${objectId} (${obj.type}) is not printable geometry; skipped.`);
      return;
    }
    if (obj.kind === 'mesh') {
      emitMesh(part, obj, transform);
      return;
    }
    for (const comp of obj.components) {
      const targetPart = comp.partPath ? loadPart(comp.partPath) : part;
      if (!targetPart) {
        logs.push(`Component part ${comp.partPath} is missing from the archive; skipped.`);
        continue;
      }
      emitObject(targetPart, comp.objectId, composeTransforms(transform, comp.transform), depth + 1);
    }
  }

  if (root.buildItems.length > 0) {
    for (const item of root.buildItems) {
      const targetPart = item.partPath ? loadPart(item.partPath) : root;
      if (!targetPart) {
        logs.push(`Build item part ${item.partPath} is missing from the archive; skipped.`);
        continue;
      }
      emitObject(targetPart, item.objectId, item.transform, 0);
    }
  } else {
    // No <build>: fall back to every mesh object in the root part.
    logs.push('No <build> section; exporting every mesh object in the model.');
    for (const obj of root.objects.values()) {
      if (obj.kind === 'mesh') emitMesh(root, obj, IDENTITY_3MF);
    }
  }

  if (triangles.length === 0) {
    return {
      ok: false,
      errorCode: 'no_geometry',
      error: 'The 3MF package contains no printable mesh triangles (empty build or support-only objects).',
    };
  }

  const info: ThreeMfParseInfo = {
    unit: root.unit,
    scaleToMm,
    modelPartPath: rootPath,
    buildItemCount: root.buildItems.length,
    meshes: Array.from(meshesUsed.values()),
    application: root.application,
    hasProductionExtension: Array.from(parts.values()).some((p) => p.hasProductionExtension) || parts.size > 1,
    logs,
  };
  return { ok: true, triangles, info };
}

// ---------------------------------------------------------------------------
// Public: write
// ---------------------------------------------------------------------------

export interface Export3mfOptions {
  /** Object name written to `<object name>` and `<metadata name="Title">`. */
  name?: string;
  /** Unit attribute on `<model>`; coordinates are written as-is. */
  unit?: ThreeMfUnit;
  /** Weld coincident vertices (exact match after rounding to `precision` decimals). */
  precision?: number;
}

export interface Export3mfResult {
  bytes: Uint8Array;
  vertexCount: number;
  triangleCount: number;
}

function formatCoord(n: number, precision: number): string {
  const s = n.toFixed(precision);
  // Trim trailing zeros to keep the XML compact; keep "-0" from appearing.
  const trimmed = s.includes('.') ? s.replace(/\.?0+$/, '') : s;
  return trimmed === '-0' ? '0' : trimmed;
}

/**
 * Writes a minimal, spec-conformant 3MF package: content types, root
 * relationship, and one model part with a single welded mesh object.
 */
export function export3mf(triangles: Triangle[], options: Export3mfOptions = {}): Export3mfResult {
  const precision = options.precision ?? 6;
  const unit = options.unit ?? 'millimeter';
  const name = options.name?.trim() || 'MeshKit Export';

  const vertexIndex = new Map<string, number>();
  const vertexLines: string[] = [];
  const triangleLines: string[] = [];

  function indexOf(v: Vec3): number {
    const sx = formatCoord(v.x, precision);
    const sy = formatCoord(v.y, precision);
    const sz = formatCoord(v.z, precision);
    const key = `${sx} ${sy} ${sz}`;
    let idx = vertexIndex.get(key);
    if (idx === undefined) {
      idx = vertexLines.length;
      vertexIndex.set(key, idx);
      vertexLines.push(`<vertex x="${sx}" y="${sy}" z="${sz}"/>`);
    }
    return idx;
  }

  for (const t of triangles) {
    const a = indexOf(t.v0);
    const b = indexOf(t.v1);
    const c = indexOf(t.v2);
    if (a === b || b === c || a === c) continue; // degenerate after welding
    triangleLines.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
    ` <metadata name="Title">${escapeXml(name)}</metadata>\n` +
    ` <metadata name="Application">MeshKit (meshkit.pro)</metadata>\n` +
    ` <resources>\n` +
    `  <object id="1" name="${escapeXml(name)}" type="model">\n` +
    `   <mesh>\n` +
    `    <vertices>\n     ${vertexLines.join('\n     ')}\n    </vertices>\n` +
    `    <triangles>\n     ${triangleLines.join('\n     ')}\n    </triangles>\n` +
    `   </mesh>\n` +
    `  </object>\n` +
    ` </resources>\n` +
    ` <build>\n  <item objectid="1"/>\n </build>\n` +
    `</model>\n`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
    ` <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
    ` <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n` +
    `</Types>\n`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    ` <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="${MODEL_REL_TYPE}"/>\n` +
    `</Relationships>\n`;

  const bytes = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 }
  );

  return { bytes, vertexCount: vertexLines.length, triangleCount: triangleLines.length };
}

// ---------------------------------------------------------------------------
// Convenience: audit metrics for a parsed 3MF (reuses the STL auditor)
// ---------------------------------------------------------------------------

export function audit3mfTriangles(triangles: Triangle[]): StlAuditMetrics {
  return auditTriangles(triangles, 'binary');
}
