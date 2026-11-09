#!/usr/bin/env node
// Copied from ledger-retirement-planner/tools/etsy-sheet/images/render.mjs (self-contained copy for MeshKit).
// Composes 2000×2000 Etsy listing images (and an optional product video) from
// a JSON shot list + HTML sheet fragments produced by xlsx2html.py.
//
//   node render.mjs --shots shots.json --html <dir of fragments> --values values.json \
//        --out <png dir> [--only 01,02] [--brand brand.json]
//   node render.mjs --pdf print.json --html <dir> --out <file.pdf> [--brand brand.json]
//
// Branding: a `brand` block (inline object or a path to a JSON file) in the
// shot list / video / pdf spec, or `--brand file.json`.  Fields: name, logo
// (svg path), wordmark (text shown next to a mark-only logo), domain, eyebrow,
// footer_tag, palette {ink, ink_soft, paper, line, accent, accent_deep, slate,
// moss, blue, amber_bg}, fonts {heading, body, mono, css (raw @font-face CSS),
// heading_line_height (default 1.04; fonts with tall ascenders need ~1.1)}.
// Velafolio is the default; see brand-velafolio.json.
//   node render.mjs --video video.json --html <dir> --out <dir>
//        expects <dir>/<scenario id>.inputs.html and .results.html, rendered by
//        xlsx2html.py with the scenario's --set overrides and values JSON.
//
// Everything is drawn with CSS: device frames, headline strip, footer.  No
// stock photos.  Colours come from the brand palette (see brand-meshkit.json).
// MeshKit additions: `chart.bar` (true | "horizontal") draws a bar/column chart
// from cached values (see barChartSvg), and a `chart` shot that also names a
// `sheet` + `range` stacks that sheet fragment above the chart; a `sheet` shot
// with `views` stacks one window per view (see stackedSheetShot).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const REPO_URL = pathToFileURL(REPO).href.replace(/\/$/, '');
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
const SIZE = 2000;

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => {
  if (x.startsWith('--')) a.push([x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));

function expandTokens(raw) {
  const scratch = process.env.ETSY_SCRATCH || (typeof args.scratch === 'string' ? args.scratch : '');
  let s = raw.replaceAll('__REPO_URL__', REPO_URL).replaceAll('__REPO__', REPO);
  if (scratch) s = s.replaceAll('__SCRATCH__', scratch);
  return s;
}

const DEFAULT_BRAND = {
  name: 'Velafolio',
  logo: resolve(HERE, '../../../public/favicon.svg'),
  wordmark: '',
  domain: 'velafolio.com',
  eyebrow: 'Retirement Readiness Planner',
  footer_tag: 'Google Sheets · Excel · .xlsx',
  palette: { ink: '#171b24', ink_soft: '#454b58', paper: '#f3f4f1', line: '#dcded8', accent: '#a6772e', accent_deep: '#8a611f',
             slate: '#5c6470', moss: '#45614c', blue: '#2f5c99', amber_bg: '#f4ecd9', clay: '#a6452c' },
  fonts: { heading: '"TeX Gyre Pagella", "P052", "Palatino Linotype", Palatino, Georgia, serif',
           body: '"Helvetica Neue", "Liberation Sans", Arial, sans-serif',
           mono: '"Liberation Mono", "DejaVu Sans Mono", monospace', css: '' },
};
let BRAND = DEFAULT_BRAND;
let PALETTE, SERIF, SANS, MONO;

function applyBrand(spec) {
  let b = spec && spec.brand !== undefined ? spec.brand : args.brand;
  if (typeof b === 'string') b = JSON.parse(expandTokens(readFileSync(resolve(b), 'utf8')));
  b = b || {};
  BRAND = { ...DEFAULT_BRAND, ...b, palette: { ...DEFAULT_BRAND.palette, ...(b.palette || {}) }, fonts: { ...DEFAULT_BRAND.fonts, ...(b.fonts || {}) } };
  const p = BRAND.palette;
  PALETTE = { ink: p.ink, inkSoft: p.ink_soft, paper: p.paper, raised: '#ffffff', line: p.line, brass: p.accent, brassDeep: p.accent_deep,
              slate: p.slate, moss: p.moss, clay: p.clay, amberBg: p.amber_bg, c2: p.blue };
  SERIF = BRAND.fonts.heading; SANS = BRAND.fonts.body; MONO = BRAND.fonts.mono;
}
applyBrand(null);

function logoSvg() {
  const p = BRAND.logo && resolve(BRAND.logo);
  const svg = p && existsSync(p) ? readFileSync(p, 'utf8') : '';
  const mark = svg ? `<span class="mark">${svg}</span>` : '';
  const word = BRAND.wordmark ? `<span class="word">${escapeHtml(BRAND.wordmark)}</span>` : '';
  return mark + word;
}

function loadSpec(path) {
  const spec = JSON.parse(expandTokens(readFileSync(path, 'utf8')));
  return Array.isArray(spec) ? { shots: spec } : spec;
}

// ----------------------------------------------------------------------------
// Shared page skeleton
// ----------------------------------------------------------------------------
const baseCss = () => `
${BRAND.fonts.css || ''}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:${PALETTE.paper};color:${PALETTE.ink};font-family:${SANS};-webkit-font-smoothing:antialiased}
.page{position:relative;width:${SIZE}px;height:${SIZE}px;display:flex;flex-direction:column;padding:96px 100px 0}
.head{flex:none}
.eyebrow{font-family:${SANS};font-size:30px;letter-spacing:5px;text-transform:uppercase;color:${PALETTE.brassDeep};font-weight:600;display:flex;align-items:center;gap:22px}
.eyebrow:before{content:"";width:56px;height:2px;background:${PALETTE.brass}}
h1{font-family:${SERIF};font-weight:700;font-size:124px;line-height:${BRAND.fonts.heading_line_height || 1.04};letter-spacing:-2px;margin:26px 0 0;color:${PALETTE.ink}}
h1 em{font-style:italic;color:${PALETTE.brassDeep}}
.sub{font-family:${SERIF};font-size:44px;line-height:1.3;color:${PALETTE.inkSoft};margin:30px 0 0;max-width:1760px}
.stage{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;position:relative}
.foot{flex:none;height:150px;display:flex;align-items:center;justify-content:space-between;border-top:2px solid ${PALETTE.line};margin:0 -100px;padding:0 100px}
.foot .logo{display:flex;align-items:center;gap:22px}
.foot .logo svg{height:88px;width:auto}
.foot .logo .word{font-family:${SERIF};font-size:56px;font-weight:700;color:${PALETTE.ink};letter-spacing:-1px}
.foot .url{font-family:${SANS};font-size:38px;font-weight:600;color:${PALETTE.ink};letter-spacing:0.5px}
.foot .tag{font-family:${SANS};font-size:30px;color:${PALETTE.slate}}
/* browser window frame */
.win{background:#fff;border-radius:18px;box-shadow:0 30px 80px rgba(23,27,36,.18),0 2px 6px rgba(23,27,36,.12);overflow:hidden;border:2px solid #d5d7d2}
.win .titlebar{height:64px;background:#e9eaee;display:flex;align-items:center;padding:0 26px;gap:14px;border-bottom:1px solid #cfd1d6}
.win .dot{width:20px;height:20px;border-radius:50%}
.win .urlbox{margin-left:28px;flex:1;height:38px;border-radius:10px;background:#fff;color:#5f6368;font-size:22px;display:flex;align-items:center;padding:0 20px;font-family:${SANS}}
.win .screen{position:relative;overflow:hidden;background:#fff}
/* laptop frame */
.laptop{display:flex;flex-direction:column;align-items:center}
.laptop .lid{background:#1b1e26;border-radius:34px 34px 0 0;padding:34px 34px 30px;box-shadow:0 40px 100px rgba(23,27,36,.28)}
.laptop .bezel{border-radius:10px;overflow:hidden;background:#fff;position:relative}
.laptop .cam{width:14px;height:14px;border-radius:50%;background:#2d3140;margin:0 auto 14px}
.laptop .base{width:calc(100% + 150px);height:46px;background:linear-gradient(#d9dbdf,#b9bcc3);border-radius:0 0 30px 30px;position:relative}
.laptop .base:after{content:"";position:absolute;left:50%;top:0;transform:translateX(-50%);width:260px;height:14px;background:#a0a4ab;border-radius:0 0 12px 12px}
.laptop .foot-shadow{width:calc(100% + 150px);height:10px;background:#8e929a;border-radius:0 0 40px 40px;opacity:.5}
.fit{position:absolute;left:0;top:0;transform-origin:0 0}
/* tablet frame (for PDF pages / images) */
.tablet{background:#1b1e26;border-radius:44px;padding:54px 40px;box-shadow:0 40px 100px rgba(23,27,36,.28);position:relative}
.tablet .glass{border-radius:14px;overflow:hidden;background:#fff;position:relative}
.tablet:after{content:"";position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:120px;height:6px;border-radius:3px;background:#3a3f4d}
/* paper sheet frame */
.paper{background:#fff;box-shadow:0 24px 60px rgba(23,27,36,.22),0 2px 4px rgba(23,27,36,.12);position:relative;overflow:hidden}
.paper img,.tablet img,.win img{display:block}
`;

function pageHtml(shot, stageInner, extraCss = '') {
  if (shot.headline_size) extraCss += `h1{font-size:${shot.headline_size}px}`;
  const eyebrow = shot.eyebrow || BRAND.eyebrow;
  const headline = shot.headline_html || escapeHtml(shot.headline || '');
  const sub = shot.sub ? `<p class="sub">${escapeHtml(shot.sub)}</p>` : '';
  const foot = `<div class="foot"><div class="logo">${logoSvg()}</div><div class="tag">${escapeHtml(shot.footer_tag || BRAND.footer_tag)}</div><div class="url">${escapeHtml(BRAND.domain)}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss()}${extraCss}</style></head><body>
<div class="page"><div class="head"><div class="eyebrow">${escapeHtml(eyebrow)}</div><h1>${headline}</h1>${sub}</div>
<div class="stage">${stageInner}</div>${foot}</div></body></html>`;
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// A `.sheet` fragment scaled to fill a screen of [w,h] css px.  The fragment's
// natural width is parsed from its inline style; we scale to the width and let
// the flex column (grid clips, tabs pinned) fill the height.
function fitSheet(fragment, w, h, fixedScale) {
  const m = fragment.match(/class="sheet" style="width:(\d+)px"/);
  const natW = m ? Number(m[1]) : 800;
  const scale = fixedScale || w / natW;
  // Natural content height: bar + column header + rows + tab strip.
  const rowsH = [...fragment.matchAll(/<tr[^>]*style="height:(\d+)px"/g)].reduce((a, x) => a + Number(x[1]), 0);
  const contentH = 32 + rowsH + 36 + 2;
  const natH = h ? Math.round(h / scale) : contentH;
  const frag = fragment.replace(/class="sheet" style="width:(\d+)px"/, `class="sheet" style="width:${Math.max(natW, Math.round(w / scale))}px;height:${natH}px"`);
  return { html: `<div class="fit" style="transform:scale(${scale.toFixed(4)})">${frag}</div>`, scale, height: Math.round(natH * scale) };
}

function browserWindow(inner, w, h, url = 'docs.google.com/spreadsheets') {
  return `<div class="win" style="width:${w + 4}px">
  <div class="titlebar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><div class="urlbox">${escapeHtml(url)}</div></div>
  <div class="screen" style="width:${w}px;height:${h}px">${inner}</div></div>`;
}

function laptop(inner, w, h) {
  return `<div class="laptop"><div class="lid"><div class="cam"></div><div class="bezel" style="width:${w}px;height:${h}px">${inner}</div></div><div class="base"></div><div class="foot-shadow"></div></div>`;
}

// ----------------------------------------------------------------------------
// Shot types
// ----------------------------------------------------------------------------
function sheetShot(shot, fragments) {
  const [w, h0] = shot.screen || [1700, null];
  if (shot.views) return stackedSheetShot(shot, fragments, w);
  const frag = fragments[shot.id];
  if (!frag) throw new Error(`no HTML fragment for ${shot.id}`);
  const { html, scale, height } = fitSheet(frag, w, h0, shot.scale);
  const h = h0 || height;
  const inner = shot.frame === 'laptop' ? laptop(html, w, h) : browserWindow(html, w, h, shot.url);
  return { html: pageHtml(shot, inner), scale };
}

// A `sheet` shot with `views: {name: {sheet, range, ..., caption, note, scale}}`
// stacks one browser window per view (fragments <id>.<name>.html), each sized
// to its own content, with an optional caption line above.
function stackedSheetShot(shot, fragments, w) {
  const css = `.stk{width:${w + 4}px;display:flex;flex-direction:column;gap:26px}
.stk .cap{font-family:${SERIF};font-size:38px;color:${PALETTE.ink};margin:0 0 14px;font-weight:700;display:flex;align-items:center;gap:18px}
.stk .cap span{font-family:${SANS};font-weight:400;font-size:30px;color:${PALETTE.slate}}`;
  let minScale = Infinity;
  const wins = Object.entries(shot.views).map(([name, v]) => {
    const frag = fragments[`${shot.id}.${name}`];
    if (!frag) throw new Error(`no HTML fragment for ${shot.id}.${name}`);
    const { html, scale, height } = fitSheet(frag, w, null, v.scale || shot.scale);
    minScale = Math.min(minScale, scale);
    const cap = v.caption ? `<p class="cap">${escapeHtml(v.caption)}<span>${escapeHtml(v.note || '')}</span></p>` : '';
    return `<div>${cap}${browserWindow(html, w, height, v.url || shot.url)}</div>`;
  });
  return { html: pageHtml(shot, `<div class="stk">${wins.join('')}</div>`, css), scale: minScale };
}

function chartSvg(spec, values, W, H) {
  if (spec.bar || spec.type === 'bar') return barChartSvg(spec, values, W, H);  // type:"bar" = upstream alias (horizontal)
  const sheet = values[spec.sheet] || {};
  const [xcol, r0, r1] = spec.x;
  const xs = [], series = spec.series.map(s => ({ name: s.name, pts: [] }));
  const xEnd = spec.x_end ? Number((values[spec.x_end.sheet] || {})[spec.x_end.cell]) : Infinity;
  for (let r = r0; r <= r1; r++) {
    const x = sheet[`${xcol}${r}`];
    if (typeof x !== 'number' || x > xEnd) continue;
    xs.push(x);
    spec.series.forEach((s, i) => series[i].pts.push([x, Number(sheet[`${s.col}${r}`]) || 0]));
  }
  const pad = { l: 190, r: 60, t: 150, b: 110 };
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymax = Math.max(...series.flatMap(s => s.pts.map(p => p[1])));
  const step = niceStep(ymax / 5);
  const yTop = Math.ceil(ymax / step) * step;
  const sx = x => pad.l + (x - xmin) / (xmax - xmin) * (W - pad.l - pad.r);
  const sy = y => H - pad.b - y / yTop * (H - pad.t - pad.b);
  const colors = [PALETTE.c2, PALETTE.brass];
  let g = '';
  for (let y = 0; y <= yTop + 1e-9; y += step) {
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(y)}" y2="${sy(y)}" stroke="#e6e5df" stroke-width="2"/>`;
    g += `<text x="${pad.l - 18}" y="${sy(y) + 10}" text-anchor="end" font-size="28" fill="#5c6470">${fmtMoney(y)}</text>`;
  }
  const xt = niceStep((xmax - xmin) / 8);
  for (let x = Math.ceil(xmin / xt) * xt; x <= xmax; x += xt) {
    g += `<text x="${sx(x)}" y="${H - pad.b + 44}" text-anchor="middle" font-size="28" fill="#5c6470">${x}</text>`;
    g += `<line x1="${sx(x)}" x2="${sx(x)}" y1="${H - pad.b}" y2="${H - pad.b + 10}" stroke="#9aa0a6" stroke-width="2"/>`;
  }
  let marker = '';
  if (spec.marker) {
    const mv = (values[spec.marker.sheet] || {})[spec.marker.cell];
    if (typeof mv === 'number' && mv >= xmin && mv <= xmax) {
      marker = `<line x1="${sx(mv)}" x2="${sx(mv)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#a6452c" stroke-dasharray="10 10" stroke-width="3"/>
<text x="${sx(mv) + 14}" y="${pad.t + 40}" font-size="28" fill="#a6452c">${escapeHtml(spec.marker.label)} ${mv}</text>`;
    }
  }
  const paths = series.map((s, i) => `<path d="${s.pts.map((p, j) => (j ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join(' ')}" fill="none" stroke="${colors[i]}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  const legend = series.map((s, i) => `<g transform="translate(${pad.l + i * 560},${104})"><rect width="44" height="8" y="-6" fill="${colors[i]}"/><text x="60" y="6" font-size="30" fill="#171b24">${escapeHtml(s.name)}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS.replace(/"/g, "'")}">
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="${W / 2}" y="64" text-anchor="middle" font-size="40" fill="#171b24">${escapeHtml(spec.title)}</text>
${g}<line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="#9aa0a6" stroke-width="2"/>
<text transform="translate(44,${(H - pad.b + pad.t) / 2}) rotate(-90)" text-anchor="middle" font-size="30" fill="#5c6470">${escapeHtml(spec.y_title || '')}</text>
<text x="${(W - pad.r + pad.l) / 2}" y="${H - pad.b + 90}" text-anchor="middle" font-size="30" fill="#5c6470">${escapeHtml(spec.x_title || '')}</text>
${marker}${paths}${legend}</svg>`;
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function fmtMoney(v) { return v >= 1e6 ? `$${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${v < 10 && v % 1 ? v.toFixed(2) : v}`; }
function fmtAxis(v, kind) { return kind === 'number' ? (v >= 1e4 ? `${Math.round(v / 1e3)}k` : (+v.toFixed(2)).toLocaleString('en-US')) : fmtMoney(v); }
// Excel serial → "Oct 2026" (used for date categories).
function fmtCategory(c, fmt) {
  if (typeof c === 'number' && fmt && /y/i.test(fmt)) {
    const d = new Date(Date.UTC(1899, 11, 30) + c * 86400000);
    const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    return /mmmm/i.test(fmt) ? d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) + ' ' + d.getUTCFullYear() : /yyyy/i.test(fmt) ? `${mon} ${d.getUTCFullYear()}` : `${mon} ${String(d.getUTCFullYear()).slice(2)}`;
  }
  return String(c);
}

// Bar / column chart from cached values.  spec: {bar: true|"horizontal",
// categories:[col,row0,row1] (labels; blanks skipped), series:[{name,col}],
// category_format ("mmm yyyy" for date serials), y_format ("money"|"number"),
// colors:[...], title, x_title, y_title, sheet}.  `bar: true` draws vertical
// columns; "horizontal" draws bars with the category labels on the left.
function barChartSvg(spec, values, W, H) {
  const sheet = values[spec.sheet] || {};
  const [ccol, r0, r1] = spec.categories || spec.x;
  const cats = [], series = spec.series.map(s => ({ name: s.name, vals: [] }));
  for (let r = r0; r <= r1; r++) {
    const c = sheet[`${ccol}${r}`];
    if (c === undefined || c === null || c === '' || c === 'empty') continue;
    cats.push(fmtCategory(c, spec.category_format));
    spec.series.forEach((s, i) => series[i].vals.push(Number(sheet[`${s.col}${r}`]) || 0));
  }
  const horizontal = spec.bar === 'horizontal' || (!spec.bar && spec.type === 'bar');
  const pad = horizontal ? { l: 520, r: 120, t: 130, b: 90 } : { l: 190, r: 60, t: 150, b: 130 };
  const ymax = Math.max(1e-9, ...series.flatMap(s => s.vals));
  const step = niceStep(ymax / 5);
  const yTop = Math.ceil(ymax / step) * step;
  const colors = spec.colors || [PALETTE.brass, PALETTE.c2];
  const kind = spec.y_format || spec.value_format || 'money';
  const n = series.length;
  let g = '', bars = '';
  const label = (x, y, text, anchor, size = 28, fill = '#5c6470', extra = '') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${fill}" ${extra}>${escapeHtml(text)}</text>`;
  if (horizontal) {
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const sx = v => pad.l + v / yTop * plotW;
    for (let v = 0; v <= yTop + 1e-9; v += step) {
      g += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${pad.t}" y2="${H - pad.b}" stroke="#e6e5df" stroke-width="2"/>` + label(sx(v), H - pad.b + 40, fmtAxis(v, kind), 'middle');
    }
    const slot = plotH / cats.length, barH = slot * 0.68 / n;
    cats.forEach((c, i) => {
      const y0 = pad.t + i * slot + (slot - barH * n) / 2;
      g += label(pad.l - 24, y0 + barH * n / 2 + 10, c, 'end', 30, '#171b24');
      series.forEach((s, k) => {
        const v = s.vals[i];
        bars += `<rect x="${pad.l}" y="${(y0 + k * barH).toFixed(1)}" width="${Math.max(0, sx(v) - pad.l).toFixed(1)}" height="${(barH - 4).toFixed(1)}" fill="${colors[k % colors.length]}" rx="3"/>`;
        bars += label(sx(v) + 14, y0 + k * barH + barH / 2 + 10, fmtAxis(+v.toFixed(2), kind), 'start', 28, '#171b24');
      });
    });
    g += `<line x1="${pad.l}" x2="${pad.l}" y1="${pad.t}" y2="${H - pad.b}" stroke="#9aa0a6" stroke-width="2"/>`;
  } else {
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const sy = v => H - pad.b - v / yTop * plotH;
    for (let v = 0; v <= yTop + 1e-9; v += step) {
      g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="#e6e5df" stroke-width="2"/>` + label(pad.l - 18, sy(v) + 10, fmtAxis(v, kind), 'end');
    }
    const slot = plotW / cats.length, barW = slot * 0.7 / n;
    cats.forEach((c, i) => {
      const x0 = pad.l + i * slot + (slot - barW * n) / 2;
      g += label(pad.l + i * slot + slot / 2, H - pad.b + 44, c, 'middle', cats.length > 8 ? 24 : 28, '#171b24');
      series.forEach((s, k) => {
        const v = s.vals[i];
        bars += `<rect x="${(x0 + k * barW).toFixed(1)}" y="${sy(v).toFixed(1)}" width="${(barW - 4).toFixed(1)}" height="${Math.max(0, H - pad.b - sy(v)).toFixed(1)}" fill="${colors[k % colors.length]}" rx="3"/>`;
      });
    });
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="#9aa0a6" stroke-width="2"/>`;
  }
  const legend = n > 1 ? series.map((s, i) => `<g transform="translate(${pad.l + i * 420},${104})"><rect width="44" height="22" y="-14" fill="${colors[i % colors.length]}" rx="3"/><text x="60" y="6" font-size="30" fill="#171b24">${escapeHtml(s.name)}</text></g>`).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS.replace(/"/g, "'")}">
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="${W / 2}" y="64" text-anchor="middle" font-size="40" fill="#171b24">${escapeHtml(spec.title)}</text>
${g}${bars}
<text transform="translate(44,${(H - pad.b + pad.t) / 2}) rotate(-90)" text-anchor="middle" font-size="30" fill="#5c6470">${escapeHtml(spec.y_title || '')}</text>
<text x="${(W - pad.r + pad.l) / 2}" y="${H - pad.b + (horizontal ? 80 : 95)}" text-anchor="middle" font-size="30" fill="#5c6470">${escapeHtml(spec.x_title || '')}</text>
${legend}</svg>`;
}

// `chart` shot: the SVG chart in a browser window.  If the shot also names a
// `sheet` + `range`, that fragment is stacked above the chart (sheet over chart).
function chartShot(shot, values, fragments) {
  const [w, h] = shot.screen || [1700, 1000];
  const svg = chartSvg(shot.chart, values, w, h);
  const chartWin = browserWindow(svg, w, h, shot.url);
  if (shot.sheet && shot.range && fragments && fragments[shot.id]) {
    const { html, height, scale } = fitSheet(fragments[shot.id], w, null, shot.scale);
    const css = `.stk{width:${w + 4}px;display:flex;flex-direction:column;gap:26px}`;
    return { html: pageHtml(shot, `<div class="stk">${browserWindow(html, w, height, shot.window_title || 'workbook.xlsx')}${chartWin}</div>`, css), scale };
  }
  return { html: pageHtml(shot, chartWin) };
}

function cardsShot(shot) {
  const css = `.cards{display:grid;grid-template-columns:1fr 1fr;gap:40px;width:100%}
.card{background:#fff;border:2px solid ${PALETTE.line};border-radius:6px;padding:44px 46px;min-height:360px;position:relative}
.card .n{position:absolute;right:36px;top:30px;font-family:${SERIF};font-size:54px;color:${PALETTE.line};font-weight:700}
.card h2{font-family:${SERIF};font-size:52px;margin:0 0 18px;color:${PALETTE.ink};font-weight:700}
.card p{font-size:36px;line-height:1.38;margin:0;color:${PALETTE.inkSoft}}
.card .tab{display:inline-block;background:${PALETTE.amberBg};color:${PALETTE.brassDeep};font-size:24px;letter-spacing:2px;text-transform:uppercase;padding:6px 14px;border-radius:4px;margin-bottom:18px;font-weight:600}`;
  const cards = shot.cards.map((c, i) => `<div class="card"><div class="n">${String(i + 1).padStart(2, '0')}</div><div class="tab">${escapeHtml(c.badge || shot.card_badge || 'Tab')}</div><h2>${escapeHtml(c.title)}</h2><p>${escapeHtml(c.text)}</p></div>`).join('');
  return { html: pageHtml(shot, `<div class="cards">${cards}</div>`, css) };
}

function badgesShot(shot) {
  const css = `.wrap{width:100%;display:flex;flex-direction:column;align-items:center;gap:60px}
.badges{display:flex;gap:50px}
.badge{background:#fff;border:3px solid ${PALETTE.ink};border-radius:8px;padding:44px 70px;font-family:${SANS};font-size:64px;font-weight:700;color:${PALETTE.ink};display:flex;align-items:center;gap:34px}
.badge .sq{width:64px;height:64px;border-radius:8px;display:inline-block;background-image:linear-gradient(rgba(255,255,255,.75) 2px,transparent 2px),linear-gradient(90deg,rgba(255,255,255,.75) 2px,transparent 2px);background-size:16px 16px;background-position:-2px -2px}
.notes{list-style:none;margin:0;padding:0;width:1500px}
.notes li{font-size:40px;line-height:1.35;color:${PALETTE.inkSoft};padding:34px 0 34px 70px;border-top:2px solid ${PALETTE.line};position:relative}
.notes li:last-child{border-bottom:2px solid ${PALETTE.line}}
.notes li:before{content:"";position:absolute;left:14px;top:56px;width:22px;height:22px;border-radius:50%;background:${PALETTE.moss}}
.xlsx{font-family:${SANS};font-size:34px;color:${PALETTE.slate};letter-spacing:4px;text-transform:uppercase}`;
  const sq = [PALETTE.moss, PALETTE.c2];
  const badges = shot.badges.map((b, i) => `<div class="badge"><span class="sq" style="background:${sq[i % 2]}"></span>${escapeHtml(b)}</div>`).join('');
  const notes = (shot.notes || []).map(n => `<li>${escapeHtml(n)}</li>`).join('');
  const formula = shot.formula_sample ? `<div class="fbar"><div class="fx">fx</div><div class="code">${escapeHtml(shot.formula_sample)}</div></div><div class="fcap">${escapeHtml(shot.formula_caption || '')}</div>` : '';
  const css2 = css + `.fbar{width:1500px;display:flex;align-items:center;background:#fff;border:2px solid ${PALETTE.line};border-radius:6px;padding:22px 28px;gap:24px}
.fbar .fx{font-family:Georgia,serif;font-style:italic;font-size:34px;color:${PALETTE.slate}}
.fbar .code{font-family:${MONO};font-size:29px;color:${PALETTE.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fcap{font-size:28px;color:${PALETTE.slate};margin-top:-36px}`;
  return { html: pageHtml(shot, `<div class="wrap"><div class="badges">${badges}</div><div class="xlsx">One .xlsx file · no sign-up · no subscription</div><ul class="notes">${notes}</ul>${formula}</div>`, css2) };
}

function compareShot(shot, fragments, sitePng) {
  const [w, h0] = shot.screen || [1800, null];
  const { html, height, scale } = fitSheet(fragments[shot.id], w, h0, shot.scale);
  const h = h0 || height;
  if (shot.stack) {
    const [vw, vh] = shot.site_viewport || [1280, 900];
    const clip = shot.site_clip || [0, 0, vw, vh];
    const siteH = Math.round(w * clip[3] / clip[2]);
    const css = `.stk{width:${w + 4}px;display:flex;flex-direction:column;gap:26px}
.stk .cap{font-family:${SERIF};font-size:38px;color:${PALETTE.ink};margin:0 0 14px;font-weight:700;display:flex;align-items:center;gap:18px}
.stk .cap span{font-family:${SANS};font-weight:400;font-size:30px;color:${PALETTE.slate}}
.stk img{display:block}`;
    const top = `<div><p class="cap">${escapeHtml(shot.left_caption || 'The workbook')}<span>${escapeHtml(shot.left_note || '')}</span></p>${browserWindow(html, w, h, shot.window_title || 'workbook.xlsx')}</div>`;
    const bottom = `<div><p class="cap">${escapeHtml(shot.right_caption || 'The app')}<span>${escapeHtml(shot.right_note || '')}</span></p>${browserWindow(`<img src="data:image/png;base64,${sitePng.toString('base64')}" style="width:${w}px;height:${siteH}px">`, w, siteH, shot.site_url)}</div>`;
    return { html: pageHtml(shot, `<div class="stk">${top}${bottom}</div>`, css), scale };
  }
  const css = `.cmp{display:grid;grid-template-columns:1fr 1fr;gap:50px;width:100%;align-items:start}
.cmp .cap{font-family:${SERIF};font-size:40px;color:${PALETTE.ink};margin:0 0 20px;font-weight:700}
.cmp img{display:block;width:100%}
.cmp .vs{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:110px;height:110px;border-radius:50%;background:${PALETTE.ink};color:#fff;display:flex;align-items:center;justify-content:center;font-family:${SERIF};font-size:40px;font-style:italic}`;
  const siteW = w;
  const [vw, vh] = shot.site_viewport || [1280, 900];
  const clip0 = shot.site_clip || [0, 0, vw, vh];
  const siteH = Math.round(siteW * clip0[3] / clip0[2]);
  const left = `<div><p class="cap">${escapeHtml(shot.left_caption || 'The workbook')}</p>${browserWindow(html, w, h, shot.window_title || 'workbook.xlsx')}</div>`;
  const right = `<div><p class="cap">${escapeHtml(shot.right_caption || 'The app')}</p>${browserWindow(`<img src="data:image/png;base64,${sitePng.toString('base64')}" style="width:${siteW}px;height:${siteH}px">`, siteW, siteH, shot.site_url)}</div>`;
  return { html: pageHtml(shot, `<div class="cmp">${left}${right}</div>`, css) };
}

// A raster image (e.g. a PDF page from pdftoppm) in a frame.  `image` is a
// path; `fit` = [w, h] of the visible area; frame = tablet|paper|browser|laptop.
function imageShot(shot) {
  const png = readFileSync(resolve(shot.image));
  const ext = shot.image.toLowerCase().endsWith('.jpg') || shot.image.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
  const [w, h] = shot.fit || [1400, 1000];
  const img = `<img src="data:image/${ext};base64,${png.toString('base64')}" style="width:${w}px;height:${h}px;object-fit:cover;object-position:top">`;
  let inner;
  switch (shot.frame || 'paper') {
    case 'tablet': inner = `<div class="tablet"><div class="glass" style="width:${w}px;height:${h}px">${img}</div></div>`; break;
    case 'browser': inner = browserWindow(img, w, h, shot.url); break;
    case 'laptop': inner = laptop(img, w, h); break;
    default: inner = `<div class="paper" style="width:${w}px;height:${h}px;transform:rotate(${shot.tilt || 0}deg)">${img}</div>`;
  }
  if (shot.images) { // a fan of several pages behind the main one
    const extra = shot.images.map((p, i) => `<div class="paper" style="position:absolute;width:${w}px;height:${h}px;left:${(i + 1) * 46}px;top:${-(i + 1) * 30}px;z-index:${-i - 1};opacity:${1 - (i + 1) * 0.18}"><img src="data:image/png;base64,${readFileSync(resolve(p)).toString('base64')}" style="width:${w}px;height:${h}px;object-fit:cover;object-position:top"></div>`).join('');
    inner = `<div style="position:relative;z-index:0">${extra}<div style="position:relative;z-index:1">${inner}</div></div>`;
  }
  return { html: pageHtml(shot, inner) };
}

function faqShot(shot) {
  const css = `.faq{width:100%;margin:0;padding:0;list-style:none}
.faq li{display:grid;grid-template-columns:620px 1fr;gap:40px;padding:40px 0;border-top:2px solid ${PALETTE.line}}
.faq li:last-child{border-bottom:2px solid ${PALETTE.line}}
.faq .q{font-family:${SERIF};font-size:46px;font-weight:700;color:${PALETTE.ink};line-height:1.2}
.faq .a{font-size:36px;line-height:1.38;color:${PALETTE.inkSoft}}`;
  const items = shot.faq.map(f => `<li><div class="q">${escapeHtml(f.q)}</div><div class="a">${escapeHtml(f.a)}</div></li>`).join('');
  return { html: pageHtml(shot, `<ul class="faq">${items}</ul>`, css) };
}

// ----------------------------------------------------------------------------
// Video: Inputs + Results side by side, retirement age stepping through
// scenarios; each scenario has its own pre-rendered fragments.
// ----------------------------------------------------------------------------
function videoScene(spec, fragmentsByScenario) {
  const [w] = spec.screen || [968];
  // Two stacked windows (Inputs, Results); each scenario is a layer that is
  // faded in by the recorder.  Heights come from the fragments themselves.
  const layers = spec.scenarios.map((sc, i) => {
    const a = fitSheet(fragmentsByScenario[sc.id].inputs, w, null);
    const b = fitSheet(fragmentsByScenario[sc.id].results, w, null);
    const title = spec.window_title || 'workbook.xlsx';
    return { i, inputs: browserWindow(a.html, w, a.height, `${title} — ${spec.inputs_view.sheet}`), results: browserWindow(b.html, w, b.height, `${title} — ${spec.results_view.sheet}`), hA: a.height + 52, hB: b.height + 52 };
  });
  const hA = Math.max(...layers.map(l => l.hA)), hB = Math.max(...layers.map(l => l.hB));
  const css = `body{width:1080px;height:1080px}
.page{width:1080px;height:1080px;padding:44px 56px 0}
h1{font-size:62px;letter-spacing:-1px;margin-top:10px}
.sub{font-size:26px;margin-top:10px}
.eyebrow{font-size:18px;letter-spacing:3px}
.foot{height:84px;margin:0 -56px;padding:0 56px}
.foot .logo svg{height:50px}.foot .url{font-size:24px}.foot .tag{font-size:18px}
.stage{display:block;position:relative}
.slot{position:absolute;left:0;width:${w + 4}px}
.layer{position:absolute;left:0;top:0;transition:opacity .3s}
.win .titlebar{height:48px}.win .dot{width:14px;height:14px}.win .urlbox{height:28px;font-size:16px;margin-left:14px}
.callout{position:absolute;right:56px;top:142px;background:${PALETTE.ink};color:#fff;font-family:${SERIF};font-size:32px;padding:8px 24px;border-radius:6px;transition:opacity .3s}
.callout b{color:#f0c674}
${spec.extra_css || ''}`;
  const gap = 22;
  const inner = `<div class="slot" style="top:0;height:${hA}px">${layers.map(l => `<div class="layer" data-i="${l.i}" style="opacity:${l.i === 0 ? 1 : 0}">${l.inputs}</div>`).join('')}</div>
<div class="slot" style="top:${hA + gap}px;height:${hB}px">${layers.map(l => `<div class="layer" data-i="${l.i}" style="opacity:${l.i === 0 ? 1 : 0}">${l.results}</div>`).join('')}</div>
`;
  return pageHtml(spec, `<div style="position:relative;width:${w + 4}px;height:${hA + gap + hB}px;margin-top:18px">${inner}</div>`, css)
    .replace('</body>', '<div class="callout" id="callout" style="opacity:0"></div></body>');
}

// ----------------------------------------------------------------------------
async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    if (args.video) await renderVideo(browser);
    else if (args.pdf) await renderPdf(browser);
    else await renderStills(browser);
  } finally {
    await browser.close();
  }
}

function loadFragments(dir) {
  const out = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.html')) out[f.replace(/\.html$/, '')] = readFileSync(join(dir, f), 'utf8');
  return out;
}

async function renderStills(browser) {
  const spec = loadSpec(args.shots);
  applyBrand(spec);
  const shots = spec.shots;
  const fragments = loadFragments(args.html);
  const values = args.values && existsSync(args.values) ? JSON.parse(readFileSync(args.values, 'utf8')) : {};
  const only = args.only ? String(args.only).split(',') : null;
  mkdirSync(args.out, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1, colorScheme: 'light' });
  let sitePng = null;
  for (const shot of shots) {
    if (only && !only.some(o => shot.id.startsWith(o))) continue;
    let r;
    switch (shot.type) {
      case 'sheet': r = sheetShot(shot, fragments); break;
      case 'chart': r = chartShot(shot, values, fragments); break;
      case 'cards': r = cardsShot(shot); break;
      case 'badges': r = badgesShot(shot); break;
      case 'faq': r = faqShot(shot); break;
      case 'image': r = imageShot(shot); break;
      case 'compare': {
        if (!sitePng) sitePng = await screenshotSite(browser, shot);
        r = compareShot(shot, fragments, sitePng); break;
      }
      default: throw new Error(`unknown shot type ${shot.type}`);
    }
    const page = await ctx.newPage();
    await page.setContent(r.html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // Guard: report text that overflows its box (clipped headlines etc.)
    const overflow = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('h1,.sub,.card p,.faq .a,.faq .q,.notes li')) {
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) bad.push(el.className || el.tagName);
      }
      const page = document.querySelector('.page');
      if (page.scrollHeight > page.clientHeight + 1) bad.push('page-overflow:' + page.scrollHeight);
      return bad;
    });
    if (overflow.length) console.warn(`  ! ${shot.id}: overflow in ${overflow.join(', ')}`);
    const out = join(args.out, `${shot.id}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
    if (args.debugHtml) writeFileSync(join(args.out, `${shot.id}.html`), r.html);
    console.log(`wrote ${out}${r.scale ? `  (sheet scale ${r.scale.toFixed(2)} → cell text ≈ ${(14.7 * r.scale).toFixed(0)} px)` : ''}`);
    await page.close();
  }
  await ctx.close();
}

async function screenshotSite(browser, shot) {
  const [vw, vh] = shot.site_viewport || [1280, 900];
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, colorScheme: 'light', deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(shot.site_url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(800);
  const png = await page.screenshot({ clip: shot.site_clip ? { x: shot.site_clip[0], y: shot.site_clip[1], width: shot.site_clip[2], height: shot.site_clip[3] } : undefined });
  await ctx.close();
  return png;
}

async function renderVideo(browser) {
  const spec = loadSpec(args.video);
  applyBrand(spec);
  const frags = {};
  for (const sc of spec.scenarios) {
    frags[sc.id] = { inputs: readFileSync(join(args.html, `${sc.id}.inputs.html`), 'utf8'), results: readFileSync(join(args.html, `${sc.id}.results.html`), 'utf8') };
  }
  mkdirSync(args.out, { recursive: true });
  const tmpDir = join(args.out, '.video-tmp');
  rmSync(tmpDir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1080 }, colorScheme: 'light', recordVideo: { dir: tmpDir, size: { width: 1080, height: 1080 } } });
  const page = await ctx.newPage();
  const sceneHtml = videoScene(spec, frags);
  await page.setContent(sceneHtml, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  if (args.debugHtml) { writeFileSync(join(args.out, 'video-scene.html'), sceneHtml); await page.screenshot({ path: join(args.out, 'video-frame0.png') }); }
  const hold = spec.hold_ms || 4200;
  await page.waitForTimeout(600);
  for (let i = 0; i < spec.scenarios.length; i++) {
    const sc = spec.scenarios[i];
    await page.evaluate(([i, text]) => {
      document.querySelectorAll('.layer').forEach(s => s.style.opacity = Number(s.dataset.i) === i ? '1' : '0');
      const c = document.getElementById('callout'); c.innerHTML = text; c.style.opacity = '1';
    }, [i, sc.callout]);
    await page.waitForTimeout(hold);
  }
  await page.waitForTimeout(400);
  const video = page.video();
  await ctx.close();
  const webm = await video.path();
  const mp4 = join(args.out, spec.output || 'video.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-i', webm, '-t', String(spec.max_seconds || 15), '-vf', 'fps=30,scale=1080:1080:flags=lanczos', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
  rmSync(tmpDir, { recursive: true, force: true });
  console.log('wrote', mp4);
}

// ----------------------------------------------------------------------------
// Printable PDF: sheet fragments without the Sheets chrome.  Spec:
// { brand, paper: "Letter", landscape: true, title, footer,
//   sections: [{ label: "Example", heading: "Budget", fragment: "budget.html", note }] }
// Each section starts on a new page; <thead> rows (xlsx2html `thead_rows`) repeat
// on every printed page.
// ----------------------------------------------------------------------------
async function renderPdf(browser) {
  const spec = loadSpec(args.pdf);
  applyBrand(spec);
  const css = `${BRAND.fonts.css || ''}
*{box-sizing:border-box}
body{margin:0;font-family:${SANS};color:${PALETTE.ink};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.section{page-break-before:always;padding:0}
.section:first-child{page-break-before:auto}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid ${PALETTE.ink};padding-bottom:6px;margin-bottom:10px}
.sec-head h1{font-family:${SERIF};font-size:20px;margin:0;font-weight:700}
.sec-head .label{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${PALETTE.brassDeep};font-weight:600}
.sec-head .brand{font-size:12px;color:${PALETTE.slate}}
.note{font-size:10.5px;color:${PALETTE.slate};margin:0 0 8px}
/* strip the Sheets chrome */
.sheet .bar,.sheet .tabs,.sheet th{display:none}
.sheet{display:block;width:auto !important;height:auto !important;font-size:10px;overflow:visible}
.sheet .grid{overflow:visible}
.sheet table{width:100% !important;table-layout:auto}
.sheet td{border-color:#c8c8c8;height:auto !important;padding:2px 5px;white-space:normal;overflow-wrap:break-word}
.sheet td.spill{position:static;overflow:visible}
.sheet td.spill span{position:static;white-space:normal}
.sheet thead{display:table-header-group}
.sheet tr{page-break-inside:avoid}
.sheet tr{height:auto !important}
.sheet tr.frozen td{border-top:1px solid #c8c8c8}
${spec.extra_css || ''}`;
  const sections = spec.sections.map(sec => {
    let frag = readFileSync(join(args.html, sec.fragment), 'utf8');
    return `<div class="section"><div class="sec-head"><div><span class="label">${escapeHtml(sec.label || '')}</span> <h1>${escapeHtml(sec.heading || '')}</h1></div><div class="brand">${escapeHtml(spec.title || BRAND.name)}</div></div>${sec.note ? `<p class="note">${escapeHtml(sec.note)}</p>` : ''}${frag}</div>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${sections}</body></html>`;
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: 'print' });
  const footer = `<div style="width:100%;font-size:8px;color:#5c6470;padding:0 12mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif"><span>${escapeHtml(spec.footer || `${BRAND.name} · ${BRAND.domain}`)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
  mkdirSync(dirname(args.out), { recursive: true });
  await page.pdf({ path: args.out, format: spec.paper || 'Letter', landscape: !!spec.landscape, printBackground: true,
    margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' }, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer });
  if (args.debugHtml) writeFileSync(args.out.replace(/\.pdf$/, '.html'), html);
  await ctx.close();
  console.log('wrote', args.out);
}

main().catch(e => { console.error(e); process.exit(1); });
