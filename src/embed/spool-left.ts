/**
 * MeshKit embeddable "how much filament is left" calculator.
 *
 *   <script src="https://meshkit.pro/embed/spool-left.js"
 *           data-theme="light" data-accent="#C43E0B" data-brand="polymaker" async></script>
 *
 * Gross spool weight − empty-spool tare (from MeshKit's database, or typed)
 * = filament left, in grams, metres and % of a full spool. Shadow DOM, no
 * dependencies, no network after load. Mandatory "Powered by MeshKit" credit.
 */
import spoolsData from '../data/spools.json';
import materialsData from '../data/materials.json';
import { gramsToMeters, spoolRemaining } from '../core/spool';

interface Cfg { theme: 'light' | 'dark'; accent: string; title: string; brand: string; compact: boolean }

const SITE = 'https://meshkit.pro';

function safeColor(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  return /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d\s.,%]+\)$|^hsla?\([\d\s.,%deg]+\)$|^[a-zA-Z]{3,20}$/.test(v.trim()) ? v.trim() : fallback;
}

function readConfig(script: HTMLScriptElement): Cfg {
  const d = script.dataset;
  return {
    theme: d.theme === 'dark' ? 'dark' : 'light',
    accent: safeColor(d.accent, '#C43E0B'),
    title: (d.title ?? 'How much filament is left?').slice(0, 80),
    brand: (d.brand ?? '').toLowerCase().slice(0, 40),
    compact: d.compact === 'true',
  };
}

function css(cfg: Cfg): string {
  const light = { bg: '#FAF9F5', panel: '#FFFFFF', text: '#141413', muted: '#5C5B57', border: '#C8C5BC', canvas: '#161615', canvasText: '#EDEDEA' };
  const dark = { bg: '#1A1A18', panel: '#121211', text: '#EDEDEA', muted: '#9E9D97', border: '#32322F', canvas: '#0C0C0B', canvasText: '#EDEDEA' };
  const t = cfg.theme === 'dark' ? dark : light;
  return `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .mk { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: ${t.text}; background: ${t.bg}; border: 1px solid ${t.border}; border-radius: 10px; padding: 16px; max-width: 560px; }
    .mk h2 { margin: 0 0 12px; font-size: 16px; font-weight: 700; }
    .mk .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(${cfg.compact ? 120 : 150}px, 1fr)); gap: 10px; }
    .mk label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: ${t.muted}; margin-bottom: 4px; }
    .mk input, .mk select { width: 100%; font: inherit; font-size: 14px; padding: 7px 9px; border: 1px solid ${t.border}; border-radius: 6px; background: ${t.panel}; color: ${t.text}; }
    .mk input:focus, .mk select:focus { outline: 2px solid ${cfg.accent}; outline-offset: 1px; border-color: ${cfg.accent}; }
    .mk .out { margin-top: 14px; background: ${t.canvas}; color: ${t.canvasText}; border-radius: 8px; padding: 12px 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; font-variant-numeric: tabular-nums; }
    .mk .out .k { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
    .mk .out .v { font-size: 20px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .mk .out .big .v { color: ${cfg.accent}; }
    .mk .bar { grid-column: 1 / -1; height: 6px; background: rgba(255,255,255,.12); border-radius: 3px; overflow: hidden; }
    .mk .bar i { display: block; height: 100%; background: ${cfg.accent}; width: 0; transition: width .2s; }
    .mk .warn { color: #FBBF24; font-size: 12px; grid-column: 1 / -1; }
    .mk .foot { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: ${t.muted}; gap: 8px; flex-wrap: wrap; }
    .mk .foot a { color: ${cfg.accent}; font-weight: 600; text-decoration: none; }
    .mk .foot a:hover { text-decoration: underline; }
  `;
}

interface SpoolRow { id: string; maker: string | null; brand: string; material: string; netG?: number; tareG: number }

