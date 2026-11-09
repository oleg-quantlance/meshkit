import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';
import {
  applyTransform,
  composeTransforms,
  export3mf,
  IDENTITY_3MF,
  parse3mf,
  parseTransform,
  transformDeterminant,
  type Transform3mf,
} from '../../src/core/threemf';
import { auditTriangles, parseStl, type Triangle } from '../../src/core/stl';
import { convert3mfToStl, convertStlEncoding, convertStlTo3mf } from '../../src/core/convert';

const CUBE_STL = readFileSync(resolve(__dirname, '../fixtures/cube-10mm.stl'));

function cubeTriangles(): Triangle[] {
  const parsed = parseStl(new Uint8Array(CUBE_STL));
  if (!parsed.ok) throw new Error('fixture failed to parse');
  return parsed.triangles;
}

/** Builds a 3MF package from raw part contents (paths without leading slash). */
function makePackage(parts: Record<string, string>, withRels = true): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(parts)) files[k] = strToU8(v);
  if (withRels && !files['_rels/.rels']) {
    files['_rels/.rels'] = strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`
    );
  }
  return zipSync(files);
}

const CUBE_MESH_XML = `
  <mesh>
    <vertices>
      <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="10" y="10" z="0"/><vertex x="0" y="10" z="0"/>
      <vertex x="0" y="0" z="10"/><vertex x="10" y="0" z="10"/><vertex x="10" y="10" z="10"/><vertex x="0" y="10" z="10"/>
    </vertices>
    <triangles>
      <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/>
      <triangle v1="4" v2="5" v3="6"/><triangle v1="4" v2="6" v3="7"/>
      <triangle v1="0" v2="1" v3="5"/><triangle v1="0" v2="5" v3="4"/>
      <triangle v1="1" v2="2" v3="6"/><triangle v1="1" v2="6" v3="5"/>
      <triangle v1="2" v2="3" v3="7"/><triangle v1="2" v2="7" v3="6"/>
      <triangle v1="3" v2="0" v3="4"/><triangle v1="3" v2="4" v3="7"/>
    </triangles>
  </mesh>`;

function modelXml(body: string, unit = 'millimeter', extraNs = ''): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${extraNs}>` +
    body +
    `</model>`
  );
}

describe('3MF transforms', () => {
  it('parses, applies and composes row-vector affine transforms', () => {
    expect(parseTransform(undefined)).toEqual(IDENTITY_3MF);
    expect(parseTransform('1 0 0 0 1 0 0 0 1 5 6 7')).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 6, 7]);
    expect(parseTransform('1 2 3')).toBeNull();
    expect(parseTransform('a b c d e f g h i j k l')).toBeNull();

    const translate: Transform3mf = [1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 6, 7];
    expect(applyTransform(translate, { x: 1, y: 1, z: 1 })).toEqual({ x: 6, y: 7, z: 8 });

    // 90° about Z: x→y, y→−x
    const rotZ: Transform3mf = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0];
    const r = applyTransform(rotZ, { x: 1, y: 0, z: 0 });
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);

    // compose(outer=translate, inner=rotZ) == rotate first, then translate
    const both = composeTransforms(translate, rotZ);
    const p = applyTransform(both, { x: 1, y: 0, z: 0 });
    const expected = applyTransform(translate, applyTransform(rotZ, { x: 1, y: 0, z: 0 }));
    expect(p.x).toBeCloseTo(expected.x);
    expect(p.y).toBeCloseTo(expected.y);
    expect(p.z).toBeCloseTo(expected.z);

    expect(transformDeterminant(IDENTITY_3MF)).toBe(1);
    expect(transformDeterminant([-1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])).toBe(-1);
  });
});

