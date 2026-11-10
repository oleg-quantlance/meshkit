#!/usr/bin/env node
// Render the Etsy PDF deliverables (tools/etsy/docs/*.html) to tools/etsy/dist/
// with headless Chromium via Playwright.
//
// Usage:
//   node tools/etsy/docs/render.mjs [--sheets-link <url>] [--only <name>] [--screenshots]
//
//   --sheets-link   URL substituted for every {{SHEETS_LINK}} placeholder.
//   --only          Render a single document by its dist basename (substring match).
//   --screenshots   Also write a PNG per page into dist/screenshots/ (layout checking).
//
// The Playwright install and Chromium binary are borrowed from a sibling project
// so this repo does not have to add a dev dependency for a one-off doc build.

import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((n) => n.startsWith('chromium-')).sort().reverse()) {
      const p = join(cache, d, 'chrome-linux64', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}
const CHROME = findChromium();

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '..', 'dist');
const shotDir = join(distDir, 'screenshots');

const VERSION = '1.0';
const DATE = new Date().toISOString().slice(0, 10);
const MARGIN = { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' };
// Max usable sheet height in CSS px at 10 mm margins: Letter is the shorter page
// (279.4 mm - 20 mm = 259.4 mm). common.css budgets 255 mm per .sheet.
const SHEET_LIMIT_PX = (255 / 25.4) * 96;

const docs = [
  {
    src: 'cheat-sheets.html',
    out: 'MeshKit-3D-Printing-Cheat-Sheets-v1.0',
    formats: ['Letter', 'A4'],
  },
  { src: 'readme-pricing.html', key: 'pricing', out: 'MeshKit-3D-Print-Pricing-Calculator-Read-Me-First', formats: ['Letter'] },
  { src: 'readme-tracker.html', key: 'tracker', out: 'MeshKit-Filament-Inventory-Tracker-Read-Me-First', formats: ['Letter'] },
  { src: 'readme-joblog.html', key: 'joblog', out: 'MeshKit-Print-Job-Log-Read-Me-First', formats: ['Letter'] },
];

function parseArgs(argv) {
  const args = { sheetsLink: null, links: {}, only: null, screenshots: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sheets-link') args.sheetsLink = argv[++i];
    else if (a === '--link-pricing') args.links.pricing = argv[++i];
    else if (a === '--link-tracker') args.links.tracker = argv[++i];
    else if (a === '--link-joblog') args.links.joblog = argv[++i];
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--screenshots') args.screenshots = true;
    else if (a === '-h' || a === '--help') {
      console.log('node render.mjs [--sheets-link <url>] [--link-pricing <url>] [--link-tracker <url>] [--link-joblog <url>] [--only <name>] [--screenshots]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function substitute(html, doc, args) {
  const link = (doc.key && args.links[doc.key]) || args.sheetsLink;
  let out = html.replaceAll('{{VERSION}}', VERSION).replaceAll('{{DATE}}', DATE);
  if (link) {
    out = out.replaceAll('{{SHEETS_LINK}}', escapeHtml(link));
  } else {
    out = out.replace(
      /<a[^>]*href="\{\{SHEETS_LINK\}\}"[^>]*>[^<]*<\/a>/g,
      '<em>link in the listing\'s download page</em>'
    );
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(distDir, { recursive: true });
  if (args.screenshots) await mkdir(shotDir, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();
  let warnings = 0;

  try {
    for (const doc of docs) {
      if (args.only && !doc.out.includes(args.only) && !doc.src.includes(args.only)) continue;
      const srcPath = join(here, doc.src);
      const html = substitute(await readFile(srcPath, 'utf8'), doc, args);
      if (html.includes('{{SHEETS_LINK}}')) {
        console.warn(`  ! ${doc.src}: {{SHEETS_LINK}} left unsubstituted (pass --sheets-link)`);
        warnings++;
      }

      // Load via setContent with the file's own URL as base so relative font paths resolve.
      await page.goto(pathToFileURL(srcPath).href, { waitUntil: 'load' });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ media: 'print' });
      // Lay out at the narrowest content width we print (A4 minus margins) so the
      // height check and the screenshots reflect the worst case.
      const narrowPx = Math.round(((210 - 20) / 25.4) * 96);
      await page.setViewportSize({ width: narrowPx, height: Math.round(SHEET_LIMIT_PX) });

      // Layout guard: every .sheet must fit the per-page budget.
      const sheets = await page.$$eval('.sheet', (els) =>
        els.map((el, i) => ({ i: i + 1, h: el.scrollHeight, ch: el.clientHeight }))
      );
      for (const s of sheets) {
        if (s.h > s.ch + 1 || s.h > SHEET_LIMIT_PX + 1) {
          console.warn(`  ! ${doc.src} sheet ${s.i}: content ${Math.round(s.h)}px exceeds ${Math.round(Math.min(s.ch, SHEET_LIMIT_PX))}px`);
          warnings++;
        }
      }

      for (const format of doc.formats) {
        const suffix = doc.formats.length > 1 ? `-${format}` : '';
        const outPath = join(distDir, `${doc.out}${suffix}.pdf`);
        await page.pdf({ path: outPath, format, printBackground: true, margin: MARGIN, preferCSSPageSize: false });
        console.log(`  wrote ${outPath}`);
      }

      if (args.screenshots) {
        // One PNG per .sheet at the narrow (A4) content width, for eyeballing layout.
        const handles = await page.$$('.sheet');
        for (let i = 0; i < handles.length; i++) {
          const shot = join(shotDir, `${doc.out}-p${i + 1}.png`);
          await handles[i].screenshot({ path: shot });
        }
        console.log(`  screenshots: ${handles.length} page(s) -> ${shotDir}`);
      }
    }
  } finally {
    await browser.close();
  }

  await writeFile(join(distDir, 'BUILD-INFO.txt'), `version ${VERSION}\ndate ${DATE}\nsheets-link ${args.sheetsLink}\n`);
  if (warnings) {
    console.warn(`${warnings} warning(s).`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
