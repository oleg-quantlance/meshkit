import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8 } from 'fflate';
import { parseObj } from '../../src/core/obj';
import { auditTriangles, parseStl } from '../../src/core/stl';
import { convertObjToStl, detectMeshKind, loadMesh } from '../../src/core/convert';
import { export3mf } from '../../src/core/threemf';

const CUBE_STL = readFileSync(resolve(__dirname, '../fixtures/cube-10mm.stl'));

const CUBE_OBJ = `# unit cube, quads, with normals/texcoords/materials sprinkled in
mtllib cube.mtl
o Cube
v 0 0 0
v 10 0 0
v 10 10 0
v 0 10 0
v 0 0 10
v 10 0 10
v 10 10 10
v 0 10 10
vt 0 0
vn 0 0 1
usemtl red
s off
f 1 4 3 2
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;

describe('parseObj', () => {
  it('fan-triangulates quads into a watertight 10 mm cube and reports what it ignored', () => {
    const r = parseObj(CUBE_OBJ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.triangles).toHaveLength(12);
    expect(r.info).toMatchObject({ vertexCount: 8, faceCount: 6, polygonFaceCount: 6, objectCount: 1, hasNormals: true, hasTexCoords: true, materialLibs: ['cube.mtl'] });
    const m = auditTriangles(r.triangles);
    expect(m.volumeCm3).toBeCloseTo(1, 6);
    expect(m.isWatertight).toBe(true);
    expect(m.isInsideOut).toBe(false);
    expect(r.info.logs.join('\n')).toMatch(/Ignored vertex normals and texture coordinates/);
    expect(r.info.logs.join('\n')).toMatch(/material library: cube.mtl/);
  });

  it('handles negative (relative) indices, v/vt/vn corner syntax, continuation lines and comments', () => {
    const obj = [
      'v 0 0 0', 'v 1 0 0', 'v 0 1 0',
      'f -3/1/1 -2/2/1 \\', '  -1/3/1   # a comment after a continued face',
      'f 1//1 2//1 3//1',
    ].join('\n');
    const r = parseObj(obj);
    expect(r.ok && r.triangles.length).toBe(2);
  });

  it('scales by unit and can convert Y-up to Z-up', () => {
    const r = parseObj(CUBE_OBJ, { unit: 'inch' });
    expect(r.ok && auditTriangles(r.triangles).bboxMm.sizeX).toBeCloseTo(254);
    const y = parseObj('v 0 5 0\nv 1 5 0\nv 0 5 1\nf 1 2 3\n', { yUpToZUp: true });
    expect(y.ok).toBe(true);
    if (!y.ok) return;
    // y=5 becomes z=5; z=1 becomes y=-1
    expect(y.triangles[0].v0.z).toBe(5);
    expect(y.triangles[0].v2.y).toBe(-1);
  });

  it('skips bad faces but keeps going, and rejects files with no usable geometry', () => {
    const partial = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2\nf 1 2 9\nf 1 2 3\n');
    expect(partial.ok && partial.triangles.length).toBe(1);
    expect(partial.ok && partial.info.skippedFaces).toBe(2);

    expect(parseObj('')).toMatchObject({ ok: false, errorCode: 'empty' });
    expect(parseObj('v 0 0 0\nv 1 1 1\n')).toMatchObject({ ok: false, errorCode: 'no_geometry' });
    expect(parseObj('hello world\nnot an obj\n')).toMatchObject({ ok: false, errorCode: 'corrupt' });
    expect(parseObj('v 0 0 x\n')).toMatchObject({ ok: false, errorCode: 'corrupt' });
    expect(parseObj(new Uint8Array(CUBE_STL))).toMatchObject({ ok: false });
    expect(parseObj('\u0089PNG\r\n')).toMatchObject({ ok: false, errorCode: 'corrupt' });
    expect(parseObj(strToU8('PK\u0003\u0004zip'))).toMatchObject({ ok: false, errorCode: 'corrupt' });
  });

  it('counts groups and objects', () => {
    const r = parseObj('o a\ng g1\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\ng g2\no b\n');
    expect(r.ok && r.info.objectCount).toBe(2);
    expect(r.ok && r.info.groupCount).toBe(2);
    expect(r.ok && r.info.logs.join('\n')).toMatch(/Objects: 2, groups: 2/);
  });
});

describe('convertObjToStl', () => {
  it('writes binary and ASCII STL with metrics, and flags inside-out meshes', () => {
    const bin = convertObjToStl(CUBE_OBJ);
    expect(bin.ok).toBe(true);
    if (!bin.ok) return;
    expect(bin.binaryStl?.byteLength).toBe(84 + 50 * 12);
    expect(bin.metrics.isWatertight).toBe(true);
    const back = parseStl(bin.binaryStl!);
    expect(back.ok && back.triangles.length).toBe(12);

    const asc = convertObjToStl(CUBE_OBJ, { outputFormat: 'ascii', unit: 'centimeter' });
    expect(asc.ok && asc.asciiStl?.startsWith('solid meshkit_obj_export')).toBe(true);
    expect(asc.ok && asc.metrics.bboxMm.sizeX).toBeCloseTo(100);

    // reverse every face → inside out
    const inverted = CUBE_OBJ.replace(/^f (\d+) (\d+) (\d+) (\d+)$/gm, 'f $4 $3 $2 $1');
    const inv = convertObjToStl(inverted);
    expect(inv.ok && inv.logs.join('\n')).toMatch(/wound inward/);

    expect(convertObjToStl('')).toMatchObject({ ok: false, errorCode: 'empty' });
  });
});

describe('loadMesh (viewer entry point)', () => {
  it('detects the kind by extension, then by magic bytes', () => {
    expect(detectMeshKind('a.3MF', new Uint8Array(0))).toBe('3mf');
    expect(detectMeshKind('a.obj', new Uint8Array(0))).toBe('obj');
    expect(detectMeshKind('a.stl', new Uint8Array(0))).toBe('stl');
    expect(detectMeshKind('mystery', strToU8('PK\u0003\u0004'))).toBe('3mf');
    expect(detectMeshKind('mystery', strToU8('solid'))).toBe('stl');
  });

  it('loads STL, 3MF and OBJ to the same triangle/metrics shape', () => {
    const stl = loadMesh('cube.stl', new Uint8Array(CUBE_STL));
    expect(stl.ok && stl.kind).toBe('stl');
    expect(stl.ok && stl.triangles.length).toBe(12);

    const stlParsed = parseStl(new Uint8Array(CUBE_STL));
    const threeMf = export3mf(stlParsed.ok ? stlParsed.triangles : []).bytes;
    const r3 = loadMesh('cube.3mf', threeMf);
    expect(r3.ok && r3.kind).toBe('3mf');
    expect(r3.ok && r3.metrics.volumeCm3).toBeCloseTo(1, 5);
    expect(r3.ok && r3.logs[0]).toMatch(/3MF: 1 mesh object/);

    const obj = loadMesh('cube.obj', strToU8(CUBE_OBJ));
    expect(obj.ok && obj.kind).toBe('obj');
    expect(obj.ok && obj.triangles.length).toBe(12);

    expect(loadMesh('x.obj', new Uint8Array(0))).toMatchObject({ ok: false, errorCode: 'empty' });
    expect(loadMesh('x.3mf', strToU8('nope'))).toMatchObject({ ok: false, errorCode: 'corrupt' });
    expect(loadMesh('x.stl', new Uint8Array(0))).toMatchObject({ ok: false, errorCode: 'empty' });
  });
});
