/**
 * MeshKit embeddable 3D print cost calculator.
 *
 * Usage on any site:
 *   <script src="https://meshkit.pro/embed/print-cost.js"
 *           data-price-per-kg="22" data-currency="$" data-accent="#C43E0B"
 *           data-theme="light" data-kwh="0.16" data-watts="150" async></script>
 *
 * Renders itself right after the script tag, inside a Shadow DOM so host CSS
 * cannot break it and it cannot break the host. No dependencies, no network
 * requests, no cookies. Uses the same calculatePrintCost() as the site, so a
 * number here always matches the full calculator. The "Powered by MeshKit"
 * link is part of the deal: it is how the widget pays for itself.
 */
import { calculatePrintCost } from '../core/cost';
import materialsData from '../data/materials.json';

interface EmbedConfig {
  pricePerKg: number;
  currency: string;
  accent: string;
  theme: 'light' | 'dark';
  watts: number;
  kwh: number;
  wearRate: number;
  failurePct: number;
  markup: number;
  title: string;
  compact: boolean;
  source: string;
}

const SITE = 'https://meshkit.pro';

function num(v: string | null | undefined, fallback: number): number {
  if (v === null || v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Only allow safe colour syntaxes; anything else falls back to the brand accent. */
function safeColor(v: string | null | undefined, fallback: string): string {
  if (!v) return fallback;
  return /^#[0-9a-fA-F]{3,8}$|^rgba?\([\d\s.,%]+\)$|^hsla?\([\d\s.,%deg]+\)$|^[a-zA-Z]{3,20}$/.test(v.trim()) ? v.trim() : fallback;
}

function readConfig(script: HTMLScriptElement): EmbedConfig {
  const d = script.dataset;
  return {
    pricePerKg: Math.max(0, num(d.pricePerKg, 22)),
    currency: (d.currency ?? '$').slice(0, 4),
    accent: safeColor(d.accent, '#C43E0B'),
    theme: d.theme === 'dark' ? 'dark' : 'light',
    watts: Math.max(0, num(d.watts, 150)),
    kwh: Math.max(0, num(d.kwh, 0.16)),
    wearRate: Math.max(0, num(d.wearRate, 0.3)),
    failurePct: Math.min(99, Math.max(0, num(d.failurePct, 10))),
    markup: Math.max(0, num(d.markup, 3)),
    title: (d.title ?? '3D Print Cost Calculator').slice(0, 80),
    compact: d.compact === 'true',
    source: (() => {
      try {
        return new URL(script.src).hostname;
      } catch {
        return '';
      }
    })(),
  };
}

function css(cfg: EmbedConfig): string {
  const light = { bg: '#FAF9F5', panel: '#FFFFFF', text: '#141413', muted: '#5C5B57', border: '#C8C5BC', canvas: '#161615', canvasText: '#EDEDEA' };
  const dark = { bg: '#1A1A18', panel: '#121211', text: '#EDEDEA', muted: '#9E9D97', border: '#32322F', canvas: '#0C0C0B', canvasText: '#EDEDEA' };
  const t = cfg.theme === 'dark' ? dark : light;
  return `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    .mk { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: ${t.text}; background: ${t.bg}; border: 1px solid ${t.border}; border-radius: 10px; padding: 16px; max-width: 560px; }
    .mk h2 { margin: 0 0 12px; font-size: 16px; font-weight: 700; letter-spacing: .01em; }
    .mk .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
    .mk label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: ${t.muted}; margin-bottom: 4px; }
    .mk input, .mk select { width: 100%; font: inherit; font-size: 14px; padding: 7px 9px; border: 1px solid ${t.border}; border-radius: 6px; background: ${t.panel}; color: ${t.text}; }
    .mk input:focus, .mk select:focus { outline: 2px solid ${cfg.accent}; outline-offset: 1px; border-color: ${cfg.accent}; }
    .mk .out { margin-top: 14px; background: ${t.canvas}; color: ${t.canvasText}; border-radius: 8px; padding: 12px 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; font-variant-numeric: tabular-nums; }
    .mk .out .k { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
    .mk .out .v { font-size: 18px; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .mk .out .big .v { font-size: 26px; color: ${cfg.accent}; }
    .mk .out .big { grid-column: 1 / -1; display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,.12); padding-bottom: 8px; margin-bottom: 2px; }
    .mk .warn { color: #FBBF24; font-size: 12px; grid-column: 1 / -1; }
    .mk .foot { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: ${t.muted}; gap: 8px; flex-wrap: wrap; }
    .mk .foot a { color: ${cfg.accent}; font-weight: 600; text-decoration: none; }
    .mk .foot a:hover { text-decoration: underline; }
    .mk .compact .grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
  `;
}

function money(cur: string, n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${cur}${n.toFixed(2)}`;
}

function mount(script: HTMLScriptElement): void {
  const cfg = readConfig(script);
  const host = document.createElement('div');
  host.setAttribute('data-meshkit-embed', 'print-cost');
  script.insertAdjacentElement('afterend', host);
  const root = host.attachShadow({ mode: 'open' });

  const uid = `mk${Math.random().toString(36).slice(2, 8)}`;
  const materials = (materialsData as { materials: Array<{ id: string; name: string; density: number }> }).materials;

  root.innerHTML = `
    <style>${css(cfg)}</style>
    <div class="mk${cfg.compact ? ' compact' : ''}" role="group" aria-label="${cfg.title}">
      <h2>${cfg.title}</h2>
      <div class="grid">
        <div><label for="${uid}-g">Filament used (g)</label><input id="${uid}-g" type="number" min="0" step="1" value="45" inputmode="decimal"></div>
        <div><label for="${uid}-h">Print time (h)</label><input id="${uid}-h" type="number" min="0" step="0.1" value="3.5" inputmode="decimal"></div>
        <div><label for="${uid}-m">Material</label><select id="${uid}-m">${materials.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select></div>
        <div><label for="${uid}-p">Price per kg (${cfg.currency})</label><input id="${uid}-p" type="number" min="0" step="0.5" value="${cfg.pricePerKg}" inputmode="decimal"></div>
        <div><label for="${uid}-x">Markup ×</label><input id="${uid}-x" type="number" min="0" step="0.1" value="${cfg.markup}" inputmode="decimal"></div>
      </div>
      <div class="out" aria-live="polite">
        <div class="big"><span class="k">Suggested price</span><span class="v" id="${uid}-price">—</span></div>
        <div><div class="k">Material</div><div class="v" id="${uid}-mat">—</div></div>
        <div><div class="k">Energy + wear</div><div class="v" id="${uid}-ovh">—</div></div>
        <div><div class="k">Unit cost</div><div class="v" id="${uid}-cost">—</div></div>
        <div><div class="k">Profit / margin</div><div class="v" id="${uid}-profit">—</div></div>
        <div class="warn" id="${uid}-warn" hidden></div>
      </div>
      <div class="foot">
        <span>${cfg.watts} W · ${cfg.currency}${cfg.kwh}/kWh · ${cfg.failurePct}% failure buffer</span>
        <a href="${SITE}/3d-print-cost-calculator?utm_source=embed&utm_medium=widget&utm_campaign=print-cost${cfg.source ? `&utm_content=${encodeURIComponent(location.hostname)}` : ''}" target="_blank" rel="noopener">Powered by MeshKit →</a>
      </div>
    </div>`;

  const q = <T extends HTMLElement>(suffix: string) => root.getElementById(`${uid}-${suffix}`) as T;
  const inputs = ['g', 'h', 'm', 'p', 'x'].map((s) => q<HTMLInputElement | HTMLSelectElement>(s));

  function update(): void {
    const grams = Number(q<HTMLInputElement>('g').value);
    const hours = Number(q<HTMLInputElement>('h').value);
    const pricePerKg = Number(q<HTMLInputElement>('p').value);
    const markupMultiplier = Number(q<HTMLInputElement>('x').value);
    const res = calculatePrintCost({
      grams,
      hours,
      pricePerKg,
      watts: cfg.watts,
      electricityRatePerKwh: cfg.kwh,
      wearRatePerHour: cfg.wearRate,
      failurePct: cfg.failurePct,
      channelFeePct: 0,
      channelFixedFee: 0,
      pricingMode: 'multiplier',
      markupMultiplier,
    });
    const warn = q<HTMLElement>('warn');
    if (!res.ok) {
      ['price', 'mat', 'ovh', 'cost', 'profit'].forEach((s) => (q(s).textContent = '—'));
      warn.hidden = false;
      warn.textContent = res.error;
      return;
    }
    q('price').textContent = money(cfg.currency, res.sellingPrice);
    q('mat').textContent = money(cfg.currency, res.materialCost);
    q('ovh').textContent = money(cfg.currency, res.energyCost + res.wearCost);
    q('cost').textContent = money(cfg.currency, res.unitCost);
    q('profit').textContent = `${money(cfg.currency, res.profit)}${res.marginPct !== null ? ` · ${res.marginPct}%` : ''}`;
    warn.hidden = !res.belowCostWarning;
    warn.textContent = res.belowCostWarning ? 'Selling below cost — markup is under 1×.' : '';
  }

  inputs.forEach((el) => {
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  });
  update();
}

(function boot(): void {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current) {
    mount(current);
    return;
  }
  // Fallback for module/async loaders that lose currentScript: mount after any
  // tag that names this bundle and has not been mounted yet.
  document.querySelectorAll<HTMLScriptElement>('script[src*="/embed/print-cost"]').forEach((s) => {
    if (!s.nextElementSibling?.hasAttribute('data-meshkit-embed')) mount(s);
  });
})();
