/**
 * Mesh format conversions used by the converter pages:
 *   3MF → STL, STL → 3MF, and STL ASCII ↔ binary.
 *
 * Each function is pure (bytes in, bytes + metrics out) so it can run in the
 * convert worker or directly on the main thread as a fallback.
 */
import { auditTriangles, exportAsciiStl, exportBinaryStl, parseStl, type StlAuditMetrics } from './stl';
import { export3mf, parse3mf, type ThreeMfParseInfo, type ThreeMfUnit } from './threemf';
import { parseObj, type ObjParseInfo, type ObjUnit } from './obj';
import type { Triangle } from './stl';

export type StlEncoding = 'binary' | 'ascii';

export interface ConversionSummary {
  inputBytes: number;
  outputBytes: number;
  triangleCount: number;
  metrics: StlAuditMetrics;
  logs: string[];
}

export type ConvertErrorCode = 'empty' | 'corrupt' | 'no_geometry';

export type ThreeMfToStlResult =
  | (ConversionSummary & {
      ok: true;
      outputFormat: StlEncoding;
      binaryStl?: ArrayBuffer;
      asciiStl?: string;
      info: ThreeMfParseInfo;
    })
  | { ok: false; errorCode: ConvertErrorCode; error: string };

export interface ThreeMfToStlOptions {
  outputFormat?: StlEncoding;
}

export function convert3mfToStl(
  input: ArrayBuffer | Uint8Array,
  options: ThreeMfToStlOptions = {}
): ThreeMfToStlResult {
  const outputFormat: StlEncoding = options.outputFormat === 'ascii' ? 'ascii' : 'binary';
  const parsed = parse3mf(input);
  if (!parsed.ok) return parsed;

  const metrics = auditTriangles(parsed.triangles, 'binary');
  const logs = [
    `Model part: ${parsed.info.modelPartPath}`,
    `Units: ${parsed.info.unit} (×${parsed.info.scaleToMm} → mm)`,
    `Build items: ${parsed.info.buildItemCount}, mesh objects used: ${parsed.info.meshes.length}`,
    ...(parsed.info.application ? [`Written by: ${parsed.info.application}`] : []),
    ...(parsed.info.hasProductionExtension ? ['Production extension: multi-part package resolved'] : []),
    ...parsed.info.logs,
    `Triangles: ${parsed.triangles.length.toLocaleString()}${metrics.isWatertight ? ' (watertight)' : ` (${metrics.boundaryEdges} open edges)`}`,
  ];
  const inputBytes = input.byteLength;

  if (outputFormat === 'ascii') {
    const asciiStl = exportAsciiStl(parsed.triangles, 'meshkit_3mf_export');
    return {
      ok: true,
      outputFormat,
      asciiStl,
      info: parsed.info,
      inputBytes,
      outputBytes: new TextEncoder().encode(asciiStl).byteLength,
      triangleCount: parsed.triangles.length,
      metrics,
      logs,
    };
  }
  const binaryStl = exportBinaryStl(parsed.triangles);
  return {
    ok: true,
    outputFormat,
    binaryStl,
    info: parsed.info,
    inputBytes,
    outputBytes: binaryStl.byteLength,
    triangleCount: parsed.triangles.length,
    metrics,
    logs,
  };
}

export type StlTo3mfResult =
  | (ConversionSummary & {
      ok: true;
      threeMf: Uint8Array;
      inputFormat: StlEncoding;
      vertexCount: number;
    })
  | { ok: false; errorCode: ConvertErrorCode; error: string };

export interface StlTo3mfOptions {
  name?: string;
  unit?: ThreeMfUnit;
}