describe('parse3mf', () => {
  it('reads a core-spec single-mesh model with a build item', () => {
    const pkg = makePackage({
      '3D/3dmodel.model': modelXml(
        `<metadata name="Application">TestWriter 1.0</metadata>` +
          `<resources><object id="1" name="Cube" type="model">${CUBE_MESH_XML}</object></resources>` +
          `<build><item objectid="1"/></build>`
      ),
    });
    const res = parse3mf(pkg);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.triangles).toHaveLength(12);
    expect(res.info.unit).toBe('millimeter');
    expect(res.info.application).toBe('TestWriter 1.0');
    expect(res.info.buildItemCount).toBe(1);
    expect(res.info.meshes[0]).toMatchObject({ id: 1, name: 'Cube', vertexCount: 8, triangleCount: 12 });
    const m = auditTriangles(res.triangles);
    expect(m.volumeCm3).toBeCloseTo(1, 5);
    expect(m.isWatertight).toBe(true);
  });

  it('scales inch models to millimetres and composes component + item transforms', () => {
    const pkg = makePackage({
      '3D/3dmodel.model': modelXml(
        `<resources>` +
          `<object id="1" type="model">${CUBE_MESH_XML}</object>` +
          `<object id="2" type="model"><components>` +
          `<component objectid="1" transform="1 0 0 0 1 0 0 0 1 100 0 0"/>` +
          `<component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 100 0"/>` +
          `</components></object>` +
          `</resources>` +
          `<build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 50"/></build>`,
        'inch'
      ),
    });
    const res = parse3mf(pkg);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.triangles).toHaveLength(24);
    expect(res.info.scaleToMm).toBe(25.4);
    const m = auditTriangles(res.triangles);
    // Two 10-inch cubes: 2 × (254 mm)^3 = 2 × 16387.064 cm³
    expect(m.volumeCm3).toBeCloseTo(2 * 16387.064, 0);
    expect(m.bboxMm.minZ).toBeCloseTo(50 * 25.4, 3);
    expect(m.bboxMm.maxX).toBeCloseTo(110 * 25.4, 3);
  });

  it('flips winding under mirroring transforms so volume stays positive', () => {
    const pkg = makePackage({
      '3D/3dmodel.model': modelXml(
        `<resources><object id="1">${CUBE_MESH_XML}</object></resources>` +
          `<build><item objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/></build>`
      ),
    });
    const res = parse3mf(pkg);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const m = auditTriangles(res.triangles);
    expect(m.signedVolumeCm3).toBeGreaterThan(0);
    expect(m.isInsideOut).toBe(false);
    expect(m.bboxMm.minX).toBeCloseTo(-10);
  });

  it('resolves Bambu/Prusa style p:path sub-model parts and skips support objects', () => {
    const root = modelXml(
      `<resources>` +
        `<object id="2" type="model"><components>` +
        `<component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>` +
        `</components></object>` +
        `<object id="3" type="support">${CUBE_MESH_XML}</object>` +
        `</resources>` +
        `<build><item objectid="2"/><item objectid="3"/></build>`,
      'millimeter',
      ' xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"'
    );
    const sub = modelXml(`<resources><object id="1" name="Part" type="model">${CUBE_MESH_XML}</object></resources>`);
    const pkg = makePackage({ '3D/3dmodel.model': root, '3D/Objects/object_1.model': sub });
    const res = parse3mf(pkg);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.triangles).toHaveLength(12);
    expect(res.info.hasProductionExtension).toBe(true);
    expect(res.info.meshes[0].partPath).toBe('/3D/Objects/object_1.model');
    expect(res.info.logs.some((l) => /support/.test(l))).toBe(true);
    expect(auditTriangles(res.triangles).bboxMm.minX).toBeCloseTo(20);
  });

  it('falls back to every mesh when there is no <build>, and finds the part via .rels or convention', () => {
    const noBuild = makePackage({
      '3D/3dmodel.model': modelXml(
        `<resources><object id="1">${CUBE_MESH_XML}</object><object id="7">${CUBE_MESH_XML}</object></resources>`
      ),
    });
    const r1 = parse3mf(noBuild);
    expect(r1.ok && r1.triangles.length).toBe(24);

    const oddPath = makePackage(
      {
        'custom/plate.model': modelXml(
          `<resources><object id="1">${CUBE_MESH_XML}</object></resources><build><item objectid="1"/></build>`
        ),
        '_rels/.rels':
          `<Relationships><Relationship Target="custom/plate.model" Id="r1" ` +
          `Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
      },
      false
    );
    const r2 = parse3mf(oddPath);
    expect(r2.ok && r2.info.modelPartPath).toBe('/custom/plate.model');

    const noRels = makePackage(
      { 'weird/thing.model': modelXml(`<resources><object id="1">${CUBE_MESH_XML}</object></resources>`) },
      false
    );
    expect(parse3mf(noRels).ok).toBe(true);
  });

  it('rejects empty, non-zip, damaged, model-less and geometry-less packages with clear codes', () => {
    expect(parse3mf(new Uint8Array(0))).toMatchObject({ ok: false, errorCode: 'empty' });
    expect(parse3mf(strToU8('solid not a zip'))).toMatchObject({ ok: false, errorCode: 'corrupt' });

    const good = makePackage({ '3D/3dmodel.model': modelXml(`<resources/><build/>`) });
    const truncated = good.slice(0, Math.floor(good.length / 2));
    expect(parse3mf(truncated)).toMatchObject({ ok: false, errorCode: 'corrupt' });

    const noModel = zipSync({ 'readme.txt': strToU8('hi') });
    expect(parse3mf(noModel)).toMatchObject({ ok: false, errorCode: 'no_geometry' });

    const notXml = makePackage({ '3D/3dmodel.model': 'this is not xml' });
    expect(parse3mf(notXml)).toMatchObject({ ok: false, errorCode: 'corrupt' });

    const emptyBuild = makePackage({
      '3D/3dmodel.model': modelXml(`<resources><object id="1">${CUBE_MESH_XML}</object></resources><build><item objectid="9"/></build>`),
    });
    const r = parse3mf(emptyBuild);
    expect(r).toMatchObject({ ok: false, errorCode: 'no_geometry' });
  });

  it('skips malformed meshes, components and items but keeps the rest', () => {
    const pkg = makePackage({
      '3D/3dmodel.model': modelXml(
        `<resources>` +
          `<object id="1">${CUBE_MESH_XML}</object>` +
          `<object id="2"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="5" v3="9"/></triangles></mesh></object>` +
          `<object id="3"><components><component objectid="1" transform="1 2 3"/><component objectid="1"/></components></object>` +
          `<object id="4"><components><component objectid="1" p:path="/3D/missing.model"/></components></object>` +
          `</resources>` +
          `<build><item objectid="3"/><item objectid="2"/><item objectid="4"/><item objectid="x"/></build>`
      ),
    });
    const res = parse3mf(pkg);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.triangles).toHaveLength(12);
    expect(res.info.logs.join('\n')).toMatch(/malformed <mesh>/);
    expect(res.info.logs.join('\n')).toMatch(/malformed <component>/);
    expect(res.info.logs.join('\n')).toMatch(/missing from the archive/);
    expect(res.info.logs.join('\n')).toMatch(/does not exist/);
    expect(res.info.logs.join('\n')).toMatch(/<build><item> is malformed/);
  });

  it('stops runaway component recursion', () => {
    const pkg = makePackage({
      '3D/3dmodel.model': modelXml(
        `<resources><object id="1"><components><component objectid="1"/></components></object></resources>` +
          `<build><item objectid="1"/></build>`
      ),
    });
    const res = parse3mf(pkg);
    expect(res).toMatchObject({ ok: false, errorCode: 'no_geometry' });
  });
});

describe('export3mf and round trips', () => {
  it('writes a valid package that re-parses to the same geometry, welding shared vertices', () => {
    const tris = cubeTriangles();
    const out = export3mf(tris, { name: 'Cube <10mm> & "test"' });
    expect(out.vertexCount).toBe(8);
    expect(out.triangleCount).toBe(12);

    const files = unzipSync(out.bytes);
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('name="Cube &lt;10mm&gt; &amp; &quot;test&quot;"');
    expect(model).not.toMatch(/"-0"/);

    const back = parse3mf(out.bytes);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const before = auditTriangles(tris);
    const after = auditTriangles(back.triangles);
    expect(after.volumeCm3).toBeCloseTo(before.volumeCm3, 6);
    expect(after.isWatertight).toBe(true);
    expect(back.info.application).toContain('MeshKit');
  });

  it('drops triangles that collapse after welding', () => {
    const t: Triangle = {
      v0: { x: 0, y: 0, z: 0 },
      v1: { x: 0.0000001, y: 0, z: 0 },
      v2: { x: 1, y: 1, z: 0 },
    };
    const out = export3mf([t], { precision: 3 });
    expect(out.triangleCount).toBe(0);
  });
});

describe('convert façade', () => {
  it('3MF → binary and ASCII STL with logs and metrics', () => {
    const pkg = export3mf(cubeTriangles()).bytes;
    const bin = convert3mfToStl(pkg);
    expect(bin.ok).toBe(true);
    if (!bin.ok) return;
    expect(bin.outputFormat).toBe('binary');
    expect(bin.binaryStl?.byteLength).toBe(84 + 50 * 12);
    expect(bin.outputBytes).toBe(684);
    expect(bin.metrics.isWatertight).toBe(true);
    expect(bin.logs.join('\n')).toMatch(/Units: millimeter/);

    const asc = convert3mfToStl(pkg, { outputFormat: 'ascii' });
    expect(asc.ok && asc.asciiStl?.startsWith('solid meshkit_3mf_export')).toBe(true);
    expect(asc.ok && asc.outputBytes).toBeGreaterThan(684);

    expect(convert3mfToStl(new Uint8Array(0))).toMatchObject({ ok: false, errorCode: 'empty' });
  });

  it('STL → 3MF reports welding and watertightness; invalid STL passes the error through', () => {
    const res = convertStlTo3mf(new Uint8Array(CUBE_STL), { name: 'Cube' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.inputFormat).toMatch(/binary|ascii/);
    expect(res.vertexCount).toBe(8);
    expect(res.triangleCount).toBe(12);
    expect(res.logs.join('\n')).toMatch(/36 corner vertices → 8 unique/);
    expect(res.logs.join('\n')).toMatch(/watertight/);
    expect(parse3mf(res.threeMf).ok).toBe(true);

    const open = convertStlTo3mf(
      'solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n'
    );
    expect(open.ok && open.logs.join('\n')).toMatch(/open edges/);

    expect(convertStlTo3mf(new Uint8Array(0))).toMatchObject({ ok: false, errorCode: 'empty' });
  });

  it('STL encoding converts both directions, auto-detects, and reports size ratio', () => {
    const src = new Uint8Array(CUBE_STL);
    const auto = convertStlEncoding(src);
    expect(auto.ok).toBe(true);
    if (!auto.ok) return;
    expect(auto.outputFormat).not.toBe(auto.inputFormat);

    const toAscii = convertStlEncoding(src, { target: 'ascii', solidName: 'cube' });
    expect(toAscii.ok && toAscii.asciiStl?.startsWith('solid cube')).toBe(true);
    if (!toAscii.ok || !toAscii.asciiStl) return;

    const backToBinary = convertStlEncoding(toAscii.asciiStl, { target: 'binary' });
    expect(backToBinary.ok).toBe(true);
    if (!backToBinary.ok) return;
    expect(backToBinary.inputFormat).toBe('ascii');
    expect(backToBinary.outputFormat).toBe('binary');
    expect(backToBinary.binaryStl?.byteLength).toBe(684);
    expect(backToBinary.sizeRatio).toBeLessThan(1);
    expect(backToBinary.logs.join('\n')).toMatch(/80-byte header/);

    const same = convertStlEncoding(src, { target: 'binary' });
    expect(same.ok && same.outputFormat).toBe('binary');

    expect(convertStlEncoding('')).toMatchObject({ ok: false, errorCode: 'empty' });
  });
});
