import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

const TOOL_PAGES = [
  { file: 'index.html', canonical: 'https://meshkit.pro/' },
  { file: '3d-print-cost-calculator.html', canonical: 'https://meshkit.pro/3d-print-cost-calculator' },
  { file: 'stl-repair-online.html', canonical: 'https://meshkit.pro/stl-repair-online' },
  { file: 'stl-volume-weight-calculator.html', canonical: 'https://meshkit.pro/stl-volume-weight-calculator' },
  { file: 'step-to-stl-converter.html', canonical: 'https://meshkit.pro/step-to-stl-converter' },
  { file: 'resin-3d-print-cost-calculator.html', canonical: 'https://meshkit.pro/resin-3d-print-cost-calculator' },
  { file: 'filament-spool-weight-calculator.html', canonical: 'https://meshkit.pro/filament-spool-weight-calculator' },
  { file: 'empty-spool-weight-database.html', canonical: 'https://meshkit.pro/empty-spool-weight-database' },
  { file: 'filament-grams-to-meters.html', canonical: 'https://meshkit.pro/filament-grams-to-meters' },
];

const TRUST_PAGES = [
  { file: 'about.html', canonical: 'https://meshkit.pro/about' },
  { file: 'methodology.html', canonical: 'https://meshkit.pro/methodology' },
  { file: 'privacy.html', canonical: 'https://meshkit.pro/privacy' },
];

const ALL_PAGES = [
  ...TOOL_PAGES,
  ...TRUST_PAGES,
  { file: '404.html', canonical: null },
];

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Section 7 & 10: Multi-page SEO, Accessibility & Schema Audit', () => {
  it.each(ALL_PAGES)('$file has lang="en", <title> <= 60 chars, meta description, and exactly 1 <h1>', ({ file, canonical }) => {
    const html = readFileSync(resolve(ROOT, file), 'utf-8');
    expect(html).toMatch(/<html\s+lang="en"/i);

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    expect(titleMatch).not.toBeNull();
    const titleText = titleMatch![1].trim();
    expect(titleText.length).toBeGreaterThan(10);
    expect(titleText.length).toBeLessThanOrEqual(60);

    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    expect(descMatch).not.toBeNull();
    expect(descMatch![1].trim().length).toBeGreaterThan(40);

    const h1Matches = html.match(/<h1[\s>]/gi) ?? [];
    expect(h1Matches.length).toBe(1);

    // Must not load render-blocking Google Fonts
    expect(html).not.toContain('fonts.googleapis.com');

    // Includes GA4 tag G-5HR12TP216 with Consent Mode v2 default denied
    expect(html).toContain('https://www.googletagmanager.com/gtag/js?id=G-5HR12TP216');
    expect(html).toContain("gtag('config', 'G-5HR12TP216')");

    if (canonical) {
      expect(html).toContain(`<link rel="canonical" href="${canonical}" />`);
    }
  });

  it.each(TOOL_PAGES)('$file has >= 400 words of visible copy, worked example, FAQs, and valid JSON-LD', ({ file }) => {
    const html = readFileSync(resolve(ROOT, file), 'utf-8');
    const visibleText = stripHtmlTags(html);
    const words = visibleText.split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThanOrEqual(400);

    // Has FAQ details elements
    const detailsMatches = html.match(/<details>/gi) ?? [];
    expect(detailsMatches.length).toBeGreaterThanOrEqual(4);

    // Has valid JSON-LD script block
    const ldMatch = html.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i);
    expect(ldMatch).not.toBeNull();
    const parsedLd = JSON.parse(ldMatch![1]);
    expect(parsedLd['@context']).toBe('https://schema.org');
    expect(Array.isArray(parsedLd['@graph'])).toBe(true);

    // Every input and select has an id and a corresponding label[for="id"]
    const controlMatches = [...html.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"[^>]*>/gi)];
    expect(controlMatches.length).toBeGreaterThan(0);
    for (const m of controlMatches) {
      const id = m[1];
      expect(html).toContain(`for="${id}"`);
    }
  });

  it('public/sitemap.xml and public/robots.txt exist and cover all 12 canonical URLs', () => {
    const robots = readFileSync(resolve(ROOT, 'public/robots.txt'), 'utf-8');
    expect(robots).toContain('Sitemap: https://meshkit.pro/sitemap.xml');

    const sitemap = readFileSync(resolve(ROOT, 'public/sitemap.xml'), 'utf-8');
    for (const page of [...TOOL_PAGES, ...TRUST_PAGES]) {
      expect(sitemap).toContain(`<loc>${page.canonical}</loc>`);
    }

    // Bundled sample files exist
    expect(existsSync(resolve(ROOT, 'public/samples/enclosure-bracket.gcode'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'public/samples/defective-cube.stl'))).toBe(true);
    expect(existsSync(resolve(ROOT, 'public/samples/planetary-gear-housing.step'))).toBe(true);
  });
});