export function convertStlTo3mf(
  input: ArrayBuffer | Uint8Array | string,
  options: StlTo3mfOptions = {}
): StlTo3mfResult {
  const parsed = parseStl(input);
  if (!parsed.ok) return parsed;

  const metrics = auditTriangles(parsed.triangles, parsed.format);
  const exported = export3mf(parsed.triangles, { name: options.name, unit: options.unit ?? 'millimeter' });
  const inputBytes =
    typeof input === 'string' ? new TextEncoder().encode(input).byteLength : input.byteLength;
  const logs = [
    `Input: ${parsed.format.toUpperCase()} STL, ${parsed.triangles.length.toLocaleString()} facets`,
    `Welded ${(parsed.triangles.length * 3).toLocaleString()} corner vertices → ${exported.vertexCount.toLocaleString()} unique vertices`,
    `Dropped ${(parsed.triangles.length - exported.triangleCount).toLocaleString()} degenerate triangles`,
    `Wrote 3D/3dmodel.model (unit="${options.unit ?? 'millimeter'}"), [Content_Types].xml, _rels/.rels`,
    metrics.isWatertight
      ? 'Mesh is watertight (0 open edges)'
      : `Mesh has ${metrics.boundaryEdges} open edges — slicers may still load it; run STL Repair first for a clean solid`,
  ];
  return {
    ok: true,
    threeMf: exported.bytes,
    inputFormat: parsed.format,
    vertexCount: exported.vertexCount,
    inputBytes,
    outputBytes: exported.bytes.byteLength,
    triangleCount: exported.triangleCount,
    metrics,
    logs,
  };
}

export type StlEncodingResult =
  | (ConversionSummary & {
      ok: true;
      inputFormat: StlEncoding;
      outputFormat: StlEncoding;
      binaryStl?: ArrayBuffer;
      asciiStl?: string;
      /** Output size divided by input size. */
      sizeRatio: number;
    })
  | { ok: false; errorCode: ConvertErrorCode; error: string };

export interface StlEncodingOptions {
  /** `auto` picks the opposite of the input encoding. */
  target?: StlEncoding | 'auto';
  solidName?: string;
}

export function convertStlEncoding(
  input: ArrayBuffer | Uint8Array | string,
  options: StlEncodingOptions = {}
): StlEncodingResult {
  const parsed = parseStl(input);
  if (!parsed.ok) return parsed;

  const inputFormat = parsed.format;
  const target = options.target ?? 'auto';
  const outputFormat: StlEncoding =
    target === 'auto' ? (inputFormat === 'binary' ? 'ascii' : 'binary') : target;
  const metrics = auditTriangles(parsed.triangles, inputFormat);
  const inputBytes =
    typeof input === 'string' ? new TextEncoder().encode(input).byteLength : input.byteLength;
  const n = parsed.triangles.length;

  const base = {
    ok: true as const,
    inputFormat,
    outputFormat,
    inputBytes,
    triangleCount: n,
    metrics,
  };

  if (outputFormat === 'ascii') {
    const asciiStl = exportAsciiStl(parsed.triangles, options.solidName ?? 'meshkit_export');
    const outputBytes = new TextEncoder().encode(asciiStl).byteLength;
    return {
      ...base,
      asciiStl,
      outputBytes,
      sizeRatio: outputBytes / inputBytes,
      logs: [
        `Input detected as ${inputFormat.toUpperCase()} STL (${n.toLocaleString()} facets)`,
        `Wrote ASCII STL: facet normal / outer loop / vertex blocks, 6-digit exponent notation`,
        `Size ${inputBytes.toLocaleString()} → ${outputBytes.toLocaleString()} bytes (×${(outputBytes / inputBytes).toFixed(2)})`,
      ],
    };
  }

  const binaryStl = exportBinaryStl(parsed.triangles);
  const outputBytes = binaryStl.byteLength;
  return {
    ...base,
    binaryStl,
    outputBytes,
    sizeRatio: outputBytes / inputBytes,
    logs: [
      `Input detected as ${inputFormat.toUpperCase()} STL (${n.toLocaleString()} facets)`,
      `Wrote binary STL: 80-byte header + uint32 count + ${n.toLocaleString()} × 50-byte records = ${outputBytes.toLocaleString()} bytes`,
      `Size ${inputBytes.toLocaleString()} → ${outputBytes.toLocaleString()} bytes (×${(outputBytes / inputBytes).toFixed(2)})`,
    ],
  };
}

// ---------------------------------------------------------------------------
// OBJ → STL
// ---------------------------------------------------------------------------

