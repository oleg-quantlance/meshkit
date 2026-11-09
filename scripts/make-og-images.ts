/**
 * Renders 1200×630 OG PNGs for the converter pages from the house SVG style.
 * Run: npx vite-node scripts/make-og-images.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const CARDS: Array<{ slug: string; title: string; sub: string }> = [
  { slug: '3mf-to-stl-converter', title: '3MF → STL CONVERTER', sub: 'Bambu · Orca · PrusaSlicer · Cura projects → one STL' },
  { slug: 'stl-to-3mf-converter', title: 'STL → 3MF CONVERTER', sub: 'Welded, compressed, unit-tagged 3MF packages' },
  { slug: 'stl-ascii-to-binary-converter', title: 'STL ASCII ↔ BINARY', sub: 'Auto-detect encoding · exact geometry · 4–6× smaller' },
  { slug: 'obj-to-stl-converter', title: 'OBJ → STL CONVERTER', sub: 'Quads & n-gons triangulated · units · Y-up fix' },
  { slug: 'stl-viewer-online', title: 'STL / 3MF / OBJ VIEWER', sub: 'WebGL orbit · dimensions · volume · watertight check' },
  { slug: 'embed', title: 'EMBED A COST CALCULATOR', sub: 'One script tag · 8 KB · no tracking · your prices' },
  { slug: 'stl-scale-units-fixer', title: 'STL SCALE & UNITS FIXER', sub: 'inch → mm · fit to size · Y-up → Z-up · drop to bed' },
  { slug: 'stl-simplifier-online', title: 'REDUCE STL FILE SIZE', sub: 'Quadric edge collapse · watertight · 2–20× smaller' },
];

function svg(title: string, sub: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#141413"/>
  <rect x="40" y="40" width="1120" height="550" fill="none" stroke="#E04F16" stroke-width="4"/>
  <rect x="80" y="80" width="76" height="76" fill="#E04F16"/>
  <text x="118" y="132" text-anchor="middle" fill="#FFFFFF" font-family="monospace" font-weight="700" font-size="38">MK</text>
  <text x="180" y="132" fill="#9E9D97" font-family="monospace" font-weight="600" font-size="26">MESHKIT // MESH CONVERTERS</text>
  <text x="80" y="290" fill="#FAF9F5" font-family="monospace" font-weight="700" font-size="60">${title}</text>
  <text x="80" y="350" fill="#9E9D97" font-family="sans-serif" font-size="30">${sub}</text>
  <text x="80" y="510" fill="#E04F16" font-family="monospace" font-weight="600" font-size="24">100% CLIENT-SIDE BROWSER EXECUTION · 0 BYTES UPLOADED</text>
</svg>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const card of CARDS) {
  await page.setContent(`<html><body style="margin:0">${svg(card.title, card.sub)}</body></html>`);
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  const out = resolve(process.cwd(), `public/og-images/${card.slug}.png`);
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.byteLength} bytes)`);
}
await browser.close();