function mount(script: HTMLScriptElement): void {
  const cfg = readConfig(script);
  const host = document.createElement('div');
  host.setAttribute('data-meshkit-embed', 'spool-left');
  script.insertAdjacentElement('afterend', host);
  const root = host.attachShadow({ mode: 'open' });
  const uid = `mk${Math.random().toString(36).slice(2, 8)}`;

  const spools = (spoolsData as { spools: SpoolRow[] }).spools;
  const materials = (materialsData as { materials: Array<{ id: string; name: string; density: number }> }).materials;
  const preferred = cfg.brand ? spools.filter((s) => (s.maker ?? '').includes(cfg.brand) || s.brand.toLowerCase().includes(cfg.brand)) : [];
  const ordered = [...preferred, ...spools.filter((s) => !preferred.includes(s))];

  root.innerHTML = `
    <style>${css(cfg)}</style>
    <div class="mk" role="group" aria-label="${cfg.title}">
      <h2>${cfg.title}</h2>
      <div class="grid">
        <div><label for="${uid}-g">Spool on the scale (g)</label><input id="${uid}-g" type="number" min="0" step="1" value="650" inputmode="decimal"></div>
        <div><label for="${uid}-s">Spool type</label><select id="${uid}-s">${ordered.map((s) => `<option value="${s.tareG}" data-net="${s.netG ?? 1000}">${s.brand} — ${s.tareG} g</option>`).join('')}<option value="custom">Custom tare…</option></select></div>
        <div><label for="${uid}-t">Empty spool (g)</label><input id="${uid}-t" type="number" min="0" step="1" value="${ordered[0]?.tareG ?? 200}" inputmode="decimal"></div>
        <div><label for="${uid}-m">Material</label><select id="${uid}-m">${materials.map((m) => `<option value="${m.density}">${m.name}</option>`).join('')}</select></div>
        <div><label for="${uid}-d">Diameter</label><select id="${uid}-d"><option value="1.75" selected>1.75 mm</option><option value="2.85">2.85 mm</option></select></div>
      </div>
      <div class="out" aria-live="polite">
        <div class="big"><div class="k">Filament left</div><div class="v" id="${uid}-left">—</div></div>
        <div><div class="k">Of a full spool</div><div class="v" id="${uid}-pct">—</div></div>
        <div><div class="k">≈ Length</div><div class="v" id="${uid}-len">—</div></div>
        <div class="bar"><i id="${uid}-bar"></i></div>
        <div class="warn" id="${uid}-warn" hidden></div>
      </div>
      <div class="foot">
        <span>Tare weights from the MeshKit spool database</span>
        <a href="${SITE}/empty-spool-weight-database?utm_source=embed&utm_medium=widget&utm_campaign=spool-left&utm_content=${encodeURIComponent(location.hostname)}" target="_blank" rel="noopener">Powered by MeshKit →</a>
      </div>
    </div>`;

  const q = <T extends HTMLElement>(s: string) => root.getElementById(`${uid}-${s}`) as T;
  const sel = q<HTMLSelectElement>('s');
  const tare = q<HTMLInputElement>('t');

  function update(): void {
    const gross = Number(q<HTMLInputElement>('g').value);
    const tareG = Number(tare.value);
    const density = Number(q<HTMLSelectElement>('m').value);
    const dia = Number(q<HTMLSelectElement>('d').value);
    const net = sel.value === 'custom' ? 1000 : Number(sel.selectedOptions[0]?.getAttribute('data-net') ?? 1000);
    const r = spoolRemaining(gross, tareG, density, dia, net);
    const warn = q<HTMLElement>('warn');
    if (!r.ok) {
      q('left').textContent = '—'; q('pct').textContent = '—'; q('len').textContent = '—';
      q<HTMLElement>('bar').style.width = '0';
      warn.hidden = false; warn.textContent = r.error; return;
    }
    q('left').textContent = `${r.netG.toFixed(0)} g`;
    const pct = Math.max(0, Math.min(100, (r.netG / net) * 100));
    q('pct').textContent = `${pct.toFixed(0)}%`;
    const m = gramsToMeters(r.netG, density, dia);
    q('len').textContent = m.ok ? `${m.meters.toFixed(1)} m` : '—';
    q<HTMLElement>('bar').style.width = `${pct}%`;
    warn.hidden = !r.belowTare;
    warn.textContent = r.belowTare ? 'Scale reads less than the empty spool — check the tare or the spool type.' : '';
  }

  sel.addEventListener('change', () => { if (sel.value !== 'custom') tare.value = sel.value; update(); });
  tare.addEventListener('input', () => { sel.value = 'custom'; update(); });
  ['g', 'm', 'd'].forEach((s) => { q(s).addEventListener('input', update); q(s).addEventListener('change', update); });
  update();
}

(function boot(): void {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current) { mount(current); return; }
  document.querySelectorAll<HTMLScriptElement>('script[src*="/embed/spool-left"]').forEach((s) => {
    if (!s.nextElementSibling?.hasAttribute('data-meshkit-embed')) mount(s);
  });
})();
