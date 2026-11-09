/**
 * Generates public/samples/calibration-cube-and-boss.3mf — a two-object,
 * component-based 3MF (20 mm cube + Ø12 × 8 mm cylinder boss on top) that
 * exercises build-item transforms the way slicer exports do.
 *
 * Run: npx tsx scripts/make-sample-3mf.ts   (or node --import tsx)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';

function cubeMesh(size: number): { vertices: number[][]; triangles: number[][] } {
  const s = size;
  const vertices = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ];
  const triangles = [
    [0, 2, 1], [0, 3, 2], // bottom (−Z)
    [4, 5, 6], [4, 6, 7], // top (+Z)
    [0, 1, 5], [0, 5, 4], // front (−Y)
    [1, 2, 6], [1, 6, 5], // right (+X)
    [2, 3, 7], [2, 7, 6], // back (+Y)
    [3, 0, 4], [3, 4, 7], // left (−X)
  ];
  return { vertices, triangles };
}

function cylinderMesh(radius: number, height: number, segments: number): { vertices: number[][]; triangles: number[][] } {
  const vertices: number[][] = [];
  const triangles: number[][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    vertices.push([radius * Math.cos(a), radius * Math.sin(a), 0]);
    vertices.push([radius * Math.cos(a), radius * Math.sin(a), height]);
  }
  const bottomCenter = vertices.length;
  vertices.push([0, 0, 0]);
  const topCenter = vertices.length;
  vertices.push([0, 0, height]);
  for (let i = 0; i < segments; i++) {
    const b0 = i * 2;
    const t0 = i * 2 + 1;
    const b1 = ((i + 1) % segments) * 2;
    const t1 = ((i + 1) % segments) * 2 + 1;
    triangles.push([b0, b1, t1], [b0, t1, t0]); // side, outward
    triangles.push([bottomCenter, b1, b0]); // bottom cap faces −Z
    triangles.push([topCenter, t0, t1]); // top cap faces +Z
  }
  return { vertices, triangles };
}

function meshXml(id: number, name: string, mesh: { vertices: number[][]; triangles: number[][] }): string {
  const fmt = (n: number) => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(4).replace(/\.?0+$/, ''));
  return (
    `  <object id="${id}" name="${name}" type="model">\n   <mesh>\n    <vertices>\n` +
    mesh.vertices.map(([x, y, z]) => `     <vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`).join('\n') +
    `\n    </vertices>\n    <triangles>\n` +
    mesh.triangles.map(([a, b, c]) => `     <triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('\n') +
    `\n    </triangles>\n   </mesh>\n  </object>\n`
  );
}

const model =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
  ` <metadata name="Title">MeshKit calibration cube with boss</metadata>\n` +
  ` <metadata name="Designer">MeshKit</metadata>\n` +
  ` <metadata name="Application">MeshKit sample generator</metadata>\n` +
  ` <resources>\n` +
  meshXml(1, 'Calibration cube 20 mm', cubeMesh(20)) +
  meshXml(2, 'Boss D12 x 8 mm', cylinderMesh(6, 8, 48)) +
  `  <object id="3" name="Cube with boss" type="model">\n   <components>\n` +
  `    <component objectid="1"/>\n` +
  `    <component objectid="2" transform="1 0 0 0 1 0 0 0 1 10 10 20"/>\n` +
  `   </components>\n  </object>\n` +
  ` </resources>\n` +
  ` <build>\n  <item objectid="3" transform="1 0 0 0 1 0 0 0 1 -10 -10 0"/>\n </build>\n` +
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
  ` <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n` +
  `</Relationships>\n`;

const bytes = zipSync(
  {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  },
  { level: 9 }
);

const out = resolve(process.cwd(), 'public/samples/calibration-cube-and-boss.3mf');
mkdirSync(resolve(process.cwd(), 'public/samples'), { recursive: true });
writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.byteLength} bytes)`);