export type ObjToStlResult =
  | (ConversionSummary & {
      ok: true;
      outputFormat: StlEncoding;
      binaryStl?: ArrayBuffer;
      asciiStl?: string;
      info: ObjParseInfo;
    })
  | { ok: false; errorCode: ConvertErrorCode; error: string };

export interface ObjToStlOptions {
  outputFormat?: StlEncoding;
  unit?: ObjUnit;
  yUpToZUp?: boolean;
}

export function convertObjToStl(input: ArrayBuffer | Uint8Array | string, options: ObjToStlOptions = {}): ObjToStlResult {
  const outputFormat: StlEncoding = options.outputFormat === 'ascii' ? 'ascii' : 'binary';
  const parsed = parseObj(input, { unit: options.unit, yUpToZUp: options.yUpToZUp });
  if (!parsed.ok) return parsed;

  const metrics = auditTriangles(parsed.triangles, 'ascii');
  const inputBytes = typeof input === 'string' ? new TextEncoder().encode(input).byteLength : input.byteLength;
  const logs = [
    ...parsed.info.logs,
    `Triangles: ${parsed.triangles.length.toLocaleString()}${metrics.isWatertight ? ' (watertight)' : ` (${metrics.boundaryEdges} open edges)`}`,
    ...(metrics.isInsideOut ? ['Signed volume is negative — faces are wound inward; run STL Repair to flip them'] : []),
  ];

  if (outputFormat === 'ascii') {
    const asciiStl = exportAsciiStl(parsed.triangles, 'meshkit_obj_export');
    return { ok: true, outputFormat, asciiStl, info: parsed.info, inputBytes, outputBytes: new TextEncoder().encode(asciiStl).byteLength, triangleCount: parsed.triangles.length, metrics, logs };
  }
  const binaryStl = exportBinaryStl(parsed.triangles);
  return { ok: true, outputFormat, binaryStl, info: parsed.info, inputBytes, outputBytes: binaryStl.byteLength, triangleCount: parsed.triangles.length, metrics, logs };
}

// ---------------------------------------------------------------------------
// Viewer: load STL / 3MF / OBJ into triangles by extension sniffing
// ---------------------------------------------------------------------------

export type MeshKind = 'stl' | '3mf' | 'obj';

export type LoadMeshResult =
  | { ok: true; kind: MeshKind; triangles: Triangle[]; metrics: StlAuditMetrics; logs: string[]; inputBytes: number }
  | { ok: false; errorCode: ConvertErrorCode; error: string };

export function detectMeshKind(filename: string, bytes: Uint8Array): MeshKind {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  if (ext === '.3mf') return '3mf';
  if (ext === '.obj') return 'obj';
  if (ext === '.stl') return 'stl';
  // Sniff: zip magic → 3mf; otherwise STL.
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return '3mf';
  return 'stl';
}

export function loadMesh(filename: string, input: ArrayBuffer | Uint8Array): LoadMeshResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const kind = detectMeshKind(filename, bytes);
  if (kind === '3mf') {
    const r = parse3mf(bytes);
    if (!r.ok) return r;
    const metrics = auditTriangles(r.triangles, 'binary');
    return { ok: true, kind, triangles: r.triangles, metrics, inputBytes: bytes.byteLength, logs: [`3MF: ${r.info.meshes.length} mesh object(s), unit ${r.info.unit}`, ...r.info.logs] };
  }
  if (kind === 'obj') {
    const r = parseObj(bytes);
    if (!r.ok) return r;
    const metrics = auditTriangles(r.triangles, 'ascii');
    return { ok: true, kind, triangles: r.triangles, metrics, inputBytes: bytes.byteLength, logs: r.info.logs };
  }
  const r = parseStl(bytes);
  if (!r.ok) return r;
  const metrics = auditTriangles(r.triangles, r.format);
  return { ok: true, kind, triangles: r.triangles, metrics, inputBytes: bytes.byteLength, logs: [`${r.format.toUpperCase()} STL, ${r.triangles.length.toLocaleString()} facets`] };
}
