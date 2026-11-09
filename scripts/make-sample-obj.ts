/**
 * Generates public/samples/low-poly-vase.obj — a lathe-style vase with quad
 * side faces, triangle caps, normals, texcoords, an object name and a
 * material library reference, i.e. everything a typical OBJ export has.
 * Run: npx vite-node scripts/make-sample-obj.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEGMENTS = 24;
// (radius mm, height mm) profile from base to lip
const PROFILE: Array<[number, number]> = [
  [14, 0], [20, 6], [24, 16], [22, 28], [16, 40], [13, 50], [15, 58], [19, 64],
];

const lines: string[] = ['# MeshKit sample: low-poly vase', 'mtllib low-poly-vase.mtl', 'o LowPolyVase'];
const vertices: Array<[number, number, number]> = [];
for (const [r, h] of PROFILE) {
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    vertices.push([r * Math.cos(a), r * Math.sin(a), h]);
  }
}
vertices.push([0, 0, 0]); // bottom centre
const bottomCentre = vertices.length; // 1-based
for (const [x, y, z] of vertices) lines.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
lines.push('vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1');
lines.push('vn 0 0 -1', 'vn 0 0 1');
lines.push('usemtl clay', 's 1');

const ring = (k: number, i: number) => k * SEGMENTS + (i % SEGMENTS) + 1;
// side quads, outward-facing (counter-clockwise seen from outside)
for (let k = 0; k + 1 < PROFILE.length; k++) {
  for (let i = 0; i < SEGMENTS; i++) {
    lines.push(`f ${ring(k, i)}/1 ${ring(k, i + 1)}/2 ${ring(k + 1, i + 1)}/3 ${ring(k + 1, i)}/4`);
  }
}
// bottom cap triangles facing −Z
for (let i = 0; i < SEGMENTS; i++) {
  lines.push(`f ${bottomCentre}//1 ${ring(0, i + 1)}//1 ${ring(0, i)}//1`);
}
// open top (it's a vase) — leaves a boundary loop on purpose, so the
// "open edges" path of the audit is exercised too.

const out = resolve(process.cwd(), 'public/samples/low-poly-vase.obj');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out} (${vertices.length} vertices, ${lines.filter((l) => l.startsWith('f ')).length} faces)`);
