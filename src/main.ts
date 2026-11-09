import './style.css';
import channelsData from './data/channels.json';
import {
  formatCurrency,
  formatDurationHours,
  parseStrictNumber,
} from './core/format';
import { calculatePrintCost } from './core/cost';
import { parseGcode, ToolpathPoint } from './core/gcode';
import {
  calculateResinCost,
  calculateResinTime,
  computeHollowShellVolumeMl,
} from './core/resin';
import {
  spoolRemaining,
  gramsToMeters,
  metersToGrams,
  willPrintFinish,
} from './core/spool';
import {
  validateFileMetadata,
  validateTextBufferHead,
  ToolFileKind,
  WORKER_TIMEOUT_MS,
  getWorkerTimeoutMessage,
} from './core/validate';
import {
  auditStl,
  repairStlWithManifoldWasm,
  exportBinaryStl,
  Triangle,
  Vec3,
  StlAuditMetrics,
} from './core/stl';
import {
  convertStepToStlWithOcctWasm,
  StepConvertResult,
  StepConvertOptions,
} from './core/step';
import {
  convert3mfToStl,
  convertStlEncoding,
  convertStlTo3mf,
  type StlEncoding,
  type StlEncodingResult,
  type StlTo3mfResult,
  type ThreeMfToStlResult,
} from './core/convert';
import type { ConvertWorkerRequest } from './workers/convert.worker';
import {
  initAnalyticsConsentMode,
  updateAnalyticsConsent,
  trackFileLoadSuccess,
  trackFileLoadError,
  trackCalculate,
  trackExportDownload,
  trackSampleLoad,
  trackInternalToolLink,
} from './core/analytics';

function maybeEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function debounce(fn: () => void, delayMs = 100): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };
}

/**
 * Runs an async task (in Web Worker or WASM) with the Section 6 60-second timeout check.
 */
async function runWithTimeout<T>(
  taskPromise: Promise<T>,
  onTimeoutPrompt?: (msg: string) => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const msg = getWorkerTimeoutMessage();
      if (onTimeoutPrompt) onTimeoutPrompt(msg);
      reject(new Error(msg));
    }, WORKER_TIMEOUT_MS);
  });

  try {
    return await Promise.race([taskPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

// =========================================================================
// THEME MANAGEMENT & ANALYTICS INITIALIZATION
// =========================================================================
function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = maybeEl('themeToggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? 'THEME: CAD [DARK]' : 'THEME: PAPER [LIGHT]';
  }
}

function toggleTheme(): void {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('meshkit-theme', next);
  } catch {
    // ignore storage errors
  }
  applyTheme(next);
}

try {
  const savedTheme = localStorage.getItem('meshkit-theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    applyTheme(savedTheme);
  }
} catch {
  // ignore
}

maybeEl('themeToggle')?.addEventListener('click', toggleTheme);

initAnalyticsConsentMode();

function initPrivacyPageControls(): void {
  const grantBtn = maybeEl('privacyGrantBtn');
  const denyBtn = maybeEl('privacyDenyBtn');
  const stateLabel = maybeEl('privacyCurrentState');
  if (!grantBtn || !denyBtn || !stateLabel) return;

  function renderConsentState(): void {
    let cur = 'denied (default)';
    try {
      const saved = localStorage.getItem('meshkit-consent-v2');
      if (saved === 'granted' || saved === 'denied') cur = saved;
    } catch {
      // ignore
    }
    stateLabel!.textContent = `CURRENT STATUS: ${cur.toUpperCase()}`;
  }

  grantBtn.addEventListener('click', () => {
    updateAnalyticsConsent('granted');
    renderConsentState();
  });

  denyBtn.addEventListener('click', () => {
    updateAnalyticsConsent('denied');
    renderConsentState();
  });

  renderConsentState();
}

function wireInternalLinkAnalytics(): void {
  document.querySelectorAll<HTMLAnchorElement>('a.route-link, .sub-nav a').forEach((link) => {
    link.addEventListener('click', () => {
      trackInternalToolLink(window.location.pathname, link.getAttribute('href') ?? '');
    });
  });
}

function downloadBlobFile(filename: string, blob: Blob): void {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function downloadTextFile(filename: string, content: string): void {
  downloadBlobFile(filename, new Blob([content], { type: 'text/plain;charset=utf-8' }));
}

function wireDropzone(
  dropzoneId: string,
  fileInputId: string,
  browseBtnId: string,
  kind: ToolFileKind,
  onValidFile: (file: File, notice?: string) => void,
  onValidationError: (message: string, code: string) => void
): void {
  const zone = maybeEl(dropzoneId);
  const input = maybeEl<HTMLInputElement>(fileInputId);
  const browseBtn = maybeEl<HTMLButtonElement>(browseBtnId);
  if (!zone || !input || !browseBtn) return;

  function handleFileList(list: FileList | null | undefined): void {
    if (!list || list.length === 0) return;
    const files = Array.from(list).map((f) => ({ name: f.name, size: f.size }));
    const metaCheck = validateFileMetadata(files, kind);
    if (!metaCheck.ok) {
      trackFileLoadError(kind, metaCheck.errorCode);
      onValidationError(metaCheck.error, metaCheck.errorCode);
      return;
    }
    onValidFile(list[0], metaCheck.notice);
  }

  zone.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' && target.id !== browseBtnId) return;
    input.value = '';
    input.click();
  });

  zone.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.value = '';
      input.click();
    }
  });

  browseBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    input.value = '';
    input.click();
  });

  input.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    handleFileList(target.files);
  });

  zone.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    zone.classList.add('drag-active');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-active'));
  zone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    zone.classList.remove('drag-active');
    handleFileList(e.dataTransfer?.files);
  });
}

// =========================================================================
// TOOL 01: G-CODE TIME & COST / MANUAL 3D PRINT COST CALCULATOR
// =========================================================================
let activeToolpathLayers: ToolpathPoint[][] = [];
let activeBounds: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} | null = null;

function renderRealToolpath(maxPct = 100): void {
  const canvas = maybeEl<HTMLCanvasElement>('gcodeCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#262624';
  ctx.lineWidth = 1;
  for (let x = 40; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 30; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  if (activeToolpathLayers.length === 0 || !activeBounds) {
    ctx.fillStyle = '#9E9D97';
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No preview available — upload a .gcode file with XY moves', canvas.width / 2, canvas.height / 2);
    return;
  }

  const spanX = Math.max(1, activeBounds.maxX - activeBounds.minX);
  const spanY = Math.max(1, activeBounds.maxY - activeBounds.minY);
  const pad = 28;
  const scale = Math.min((canvas.width - pad * 2) / spanX, (canvas.height - pad * 2) / spanY);
  const offsetX = (canvas.width - spanX * scale) / 2;
  const offsetY = (canvas.height - spanY * scale) / 2;

  const limit = Math.max(1, Math.ceil(activeToolpathLayers.length * (maxPct / 100)));
  for (let l = 0; l < limit; l++) {
    const pts = activeToolpathLayers[l];
    if (!pts || pts.length < 2) continue;
    const isTopLayer = l === limit - 1;
    ctx.strokeStyle = isTopLayer ? '#FF5C1A' : 'rgba(235, 233, 225, 0.45)';
    ctx.lineWidth = isTopLayer ? 2.0 : 1.0;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const cx = offsetX + (p.x - activeBounds.minX) * scale;
      const cy = canvas.height - (offsetY + (p.y - activeBounds.minY) * scale);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
}

function initGcodeAndCostPage(): void {
  if (!maybeEl('filamentGrams')) return;

  const matSelect = getEl<HTMLSelectElement>('gcodeMaterialSelect');
  const customDensityWrap = getEl('gcodeCustomDensityWrap');
  const channelSelect = getEl<HTMLSelectElement>('marketplaceFee');
  const customFeeWrap = getEl('customChannelFeeWrap');
  const customFixedWrap = getEl('customChannelFixedWrap');
  const pricingModeSelect = getEl<HTMLSelectElement>('pricingModeSelect');
  const markupSelectWrap = getEl('markupSelectWrap');
  const markupSelect = getEl<HTMLSelectElement>('markupMult');
  const customMarkupWrap = getEl('customMarkupWrap');
  const targetMarginWrap = getEl('targetMarginWrap');
  const banner = getEl('gcodeValidationBanner');

  let lastLoadedGcodeText = '';
  let lastLoadedGcodeName = '';

  const verifiedEl = maybeEl('channelVerifiedNote');
  if (verifiedEl) {
    verifiedEl.textContent = `FEES VERIFIED: ${channelsData.lastVerified}`;
  }

  function syncVisibility(): void {
    customDensityWrap.classList.toggle('hidden', matSelect.value !== 'custom');
    const isCustomChannel = channelSelect.value === 'custom';
    customFeeWrap.classList.toggle('hidden', !isCustomChannel);
    customFixedWrap.classList.toggle('hidden', !isCustomChannel);

    const isTargetMargin = pricingModeSelect.value === 'target_margin';
    markupSelectWrap.classList.toggle('hidden', isTargetMargin);
    targetMarginWrap.classList.toggle('hidden', !isTargetMargin);
    customMarkupWrap.classList.toggle(
      'hidden',
      isTargetMargin || markupSelect.value !== 'custom'
    );
  }

  function pauseOutputs(errorMsg: string): void {
    banner.textContent = errorMsg;
    banner.classList.remove('hidden');
    getEl('outTrueTime').textContent = '—';
    getEl('outMaterialCost').textContent = '—';
    getEl('outMeters').textContent = '—';
    getEl('outOverheadCost').textContent = '—';
    getEl('outUnitCost').textContent = '—';
    getEl('outSellingPrice').textContent = '—';
    getEl('outNetProfit').textContent = 'NET PROFIT: —';
  }

  function getSelectedDensity(): number {
    return matSelect.value === 'custom'
      ? parseStrictNumber(getEl<HTMLInputElement>('gcodeCustomDensity').value)
      : parseStrictNumber(matSelect.value);
  }

  function getSelectedDiameter(): number {
    return parseStrictNumber(getEl<HTMLSelectElement>('gcodeDiameterSelect').value);
  }

  function getSelectedDefaultAccel(): number {
    const accelEl = maybeEl<HTMLInputElement>('gcodeDefaultAccel');
    if (!accelEl) return 1500;
    const val = parseStrictNumber(accelEl.value);
    return Number.isFinite(val) && val > 0 ? val : 1500;
  }

  function recalculateCost(): void {
    syncVisibility();

    const grams = parseStrictNumber(getEl<HTMLInputElement>('filamentGrams').value);
    const hours = parseStrictNumber(getEl<HTMLInputElement>('printHours').value);
    const density = getSelectedDensity();
    const diameter = getSelectedDiameter();
    const pricePerKg = parseStrictNumber(getEl<HTMLInputElement>('spoolCost').value);
    const watts = parseStrictNumber(getEl<HTMLInputElement>('printerWatts').value);
    const electricityRatePerKwh = parseStrictNumber(getEl<HTMLInputElement>('electricityRate').value);
    const wearRatePerHour = parseStrictNumber(getEl<HTMLInputElement>('wearRate').value);
    const failurePct = parseStrictNumber(getEl<HTMLInputElement>('failurePct').value);
    const timeCorrectionPct = parseStrictNumber(getEl<HTMLInputElement>('timeCorrectionPct').value);

    if (!Number.isFinite(density) || density <= 0 || !Number.isFinite(diameter) || diameter <= 0) {
      pauseOutputs('Enter a valid polymer density and filament diameter above zero.');
      return;
    }

    let channelFeePct = 0;
    let channelFixedFee = 0;
    if (channelSelect.value === 'custom') {
      channelFeePct = parseStrictNumber(getEl<HTMLInputElement>('customChannelPct').value);
      channelFixedFee = parseStrictNumber(getEl<HTMLInputElement>('customChannelFixed').value);
    } else {
      const ch = channelsData.channels.find((c) => c.id === channelSelect.value);
      if (ch) {
        channelFeePct = ch.feePct;
        channelFixedFee = ch.fixedFee;
      }
    }

    const pricingMode = pricingModeSelect.value === 'target_margin' ? 'target_margin' : 'multiplier';
    const markupMultiplier =
      markupSelect.value === 'custom'
        ? parseStrictNumber(getEl<HTMLInputElement>('customMarkupVal').value)
        : parseStrictNumber(markupSelect.value);
    const targetMarginPct = parseStrictNumber(getEl<HTMLInputElement>('targetMarginPct').value);

    const res = calculatePrintCost({
      grams,
      hours,
      pricePerKg,
      watts,
      electricityRatePerKwh,
      wearRatePerHour,
      failurePct,
      channelFeePct,
      channelFixedFee,
      pricingMode,
      markupMultiplier,
      targetMarginPct,
      timeCorrectionPct,
    });

    if (!res.ok) {
      pauseOutputs(res.error);
      return;
    }

    if (res.belowCostWarning) {
      banner.textContent = 'Warning: Selling price is below unit cost.';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }

    const lenRes = gramsToMeters(grams, density, diameter);
    const metersStr = lenRes.ok ? `${lenRes.meters.toFixed(1)}m @ ${diameter.toFixed(2)}mm` : '—';

    getEl('outTrueTime').textContent = formatDurationHours(res.adjustedHours);
    getEl('outMaterialCost').textContent = formatCurrency(res.materialCost);
    getEl('outMeters').textContent = metersStr;
    getEl('outOverheadCost').textContent = formatCurrency(res.overheadCost);
    getEl('outOverheadSub').textContent = `$${electricityRatePerKwh.toFixed(2)}/kWh · $${wearRatePerHour.toFixed(2)}/h · ${failurePct}%`;
    getEl('outUnitCost').textContent = formatCurrency(res.unitCost);
    getEl('outSellingPrice').textContent = formatCurrency(res.sellingPrice);

    const marginLabel = res.marginPct !== null ? `${res.marginPct}%` : '—';
    getEl('outNetProfit').textContent = `NET PROFIT: ${formatCurrency(res.profit)} (${marginLabel})`;
    trackCalculate('gcode_cost', channelSelect.value);
  }

  function showGcodeError(msg: string): void {
    const statusTitle = maybeEl('gcodeStatusTitle');
    const parseState = maybeEl('gcodeParseState');
    if (statusTitle) statusTitle.textContent = msg;
    if (parseState) {
      parseState.textContent = 'ERROR';
      parseState.style.color = 'var(--status-warn)';
    }
  }

  async function parseGcodeViaWorker(
    text: string,
    density: number,
    diameter: number,
    defaultAccel: number
  ) {
    if (typeof Worker !== 'undefined') {
      try {
        return await runWithTimeout(
          new Promise<ReturnType<typeof parseGcode>>((resolve, reject) => {
            const worker = new Worker(new URL('./workers/gcode.worker.ts', import.meta.url), {
              type: 'module',
            });
            worker.onmessage = (ev) => {
              worker.terminate();
              resolve(ev.data);
            };
            worker.onerror = (err) => {
              worker.terminate();
              reject(err);
            };
            worker.postMessage({
              text,
              options: {
                densityGPerCm3: density,
                diameterMm: diameter,
                defaultAccelerationMmPerS2: defaultAccel,
              },
            });
          }),
          (timeoutMsg) => showGcodeError(timeoutMsg)
        );
      } catch {
        // fallback to synchronous parse
      }
    }
    return parseGcode(text, {
      densityGPerCm3: density,
      diameterMm: diameter,
      defaultAccelerationMmPerS2: defaultAccel,
    });
  }

  async function loadGcodeText(
    text: string,
    labelName: string,
    byteSize = text.length,
    notice?: string
  ): Promise<void> {
    const t0 = performance.now();
    lastLoadedGcodeText = text;
    lastLoadedGcodeName = labelName;
    const density = getSelectedDensity() || 1.24;
    const diameter = getSelectedDiameter() || 1.75;
    const defaultAccel = getSelectedDefaultAccel();

    const parsed = await parseGcodeViaWorker(text, density, diameter, defaultAccel);

    const statusTitle = maybeEl('gcodeStatusTitle');
    const statusSub = maybeEl('gcodeStatusSub');
    const parseState = maybeEl('gcodeParseState');

    if (!parsed.ok) {
      trackFileLoadError('gcode', 'no_geometry');
      showGcodeError(parsed.error);
      return;
    }

    trackFileLoadSuccess('gcode', 'gcode', byteSize, performance.now() - t0);

    getEl<HTMLInputElement>('filamentGrams').value = parsed.filamentGrams.toFixed(1);
    getEl<HTMLInputElement>('printHours').value = parsed.printHours.toFixed(2);

    const layerLabel = maybeEl('layerCountLabel');
    const moveLabel = maybeEl('moveCountLabel');
    if (layerLabel) layerLabel.textContent = parsed.layerCount.toLocaleString();
    if (moveLabel) moveLabel.textContent = parsed.moveCount.toLocaleString();

    if (statusTitle) {
      statusTitle.textContent = notice ? `${notice} — LOADED: ${labelName}` : `FILE LOADED: ${labelName}`;
    }
    if (statusSub) {
      statusSub.textContent = `Parsed ${parsed.moveCount.toLocaleString()} moves across ${parsed.layerCount.toLocaleString()} Z-layers (${parsed.filamentMm.toFixed(1)} mm E-axis).`;
    }
    if (parseState) {
      parseState.textContent = 'PARSED OK';
      parseState.style.color = 'var(--status-ok)';
    }

    const timeSub = maybeEl('outTimeSub');
    if (timeSub) {
      timeSub.textContent =
        parsed.timeSource === 'slicer_header'
          ? 'Slicer header time'
          : `Estimate (trapezoidal accel @ ${defaultAccel} mm/s²)`;
    }

    activeToolpathLayers = parsed.layers;
    activeBounds = parsed.bounds;
    const slider = maybeEl<HTMLInputElement>('layerSlider');
    const pctLabel = maybeEl('layerPctLabel');
    if (slider) slider.value = '100';
    if (pctLabel) pctLabel.textContent = '100%';
    renderRealToolpath(100);
    recalculateCost();
  }

  const debouncedRecalc = debounce(recalculateCost, 100);
  const inputIds = [
    'filamentGrams',
    'printHours',
    'gcodeMaterialSelect',
    'gcodeCustomDensity',
    'gcodeDiameterSelect',
    'spoolCost',
    'printerWatts',
    'electricityRate',
    'wearRate',
    'failurePct',
    'timeCorrectionPct',
    'marketplaceFee',
    'customChannelPct',
    'customChannelFixed',
    'pricingModeSelect',
    'markupMult',
    'customMarkupVal',
    'targetMarginPct',
  ];

  inputIds.forEach((id) => {
    maybeEl(id)?.addEventListener('input', debouncedRecalc);
    maybeEl(id)?.addEventListener('change', recalculateCost);
  });

  maybeEl('gcodeDefaultAccel')?.addEventListener('change', () => {
    if (lastLoadedGcodeText) {
      void loadGcodeText(lastLoadedGcodeText, lastLoadedGcodeName);
    } else {
      recalculateCost();
    }
  });

  wireDropzone(
    'gcodeDropzone',
    'gcodeFileInput',
    'gcodeBrowseBtn',
    'gcode',
    (file, notice) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result as ArrayBuffer;
        if (!buffer) return;
        const headCheck = validateTextBufferHead(buffer, 'gcode');
        if (!headCheck.ok) {
          trackFileLoadError('gcode', headCheck.errorCode);
          showGcodeError(headCheck.error);
          return;
        }
        const text = new TextDecoder('utf-8').decode(buffer);
        void loadGcodeText(text, file.name, file.size, notice);
      };
      reader.readAsArrayBuffer(file);
    },
    (message) => {
      showGcodeError(message);
    }
  );

  maybeEl<HTMLInputElement>('layerSlider')?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    const pctEl = maybeEl('layerPctLabel');
    if (pctEl) pctEl.textContent = `${val}%`;
    renderRealToolpath(parseInt(val, 10));
  });

  maybeEl('gcodeSampleBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    trackSampleLoad('gcode');
    try {
      const resp = await fetch('/samples/enclosure-bracket.gcode');
      if (resp.ok) {
        const text = await resp.text();
        await loadGcodeText(text, 'enclosure-bracket.gcode', text.length);
      }
    } catch {
      // ignore fetch errors offline
    }
  });

  maybeEl('downloadTestGcodeBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const resp = await fetch('/samples/enclosure-bracket.gcode');
      if (resp.ok) {
        const text = await resp.text();
        downloadTextFile('Sample_Enclosure_Bracket.gcode', text);
        trackExportDownload('gcode_sample', 'gcode');
      }
    } catch {
      // ignore
    }
  });

  maybeEl('printSpecSheetBtn')?.addEventListener('click', () => {
    trackExportDownload('gcode_cost_quote', 'print');
    window.print();
  });

  recalculateCost();
  if (maybeEl('gcodeCanvas')) {
    fetch('/samples/enclosure-bracket.gcode')
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        if (text) {
          lastLoadedGcodeText = text;
          lastLoadedGcodeName = 'enclosure-bracket.gcode';
          const parsed = parseGcode(text);
          if (parsed.ok) {
            activeToolpathLayers = parsed.layers;
            activeBounds = parsed.bounds;
            const layerLabel = maybeEl('layerCountLabel');
            const moveLabel = maybeEl('moveCountLabel');
            if (layerLabel) layerLabel.textContent = parsed.layerCount.toLocaleString();
            if (moveLabel) moveLabel.textContent = parsed.moveCount.toLocaleString();
            renderRealToolpath(100);
          }
        }
      })
      .catch(() => renderRealToolpath(100));
  }
}

// =========================================================================
// TOOL 02B: STL VOLUME & WEIGHT CALCULATOR PAGE
// =========================================================================
function initStlVolumePage(): void {
  if (!maybeEl('stlVolInputCm3')) return;

  const matSelect = getEl<HTMLSelectElement>('stlVolMaterialSelect');
  const customWrap = getEl('stlVolCustomDensityWrap');
  const banner = getEl('stlVolValidationBanner');

  function calc(): void {
    customWrap.classList.toggle('hidden', matSelect.value !== 'custom');
    const volCm3 = parseStrictNumber(getEl<HTMLInputElement>('stlVolInputCm3').value);
    const infillPct = parseStrictNumber(getEl<HTMLInputElement>('stlVolInfillPct').value);
    const density =
      matSelect.value === 'custom'
        ? parseStrictNumber(getEl<HTMLInputElement>('stlVolCustomDensity').value)
        : parseStrictNumber(matSelect.value);
    const diameter = parseStrictNumber(getEl<HTMLSelectElement>('stlVolDiameterSelect').value);

    if (
      !Number.isFinite(volCm3) ||
      volCm3 < 0 ||
      !Number.isFinite(infillPct) ||
      infillPct <= 0 ||
      infillPct > 100 ||
      !Number.isFinite(density) ||
      density <= 0 ||
      !Number.isFinite(diameter) ||
      diameter <= 0
    ) {
      banner.textContent = 'Enter valid positive numbers for volume, fill % (1–100%), and density.';
      banner.classList.remove('hidden');
      getEl('outStlVolCm3').textContent = '—';
      getEl('outStlWeightG').textContent = '—';
      getEl('outStlMeters').textContent = '—';
      getEl('outStlSpoolPct').textContent = '—';
      return;
    }

    banner.classList.add('hidden');
    const effectiveVol = volCm3 * (infillPct / 100);
    const weightG = effectiveVol * density;
    const lenRes = gramsToMeters(weightG, density, diameter);

    getEl('outStlVolCm3').textContent = `${effectiveVol.toFixed(2)} cm³`;
    getEl('outStlWeightG').textContent = `${weightG.toFixed(1)} g`;
    getEl('outStlDensitySub').textContent = `@ ${density.toFixed(2)} g/cm³`;
    getEl('outStlMeters').textContent = lenRes.ok ? `${lenRes.meters.toFixed(1)} m` : '—';
    getEl('outStlDiaSub').textContent = `${diameter.toFixed(2)} mm diameter`;
    getEl('outStlSpoolPct').textContent = `${((weightG / 1000) * 100).toFixed(1)}%`;
    trackCalculate('stl_volume_weight');
  }

  wireDropzone(
    'stlVolDropzone',
    'stlVolFileInput',
    'stlVolBrowseBtn',
    'stl',
    (file, notice) => {
      const t0 = performance.now();
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result as ArrayBuffer;
        if (!buffer) return;
        const res = auditStl(buffer);
        const statusTitle = maybeEl('stlVolStatusTitle');
        const parseState = maybeEl('stlVolParseState');
        if (!res.ok) {
          trackFileLoadError('stl', res.errorCode);
          if (statusTitle) statusTitle.textContent = res.error;
          if (parseState) {
            parseState.textContent = 'ERROR';
            parseState.style.color = 'var(--status-warn)';
          }
          return;
        }
        trackFileLoadSuccess('stl_volume', res.metrics.format, file.size, performance.now() - t0);
        if (statusTitle) {
          const prefix = notice ? `${notice} — ` : '';
          statusTitle.textContent = `${prefix}FILE LOADED: ${file.name} (${res.metrics.triangleCount.toLocaleString()} tris, ${res.metrics.volumeCm3.toFixed(3)} cm³)`;
        }
        if (parseState) {
          parseState.textContent = 'PARSED OK';
          parseState.style.color = 'var(--status-ok)';
        }
        getEl<HTMLInputElement>('stlVolInputCm3').value = res.metrics.volumeCm3.toFixed(3);
        calc();
      };
      reader.readAsArrayBuffer(file);
    },
    (message) => {
      const statusTitle = maybeEl('stlVolStatusTitle');
      const parseState = maybeEl('stlVolParseState');
      if (statusTitle) statusTitle.textContent = message;
      if (parseState) {
        parseState.textContent = 'ERROR';
        parseState.style.color = 'var(--status-warn)';
      }
    }
  );

  const debouncedCalc = debounce(calc, 100);
  ['stlVolInputCm3', 'stlVolInfillPct', 'stlVolMaterialSelect', 'stlVolCustomDensity', 'stlVolDiameterSelect'].forEach(
    (id) => {
      maybeEl(id)?.addEventListener('input', debouncedCalc);
      maybeEl(id)?.addEventListener('change', calc);
    }
  );

  calc();
}

// =========================================================================
// TOOL 02: STL REPAIR & WATERTIGHT TOPOLOGY AUDITOR
// =========================================================================
function initStlPage(): void {
  if (!maybeEl('stlCanvas')) return;

  let activeTriangles: Triangle[] = [];
  let activeFileName = 'mesh.stl';

  function drawStlWireframe(triangles: Triangle[], isWatertight: boolean): void {
    const c = getEl<HTMLCanvasElement>('stlCanvas');
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);

    ctx.strokeStyle = '#262624';
    ctx.lineWidth = 1;
    for (let x = 40; x < c.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
      ctx.stroke();
    }
    for (let y = 30; y < c.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(c.width, y);
      ctx.stroke();
    }

    if (triangles.length === 0) {
      ctx.fillStyle = '#9E9D97';
      ctx.font = '12px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Upload an .STL file or click "LOAD DEFECTIVE SAMPLE" to inspect mesh topology', c.width / 2, c.height / 2);
      return;
    }

    const cosA = Math.cos(Math.PI / 6);
    const sinA = Math.sin(Math.PI / 6);
    const project = (v: Vec3): [number, number] => {
      const px = (v.x - v.y) * cosA;
      const py = (v.x + v.y) * sinA - v.z;
      return [px, py];
    };

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const step = Math.max(1, Math.floor(triangles.length / 1500));
    for (let i = 0; i < triangles.length; i += step) {
      const t = triangles[i];
      for (const v of [t.v0, t.v1, t.v2]) {
        const [px, py] = project(v);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }

    const spanX = Math.max(1e-3, maxX - minX);
    const spanY = Math.max(1e-3, maxY - minY);
    const pad = 28;
    const scale = Math.min((c.width - pad * 2) / spanX, (c.height - pad * 2) / spanY);
    const cxOffset = (c.width - spanX * scale) / 2;
    const cyOffset = (c.height - spanY * scale) / 2;

    ctx.strokeStyle = isWatertight ? '#34D399' : '#FF5C1A';
    ctx.lineWidth = 1.25;

    for (let i = 0; i < triangles.length; i += step) {
      const t = triangles[i];
      const [x0, y0] = project(t.v0);
      const [x1, y1] = project(t.v1);
      const [x2, y2] = project(t.v2);

      ctx.beginPath();
      ctx.moveTo(cxOffset + (x0 - minX) * scale, cyOffset + (y0 - minY) * scale);
      ctx.lineTo(cxOffset + (x1 - minX) * scale, cyOffset + (y1 - minY) * scale);
      ctx.lineTo(cxOffset + (x2 - minX) * scale, cyOffset + (y2 - minY) * scale);
      ctx.closePath();
      ctx.stroke();
    }
  }

  function renderMetrics(metrics: StlAuditMetrics, statusText: string, isRepairedPass = false): void {
    getEl('stlTris').textContent = metrics.triangleCount.toLocaleString();
    getEl('stlHoles').textContent = metrics.holes.toLocaleString();
    getEl('stlBoundaryEdgesSub').textContent = `${metrics.boundaryEdges.toLocaleString()} boundary edges`;
    getEl('stlNormals').textContent = metrics.flippedFaces.toLocaleString();
    getEl('stlVolume').textContent = `${metrics.volumeCm3.toFixed(3)} cm³`;
    getEl('stlVolumeSub').textContent = metrics.isInsideOut
      ? 'Warning: Inside-out (negative signed vol)'
      : metrics.isWatertight
        ? 'Watertight closed manifold'
        : 'Open mesh (approx. volume)';

    const { sizeX, sizeY, sizeZ } = metrics.bboxMm;
    getEl('stlBboxOut').textContent = `${sizeX.toFixed(2)} × ${sizeY.toFixed(2)} × ${sizeZ.toFixed(2)} mm`;
    getEl('stlAreaOut').textContent = `${metrics.surfaceAreaCm2.toFixed(2)} cm²`;
    getEl('stlNonManifoldOut').textContent = metrics.nonManifoldEdges.toLocaleString();
    getEl('stlDegenerateOut').textContent = metrics.degenerateFaces.toLocaleString();

    const badge = getEl('stlStatusBadge');
    const holesEl = getEl('stlHoles');
    const normalsEl = getEl('stlNormals');

    if (metrics.isWatertight && metrics.flippedFaces === 0 && !metrics.isInsideOut) {
      badge.textContent = isRepairedPass ? 'STATUS: REPAIRED (0 DEFECTS)' : 'STATUS: WATERTIGHT (0 DEFECTS)';
      badge.style.color = '#34D399';
      holesEl.style.color = 'var(--status-ok)';
      normalsEl.style.color = 'var(--status-ok)';
    } else {
      badge.textContent = isRepairedPass
        ? `STATUS: PARTIAL REPAIR (${metrics.boundaryEdges} OPEN EDGES REMAIN)`
        : `STATUS: DEFECTS DETECTED (${metrics.holes} HOLES, ${metrics.boundaryEdges} OPEN EDGES)`;
      badge.style.color = '#FBBF24';
      holesEl.style.color = metrics.holes > 0 ? 'var(--accent)' : 'var(--status-ok)';
      normalsEl.style.color = metrics.flippedFaces > 0 ? 'var(--status-warn)' : 'var(--status-ok)';
    }

    getEl('stlRepairLog').textContent = statusText;
    drawStlWireframe(activeTriangles, metrics.isWatertight && metrics.flippedFaces === 0);
  }

  function showStlError(msg: string): void {
    getEl('stlFileName').textContent = msg;
    const parseState = getEl('stlParseState');
    parseState.textContent = 'ERROR';
    parseState.style.color = 'var(--status-warn)';
    getEl('stlStatusBadge').textContent = 'STATUS: INVALID STL FILE';
    getEl('stlStatusBadge').style.color = 'var(--status-warn)';
    getEl('stlRepairLog').textContent = msg;
  }

  async function auditStlViaWorker(buffer: ArrayBuffer) {
    if (typeof Worker !== 'undefined') {
      try {
        return await runWithTimeout(
          new Promise<ReturnType<typeof auditStl>>((resolve, reject) => {
            const worker = new Worker(new URL('./workers/stl.worker.ts', import.meta.url), {
              type: 'module',
            });
            worker.onmessage = (ev) => {
              worker.terminate();
              resolve(ev.data.result);
            };
            worker.onerror = (err) => {
              worker.terminate();
              reject(err);
            };
            worker.postMessage({ action: 'audit', buffer });
          }),
          (timeoutMsg) => showStlError(timeoutMsg)
        );
      } catch {
        // fallback to synchronous
      }
    }
    return auditStl(buffer);
  }

  async function repairStlViaWorker(triangles: Triangle[]) {
    if (typeof Worker !== 'undefined') {
      try {
        return await runWithTimeout(
          new Promise<Awaited<ReturnType<typeof repairStlWithManifoldWasm>>>((resolve, reject) => {
            const worker = new Worker(new URL('./workers/stl.worker.ts', import.meta.url), {
              type: 'module',
            });
            worker.onmessage = (ev) => {
              worker.terminate();
              resolve(ev.data.result);
            };
            worker.onerror = (err) => {
              worker.terminate();
              reject(err);
            };
            worker.postMessage({ action: 'repair', triangles });
          }),
          (timeoutMsg) => showStlError(timeoutMsg)
        );
      } catch {
        // fallback to direct WASM repair
      }
    }
    return repairStlWithManifoldWasm(triangles);
  }

  async function loadStlBuffer(buffer: ArrayBuffer, filename: string, notice?: string): Promise<void> {
    const t0 = performance.now();
    const res = await auditStlViaWorker(buffer);
    if (!res.ok) {
      trackFileLoadError('stl', res.errorCode);
      showStlError(res.error);
      return;
    }

    trackFileLoadSuccess('stl_repair', res.metrics.format, buffer.byteLength, performance.now() - t0);
    activeTriangles = res.triangles;
    activeFileName = filename;

    const parseState = getEl('stlParseState');
    parseState.textContent = `${res.metrics.format.toUpperCase()} STL`;
    parseState.style.color = 'var(--status-ok)';
    const prefix = notice ? `${notice} — ` : '';
    getEl('stlFileName').textContent = `${prefix}FILE LOADED: ${filename} (${(buffer.byteLength / 1024).toFixed(1)} KB)`;

    const summary = res.metrics.isWatertight
      ? `Audited ${res.metrics.triangleCount} facets (${res.metrics.weldedVertexCount} welded vertices): 0 open edges, watertight volume = ${res.metrics.volumeCm3.toFixed(3)} cm³.`
      : `Audited ${res.metrics.triangleCount} facets: found ${res.metrics.holes} open hole loop(s) (${res.metrics.boundaryEdges} boundary edges) and ${res.metrics.flippedFaces} flipped normal(s). Click EXECUTE MANIFOLD REPAIR.`;
    renderMetrics(res.metrics, summary, false);
  }

  wireDropzone(
    'stlDropzone',
    'stlFileInput',
    'stlBrowseBtn',
    'stl',
    (file, notice) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result as ArrayBuffer;
        if (!buffer) return;
        void loadStlBuffer(buffer, file.name, notice);
      };
      reader.readAsArrayBuffer(file);
    },
    (message) => {
      showStlError(message);
    }
  );

  maybeEl('runStlRepairBtn')?.addEventListener('click', async () => {
    if (activeTriangles.length === 0) {
      showStlError('Please upload an .STL file or click LOAD DEFECTIVE SAMPLE first.');
      return;
    }
    const rep = await repairStlViaWorker(activeTriangles);
    if (!rep.ok) {
      showStlError(rep.error);
      return;
    }
    activeTriangles = rep.triangles;
    trackCalculate('stl_repair');
    renderMetrics(rep.after, rep.statusMessage, true);
  });

  maybeEl('downloadRepairedStlBtn')?.addEventListener('click', () => {
    if (activeTriangles.length === 0) {
      showStlError('Load and audit an .STL file before downloading.');
      return;
    }
    const binBuffer = exportBinaryStl(activeTriangles);
    const baseName = activeFileName.replace(/\.stl$/i, '');
    downloadBlobFile(
      `${baseName}-repaired.stl`,
      new Blob([binBuffer], { type: 'application/octet-stream' })
    );
    trackExportDownload('stl_repair', 'binary_stl');
  });

  maybeEl('stlSampleBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    trackSampleLoad('stl');
    try {
      const resp = await fetch('/samples/defective-cube.stl');
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        await loadStlBuffer(buf, 'defective-cube.stl');
      }
    } catch {
      // ignore offline
    }
  });

  maybeEl('downloadTestStlBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const resp = await fetch('/samples/defective-cube.stl');
      if (resp.ok) {
        const text = await resp.text();
        downloadTextFile('defective-cube.stl', text);
        trackExportDownload('stl_sample', 'ascii_stl');
      }
    } catch {
      // ignore
    }
  });

  fetch('/samples/defective-cube.stl')
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => {
      if (buf) {
        void loadStlBuffer(buf, 'defective-cube.stl');
      } else {
        drawStlWireframe([], false);
      }
    })
    .catch(() => drawStlWireframe([], false));
}

// =========================================================================
// TOOL 03: STEP TO STL CONVERTER (ISO-10303-21 B-REP TESSELLATOR)
// =========================================================================
function initStepPage(): void {
  if (!maybeEl('stepTolPresetSelect')) return;

  const presetSelect = getEl<HTMLSelectElement>('stepTolPresetSelect');
  const customWrap = getEl('stepCustomTolWrap');
  const customInput = getEl<HTMLInputElement>('stepCustomTolInput');
  const unitsSelect = getEl<HTMLSelectElement>('stepUnitsSelect');
  const formatSelect = getEl<HTMLSelectElement>('stepOutputFormatSelect');
  const logBox = getEl('stepLogBox');
  const progressBarWrap = maybeEl('stepProgressBarWrap');
  const progressBarFill = maybeEl('stepProgressBarFill');
  const retryBtn = maybeEl('stepRetryBtn');

  let activeStepText = '';
  let activeStepName = 'planetary-gear-housing.step';
  let lastConversion: Extract<StepConvertResult, { ok: true }> | null = null;

  function setProgress(pct: number | null): void {
    if (!progressBarWrap || !progressBarFill) return;
    if (pct === null) {
      progressBarWrap.classList.add('hidden');
      progressBarFill.style.width = '0%';
    } else {
      progressBarWrap.classList.remove('hidden');
      progressBarFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }
  }

  function getSelectedTolerance(): number {
    return presetSelect.value === 'custom'
      ? parseStrictNumber(customInput.value)
      : parseStrictNumber(presetSelect.value);
  }

  function renderStepError(message: string, allowRetry = false): void {
    setProgress(null);
    retryBtn?.classList.toggle('hidden', !allowRetry);
    const parseState = getEl('stepParseState');
    parseState.textContent = 'ERROR';
    parseState.style.color = 'var(--status-warn)';
    getEl('stepFileName').textContent = message;
    getEl('stepBbox').textContent = '—';
    getEl('stepTriOut').textContent = '—';
    getEl('stepFileSize').textContent = '—';
    getEl('stepExportStatus').textContent = message;
    logBox.innerHTML = `<div style="color:#FF5C1A; margin-bottom:8px;">// ISO-10303-21 STEP VALIDATION ERROR</div><div style="color:var(--status-warn);">${message}</div>`;
    lastConversion = null;
  }

  async function convertViaWorkerOrWasm(
    text: string,
    options: StepConvertOptions
  ): Promise<StepConvertResult> {
    const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
    if (typeof Worker !== 'undefined') {
      try {
        return await runWithTimeout(
          new Promise<StepConvertResult>((resolve, reject) => {
            const worker = new Worker(new URL('./workers/step.worker.ts', import.meta.url), {
              type: 'module',
            });
            worker.onmessage = (ev) => {
              worker.terminate();
              resolve(ev.data);
            };
            worker.onerror = (err) => {
              worker.terminate();
              reject(err);
            };
            worker.postMessage({ buffer, options });
          }),
          (timeoutMsg) => renderStepError(timeoutMsg, true)
        );
      } catch {
        // fallback to direct WASM call
      }
    }
    return convertStepToStlWithOcctWasm(buffer, options);
  }

  async function runTessellation(): Promise<void> {
    const isCustom = presetSelect.value === 'custom';
    customWrap.classList.toggle('hidden', !isCustom);
    const tol = getSelectedTolerance();
    const units = unitsSelect.value === 'inch' ? 'inch' : 'mm';
    const format = formatSelect.value === 'ascii' ? 'ascii' : 'binary';

    getEl('stepFormatSub').textContent = format === 'ascii' ? 'ASCII STL' : 'Binary STL';

    if (!Number.isFinite(tol) || tol <= 0) {
      getEl('stepTolLabel').textContent = '—';
      getEl('stepChordVal').textContent = '—';
      renderStepError('Enter a linear deflection tolerance greater than 0 mm.');
      return;
    }

    getEl('stepTolLabel').textContent = `${tol.toFixed(3)} mm`;
    getEl('stepChordVal').textContent = `${tol.toFixed(3)} mm`;

    if (!activeStepText) return;

    retryBtn?.classList.add('hidden');
    setProgress(35);

    const res = await convertViaWorkerOrWasm(activeStepText, {
      linearDeflectionMm: tol,
      units,
      outputFormat: format,
    });

    setProgress(100);
    setTimeout(() => setProgress(null), 250);

    if (!res.ok) {
      trackFileLoadError('step', res.errorCode);
      renderStepError(res.error, res.errorCode === 'lib_failed');
      return;
    }

    lastConversion = res;
    trackCalculate('step_to_stl');

    const parseState = getEl('stepParseState');
    parseState.textContent = 'ISO-10303-21';
    parseState.style.color = 'var(--status-ok)';

    const { sizeX, sizeY, sizeZ } = res.bbox;
    const unitSuffix = units === 'inch' ? 'in' : 'mm';
    getEl('stepBbox').textContent = `${sizeX.toFixed(2)} × ${sizeY.toFixed(2)} × ${sizeZ.toFixed(2)} ${unitSuffix}`;
    getEl('stepSolidsSub').textContent = `${res.solidCount} solid(s) · ${res.shellCount} shell(s) · ${res.faceCount} face(s)`;
    getEl('stepTriOut').textContent = res.triangleCount.toLocaleString();
    getEl('stepFileSize').textContent =
      res.outputByteLength >= 1024 * 1024
        ? `${(res.outputByteLength / (1024 * 1024)).toFixed(2)} MB`
        : `${(res.outputByteLength / 1024).toFixed(1)} KB`;
    getEl('stepExportStatus').textContent = `Ready: ${res.triangleCount.toLocaleString()} facets (${res.outputByteLength.toLocaleString()} bytes, ${format.toUpperCase()} STL).`;

    logBox.innerHTML = [
      `<div style="color:#FF5C1A; margin-bottom:8px;">// ISO-10303-21 STEP CONVERTER LOG — ${activeStepName}</div>`,
      ...res.logs.map((line) => `<div>[OK] ${line}</div>`),
    ].join('');
  }

  async function loadStepString(
    text: string,
    filename: string,
    byteSize = text.length,
    notice?: string
  ): Promise<void> {
    const t0 = performance.now();
    activeStepText = text;
    activeStepName = filename;
    const prefix = notice ? `${notice} — ` : '';
    getEl('stepFileName').textContent = `${prefix}FILE LOADED: ${filename} (${(byteSize / 1024).toFixed(1)} KB)`;
    await runTessellation();
    if (lastConversion) {
      trackFileLoadSuccess('step_to_stl', 'step', byteSize, performance.now() - t0);
    }
  }

  wireDropzone(
    'stepDropzone',
    'stepFileInput',
    'stepBrowseBtn',
    'step',
    (file, notice) => {
      setProgress(15);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result as ArrayBuffer;
        if (!buffer) return;
        const headCheck = validateTextBufferHead(buffer, 'step');
        if (!headCheck.ok) {
          trackFileLoadError('step', headCheck.errorCode);
          renderStepError(headCheck.error);
          return;
        }
        const text = new TextDecoder('utf-8').decode(buffer);
        void loadStepString(text, file.name, file.size, notice);
      };
      reader.readAsArrayBuffer(file);
    },
    (message) => {
      renderStepError(message);
    }
  );

  retryBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeStepText) {
      void runTessellation();
    }
  });

  const debouncedTessellate = debounce(() => {
    void runTessellation();
  }, 100);

  ['stepTolPresetSelect', 'stepCustomTolInput', 'stepUnitsSelect', 'stepOutputFormatSelect'].forEach((id) => {
    maybeEl(id)?.addEventListener('input', debouncedTessellate);
    maybeEl(id)?.addEventListener('change', () => {
      void runTessellation();
    });
  });

  maybeEl('downloadConvertedStlBtn')?.addEventListener('click', () => {
    if (!lastConversion) {
      renderStepError('Select a valid .STEP file before exporting .STL.');
      return;
    }
    const baseName = activeStepName.replace(/\.(step|stp)$/i, '');
    if (lastConversion.outputFormat === 'ascii' && lastConversion.asciiStl) {
      downloadTextFile(`${baseName}.stl`, lastConversion.asciiStl);
      trackExportDownload('step_to_stl', 'ascii_stl');
    } else {
      downloadBlobFile(
        `${baseName}.stl`,
        new Blob([lastConversion.binaryStl], { type: 'application/octet-stream' })
      );
      trackExportDownload('step_to_stl', 'binary_stl');
    }
  });

  maybeEl('stepSampleBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    trackSampleLoad('step');
    try {
      setProgress(15);
      const resp = await fetch('/samples/planetary-gear-housing.step');
      if (resp.ok) {
        const text = await resp.text();
        await loadStepString(text, 'planetary-gear-housing.step', text.length);
      } else {
        renderStepError('The converter could not start. Check your connection and retry.', true);
      }
    } catch {
      renderStepError('The converter could not start. Check your connection and retry.', true);
    }
  });

  maybeEl('downloadTestStepBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const resp = await fetch('/samples/planetary-gear-housing.step');
      if (resp.ok) {
        const text = await resp.text();
        downloadTextFile('planetary-gear-housing.step', text);
        trackExportDownload('step_sample', 'step');
      }
    } catch {
      // ignore
    }
  });

  fetch('/samples/planetary-gear-housing.step')
    .then((r) => (r.ok ? r.text() : ''))
    .then((text) => {
      if (text) void loadStepString(text, 'planetary-gear-housing.step', text.length);
    })
    .catch(() => {
      void runTessellation();
    });
}

// =========================================================================
// TOOL 04: SLA / MSLA RESIN CALCULATOR
// =========================================================================
function initResinPage(): void {
  if (!maybeEl('resinVolMl')) return;

  const hollowSelect = getEl<HTMLSelectElement>('resinHollowMode');
  const customRetainedWrap = getEl('resinCustomRetainedWrap');
  const layerSelect = getEl<HTMLSelectElement>('resinLayerHeightSelect');
  const customLayerWrap = getEl('resinCustomLayerWrap');
  const priceBasisSelect = getEl<HTMLSelectElement>('resinPriceBasis');
  const banner = getEl('resinValidationBanner');

  let uploadedStlSurfaceAreaCm2: number | null = null;

  const WALL_THICKNESS_MAP: Record<string, number> = {
    '0.22': 1.0,
    '0.30': 1.5,
    '0.42': 2.0,
    '0.52': 2.5,
    '0.60': 3.0,
  };

  function calcResin(): void {
    customRetainedWrap.classList.toggle('hidden', hollowSelect.value !== 'custom');
    customLayerWrap.classList.toggle('hidden', layerSelect.value !== 'custom');

    const basis = priceBasisSelect.value === 'per_kg' ? 'per_kg' : 'per_liter';
    getEl('resinRateUnitTag').textContent = basis === 'per_kg' ? '[$/kg]' : '[$/L]';

    const solidVolumeMl = parseStrictNumber(getEl<HTMLInputElement>('resinVolMl').value);
    const supportPct = parseStrictNumber(getEl<HTMLInputElement>('resinSupportPct').value);

    let retainedFraction: number;
    if (hollowSelect.value === 'custom') {
      retainedFraction = parseStrictNumber(getEl<HTMLInputElement>('resinCustomRetainedPct').value) / 100;
    } else if (
      uploadedStlSurfaceAreaCm2 !== null &&
      hollowSelect.value !== '1' &&
      WALL_THICKNESS_MAP[hollowSelect.value] !== undefined &&
      solidVolumeMl > 0
    ) {
      const wallMm = WALL_THICKNESS_MAP[hollowSelect.value];
      const shellMl = computeHollowShellVolumeMl(solidVolumeMl, uploadedStlSurfaceAreaCm2, wallMm);
      retainedFraction = Number.isFinite(shellMl) ? shellMl / solidVolumeMl : parseStrictNumber(hollowSelect.value);
    } else {
      retainedFraction = parseStrictNumber(hollowSelect.value);
    }

    const pricePerUnit = parseStrictNumber(getEl<HTMLInputElement>('resinBottleCost').value);
    const densityGPerMl = parseStrictNumber(getEl<HTMLInputElement>('resinDensity').value);

    const ipaPerPrint = parseStrictNumber(getEl<HTMLInputElement>('resinIpaCost').value);
    const glovesPerPrint = parseStrictNumber(getEl<HTMLInputElement>('resinGlovesCost').value);
    const fepCost = parseStrictNumber(getEl<HTMLInputElement>('resinFepCost').value);
    const printsPerFep = parseStrictNumber(getEl<HTMLInputElement>('resinPrintsPerFep').value);
    const lcdCost = parseStrictNumber(getEl<HTMLInputElement>('resinLcdCost').value);
    const printsPerLcd = parseStrictNumber(getEl<HTMLInputElement>('resinPrintsPerLcd').value);

    const heightMm = parseStrictNumber(getEl<HTMLInputElement>('resinHeightMm').value);
    const layerHeightMm =
      layerSelect.value === 'custom'
        ? parseStrictNumber(getEl<HTMLInputElement>('resinCustomLayerMm').value)
        : parseStrictNumber(layerSelect.value);
    const exposureSec = parseStrictNumber(getEl<HTMLInputElement>('resinExpSec').value);
    const liftRetractSec = parseStrictNumber(getEl<HTMLInputElement>('resinLiftSec').value);
    const bottomLayers = parseStrictNumber(getEl<HTMLInputElement>('resinBottomLayers').value);
    const bottomExposureSec = parseStrictNumber(getEl<HTMLInputElement>('resinBottomExpSec').value);
    const markupMultiplier = parseStrictNumber(getEl<HTMLInputElement>('resinMarkup').value);

    const costRes = calculateResinCost({
      solidVolumeMl,
      retainedFraction,
      supportPct,
      pricePerUnit,
      priceBasis: basis,
      densityGPerMl,
      ipaPerPrint,
      glovesPerPrint,
      fepCost,
      printsPerFep,
      lcdCost,
      printsPerLcd,
      markupMultiplier,
    });

    const timeRes = calculateResinTime({
      heightMm,
      layerHeightMm,
      exposureSec,
      liftRetractSec,
      bottomLayers,
      bottomExposureSec,
    });

    if (!costRes.ok || !timeRes.ok) {
      banner.textContent = !costRes.ok ? costRes.error : (!timeRes.ok ? timeRes.error : 'Invalid input.');
      banner.classList.remove('hidden');
      getEl('outResinMl').textContent = '—';
      getEl('outResinLiquidCost').textContent = '—';
      getEl('outResinConsumables').textContent = '—';
      getEl('outResinTime').textContent = '—';
      getEl('outResinLayers').textContent = '—';
      getEl('outResinPrice').textContent = '—';
      return;
    }

    banner.classList.add('hidden');
    getEl('outResinMl').textContent = `${costRes.resinMl.toFixed(1)} mL`;
    getEl('outResinGramsSub').textContent = `${costRes.resinGrams.toFixed(1)} g @ ${densityGPerMl.toFixed(2)} g/mL`;
    getEl('outResinLiquidCost').textContent = formatCurrency(costRes.resinLiquidCost);
    getEl('outResinConsumables').textContent = formatCurrency(costRes.consumablesCost);
    getEl('outResinTime').textContent = timeRes.formattedTime;
    getEl('outResinLayers').textContent = `${timeRes.layers.toLocaleString()} Z-slices`;
    getEl('outResinQuoteLabel').textContent = `RECOMMENDED COMMERCIAL QUOTE (${markupMultiplier.toFixed(1)}x MARKUP)`;
    getEl('outResinPrice').textContent = `${formatCurrency(costRes.recommendedQuote)} (Unit Cost: ${formatCurrency(costRes.unitCost)})`;
    trackCalculate('resin_cost');
  }

  wireDropzone(
    'resinStlDropzone',
    'resinStlFileInput',
    'resinStlBrowseBtn',
    'stl',
    (file) => {
      const t0 = performance.now();
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result as ArrayBuffer;
        if (!buffer) return;
        const res = auditStl(buffer);
        const statusEl = maybeEl('resinStlStatus');
        if (!res.ok) {
          trackFileLoadError('resin_stl', res.errorCode);
          if (statusEl) statusEl.textContent = res.error;
          return;
        }
        trackFileLoadSuccess('resin_stl', res.metrics.format, file.size, performance.now() - t0);
        uploadedStlSurfaceAreaCm2 = res.metrics.surfaceAreaCm2;
        getEl<HTMLInputElement>('resinVolMl').value = res.metrics.volumeCm3.toFixed(2);
        getEl<HTMLInputElement>('resinHeightMm').value = res.metrics.bboxMm.sizeZ.toFixed(1);
        if (statusEl) {
          statusEl.textContent = `STL LOADED: ${file.name} (${res.metrics.volumeCm3.toFixed(2)} mL, area ${res.metrics.surfaceAreaCm2.toFixed(1)} cm², Z=${res.metrics.bboxMm.sizeZ.toFixed(1)} mm)`;
        }
        calcResin();
      };
      reader.readAsArrayBuffer(file);
    },
    (message) => {
      const statusEl = maybeEl('resinStlStatus');
      if (statusEl) statusEl.textContent = message;
    }
  );

  const debouncedCalcResin = debounce(calcResin, 100);
  const ids = [
    'resinVolMl',
    'resinSupportPct',
    'resinHollowMode',
    'resinCustomRetainedPct',
    'resinPriceBasis',
    'resinBottleCost',
    'resinDensity',
    'resinIpaCost',
    'resinGlovesCost',
    'resinFepCost',
    'resinPrintsPerFep',
    'resinLcdCost',
    'resinPrintsPerLcd',
    'resinHeightMm',
    'resinLayerHeightSelect',
    'resinCustomLayerMm',
    'resinExpSec',
    'resinLiftSec',
    'resinBottomLayers',
    'resinBottomExpSec',
    'resinMarkup',
  ];

  ids.forEach((id) => {
    maybeEl(id)?.addEventListener('input', debouncedCalcResin);
    maybeEl(id)?.addEventListener('change', calcResin);
  });

  maybeEl('printResinQuoteBtn')?.addEventListener('click', () => {
    trackExportDownload('resin_quote', 'print');
    window.print();
  });

  calcResin();
}

// =========================================================================
// TOOL 05: SPOOL WEIGHT CALCULATOR, TARE DATABASE & GRAMS-TO-METERS
// =========================================================================
function initSpoolPage(): void {
  if (!maybeEl('spoolBrandSelect')) return;

  const brandSelect = getEl<HTMLSelectElement>('spoolBrandSelect');
  const customTareWrap = getEl('customTareWrap');
  const sizeSelect = getEl<HTMLSelectElement>('spoolSizeSelect');
  const customSizeWrap = getEl('customSpoolSizeWrap');
  const diaSelect = getEl<HTMLSelectElement>('spoolDiameterSelect');
  const customDiaWrap = getEl('customSpoolDiameterWrap');
  const densitySelect = getEl<HTMLSelectElement>('spoolMaterialDensity');
  const customDensityWrap = getEl('customSpoolDensityWrap');

  function getDensity(): number {
    return densitySelect.value === 'custom'
      ? parseStrictNumber(getEl<HTMLInputElement>('customSpoolDensityVal').value)
      : parseStrictNumber(densitySelect.value);
  }

  function getDiameter(): number {
    return diaSelect.value === 'custom'
      ? parseStrictNumber(getEl<HTMLInputElement>('customSpoolDiameterMm').value)
      : parseStrictNumber(diaSelect.value);
  }

  function calcSpool(): void {
    customTareWrap.classList.toggle('hidden', brandSelect.value !== 'custom');
    customSizeWrap.classList.toggle('hidden', sizeSelect.value !== 'custom');
    customDiaWrap.classList.toggle('hidden', diaSelect.value !== 'custom');
    customDensityWrap.classList.toggle('hidden', densitySelect.value !== 'custom');

    const tare =
      brandSelect.value === 'custom'
        ? parseStrictNumber(getEl<HTMLInputElement>('customTareGrams').value)
        : parseStrictNumber(brandSelect.value);
    const gross = parseStrictNumber(getEl<HTMLInputElement>('grossScaleGrams').value);
    const spoolSize =
      sizeSelect.value === 'custom'
        ? parseStrictNumber(getEl<HTMLInputElement>('customSpoolSizeGrams').value)
        : parseStrictNumber(sizeSelect.value);
    const diameter = getDiameter();
    const density = getDensity();

    const noteEl = getEl('spoolStatusNote');
    const finishBadge = getEl('willItFinishBadge');

    const res = spoolRemaining(gross, tare, density, diameter, spoolSize);
    if (!res.ok) {
      getEl('outSpoolTare').textContent = Number.isFinite(tare) && tare >= 0 ? `${tare} g` : '—';
      getEl('outNetFilament').textContent = '—';
      getEl('outSpoolPct').textContent = '—';
      getEl('outRemainingMeters').textContent = '—';
      getEl('outGramsPerMeter').textContent = '—';
      finishBadge.textContent = '—';
      noteEl.textContent = res.error;
      noteEl.style.color = 'var(--status-warn)';
      return;
    }

    const g2m = gramsToMeters(res.netG, density, diameter);
    getEl('outSpoolTare').textContent = `${tare} g`;
    getEl('outNetFilament').textContent = `${res.netG.toFixed(0)} g`;
    getEl('outSpoolPct').textContent = `${res.pctLeft.toFixed(1)}% of ${spoolSize}g`;
    getEl('outRemainingMeters').textContent = `${res.meters.toFixed(1)} m`;
    getEl('outSpoolDiaSub').textContent = `${diameter.toFixed(2)}mm diameter`;
    getEl('outGramsPerMeter').textContent = g2m.ok ? `${g2m.gramsPerMeter.toFixed(2)} g/m` : '—';

    if (res.belowTare) {
      noteEl.textContent = 'Scale weight is below the empty spool weight; check the brand or use custom tare.';
      noteEl.style.color = 'var(--status-warn)';
    } else if (res.overCapacity) {
      noteEl.textContent = `Notice: Net filament (${res.netG.toFixed(0)} g) exceeds nominal spool size (${spoolSize} g); capped at 100%.`;
      noteEl.style.color = 'var(--status-warn)';
    } else {
      noteEl.textContent = 'Tip: Cardboard spools can absorb 3–6g of ambient humidity before drying.';
      noteEl.style.color = 'var(--text-muted)';
    }

    const reqG = parseStrictNumber(getEl<HTMLInputElement>('nextPrintGrams').value);
    const fin = willPrintFinish(res.netG, reqG);
    if (!fin.ok) {
      finishBadge.textContent = '—';
      finishBadge.style.color = 'var(--text-muted)';
    } else if (fin.canFinish) {
      finishBadge.textContent = `YES (+${fin.marginG.toFixed(1)} g margin)`;
      finishBadge.style.color = 'var(--status-ok)';
    } else {
      finishBadge.textContent = `NO (short by ${Math.abs(fin.marginG).toFixed(1)} g)`;
      finishBadge.style.color = 'var(--status-warn)';
    }
    trackCalculate('spool_weight');
  }

  const gcodeBtn = maybeEl<HTMLButtonElement>('spoolGcodeBrowseBtn');
  const gcodeInput = maybeEl<HTMLInputElement>('spoolGcodeFileInput');
  const gcodeStatus = maybeEl('spoolGcodeStatus');
  if (gcodeBtn && gcodeInput) {
    gcodeBtn.addEventListener('click', () => {
      gcodeInput.value = '';
      gcodeInput.click();
    });
    gcodeInput.addEventListener('change', () => {
      const files = gcodeInput.files;
      if (!files || files.length === 0) return;
      const meta = validateFileMetadata([{ name: files[0].name, size: files[0].size }], 'gcode');
      if (!meta.ok) {
        if (gcodeStatus) gcodeStatus.textContent = meta.error;
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buf = ev.target?.result as ArrayBuffer;
        if (!buf) return;
        const head = validateTextBufferHead(buf, 'gcode');
        if (!head.ok) {
          if (gcodeStatus) gcodeStatus.textContent = head.error;
          return;
        }
        const text = new TextDecoder('utf-8').decode(buf);
        const parsed = parseGcode(text, {
          densityGPerCm3: getDensity() || 1.24,
          diameterMm: getDiameter() || 1.75,
        });
        if (!parsed.ok) {
          if (gcodeStatus) gcodeStatus.textContent = parsed.error;
          return;
        }
        getEl<HTMLInputElement>('nextPrintGrams').value = parsed.filamentGrams.toFixed(1);
        if (gcodeStatus) {
          gcodeStatus.textContent = `From ${files[0].name}: ${parsed.filamentGrams.toFixed(1)} g`;
        }
        calcSpool();
      };
      reader.readAsArrayBuffer(files[0]);
    });
  }

  const debouncedCalcSpool = debounce(calcSpool, 100);
  const ids = [
    'spoolBrandSelect',
    'customTareGrams',
    'grossScaleGrams',
    'spoolSizeSelect',
    'customSpoolSizeGrams',
    'spoolDiameterSelect',
    'customSpoolDiameterMm',
    'spoolMaterialDensity',
    'customSpoolDensityVal',
    'nextPrintGrams',
  ];

  ids.forEach((id) => {
    maybeEl(id)?.addEventListener('input', debouncedCalcSpool);
    maybeEl(id)?.addEventListener('change', calcSpool);
  });

  calcSpool();
}

function initSpoolDatabasePage(): void {
  const searchInput = maybeEl<HTMLInputElement>('spoolDbSearch');
  const table = maybeEl<HTMLTableElement>('spoolDbTable');
  if (!searchInput || !table) return;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      const text = (row.textContent ?? '').toLowerCase();
      (row as HTMLElement).style.display = text.includes(q) ? '' : 'none';
    });
  });
}

function initGramsMetersPage(): void {
  if (!maybeEl('gmDirectionSelect')) return;

  const dirSelect = getEl<HTMLSelectElement>('gmDirectionSelect');
  const matSelect = getEl<HTMLSelectElement>('gmMaterialSelect');
  const customWrap = getEl('gmCustomDensityWrap');
  const banner = getEl('gmValidationBanner');

  function calc(): void {
    customWrap.classList.toggle('hidden', matSelect.value !== 'custom');
    const isG2M = dirSelect.value === 'g2m';
    getEl('gmInputLabel').textContent = isG2M ? 'Filament Weight' : 'Filament Length';
    getEl('gmInputUnit').textContent = isG2M ? '[g]' : '[m]';

    const val = parseStrictNumber(getEl<HTMLInputElement>('gmInputVal').value);
    const density =
      matSelect.value === 'custom'
        ? parseStrictNumber(getEl<HTMLInputElement>('gmCustomDensity').value)
        : parseStrictNumber(matSelect.value);
    const diameter = parseStrictNumber(getEl<HTMLSelectElement>('gmDiameterSelect').value);

    const res = isG2M ? gramsToMeters(val, density, diameter) : metersToGrams(val, density, diameter);
    if (!res.ok) {
      banner.textContent = res.error;
      banner.classList.remove('hidden');
      getEl('outGmGrams').textContent = '—';
      getEl('outGmMeters').textContent = '—';
      getEl('outGmLinear').textContent = '—';
      getEl('outGmArea').textContent = '—';
      return;
    }

    banner.classList.add('hidden');
    const grams = isG2M ? val : (res as { ok: true; grams: number; gramsPerMeter: number }).grams;
    const meters = isG2M ? (res as { ok: true; meters: number; gramsPerMeter: number }).meters : val;
    const areaMm2 = Math.PI * Math.pow(diameter / 2, 2);

    getEl('outGmGrams').textContent = `${grams.toFixed(1)} g`;
    getEl('outGmMeters').textContent = `${meters.toFixed(1)} m`;
    getEl('outGmLinear').textContent = `${res.gramsPerMeter.toFixed(2)} g/m`;
    getEl('outGmArea').textContent = `${areaMm2.toFixed(2)} mm²`;
    trackCalculate('grams_to_meters');
  }

  const debouncedCalc = debounce(calc, 100);
  ['gmDirectionSelect', 'gmInputVal', 'gmMaterialSelect', 'gmCustomDensity', 'gmDiameterSelect'].forEach((id) => {
    maybeEl(id)?.addEventListener('input', debouncedCalc);
    maybeEl(id)?.addEventListener('change', calc);
  });

  calc();
}


// =========================================================================
// TOOLS 06–08: MESH FORMAT CONVERTERS (3MF → STL, STL → 3MF, STL ASCII ↔ BINARY)
// One controller, three pages. Each page declares the same element ids with a
// prefix (cv*) and a data-converter attribute on <body> naming the action.
// =========================================================================
type ConvertAction = ConvertWorkerRequest['action'];
type ConvertAnyResult = ThreeMfToStlResult | StlTo3mfResult | StlEncodingResult;

interface ConverterPageConfig {
  action: ConvertAction;
  inputKind: ToolFileKind;
  samplePath: string;
  sampleName: string;
  /** Builds the download filename from the input name. */
  outputName: (inputName: string, result: Extract<ConvertAnyResult, { ok: true }>) => string;
  /** Pulls the user's options from the page controls. */
  readOptions: () => ConvertWorkerRequest['options'];
  logTitle: string;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function runConversionLocally(req: ConvertWorkerRequest): ConvertAnyResult {
  if (req.action === '3mf-to-stl') return convert3mfToStl(req.buffer, req.options);
  if (req.action === 'stl-to-3mf') return convertStlTo3mf(req.buffer, req.options);
  return convertStlEncoding(req.buffer, req.options);
}

function initConverterPage(): void {
  const body = document.body;
  const action = body.getAttribute('data-converter') as ConvertAction | null;
  if (!action || !maybeEl('cvDropzone')) return;

  const configs: Record<ConvertAction, ConverterPageConfig> = {
    '3mf-to-stl': {
      action,
      inputKind: 'threemf',
      samplePath: '/samples/calibration-cube-and-boss.3mf',
      sampleName: 'calibration-cube-and-boss.3mf',
      outputName: (name) => `${name.replace(/\.3mf$/i, '')}.stl`,
      readOptions: () => ({
        outputFormat: (maybeEl<HTMLSelectElement>('cvFormatSelect')?.value === 'ascii' ? 'ascii' : 'binary') as StlEncoding,
      }),
      logTitle: '3MF → STL CONVERTER LOG',
    },
    'stl-to-3mf': {
      action,
      inputKind: 'stl',
      samplePath: '/samples/defective-cube.stl',
      sampleName: 'defective-cube.stl',
      outputName: (name) => `${name.replace(/\.stl$/i, '')}.3mf`,
      readOptions: () => ({
        unit: (maybeEl<HTMLSelectElement>('cvUnitSelect')?.value || 'millimeter') as 'millimeter' | 'inch',
        name: maybeEl<HTMLInputElement>('cvObjectName')?.value.trim() || undefined,
      }),
      logTitle: 'STL → 3MF PACKAGER LOG',
    },
    'stl-encoding': {
      action,
      inputKind: 'stl',
      samplePath: '/samples/defective-cube.stl',
      sampleName: 'defective-cube.stl',
      outputName: (name, result) => {
        const fmt = 'outputFormat' in result ? result.outputFormat : 'binary';
        return `${name.replace(/\.stl$/i, '')}-${fmt}.stl`;
      },
      readOptions: () => ({
        target: (maybeEl<HTMLSelectElement>('cvTargetSelect')?.value || 'auto') as StlEncoding | 'auto',
      }),
      logTitle: 'STL ASCII ↔ BINARY LOG',
    },
  };
  const cfg = configs[action];

  const logBox = getEl('cvLogBox');
  const progressBarWrap = maybeEl('cvProgressBarWrap');
  const progressBarFill = maybeEl('cvProgressBarFill');
  const retryBtn = maybeEl('cvRetryBtn');

  let activeBuffer: ArrayBuffer | null = null;
  let activeName = cfg.sampleName;
  let lastResult: Extract<ConvertAnyResult, { ok: true }> | null = null;

  function setProgress(pct: number | null): void {
    if (!progressBarWrap || !progressBarFill) return;
    if (pct === null) {
      progressBarWrap.classList.add('hidden');
      progressBarFill.style.width = '0%';
    } else {
      progressBarWrap.classList.remove('hidden');
      progressBarFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }
  }

  function renderError(message: string, allowRetry = false): void {
    setProgress(null);
    retryBtn?.classList.toggle('hidden', !allowRetry);
    const state = getEl('cvParseState');
    state.textContent = 'ERROR';
    state.style.color = 'var(--status-warn)';
    getEl('cvFileName').textContent = message;
    ['cvKpiA', 'cvKpiB', 'cvKpiC', 'cvKpiD'].forEach((id) => {
      const el = maybeEl(id);
      if (el) el.textContent = '—';
    });
    getEl('cvExportStatus').textContent = message;
    logBox.innerHTML = `<div style="color:#FF5C1A; margin-bottom:8px;">// ${cfg.logTitle} — VALIDATION ERROR</div><div style="color:var(--status-warn);">${message}</div>`;
    lastResult = null;
  }

  async function convertViaWorker(buffer: ArrayBuffer): Promise<ConvertAnyResult> {
    const req = { action: cfg.action, buffer: buffer.slice(0), options: cfg.readOptions() } as ConvertWorkerRequest;
    if (typeof Worker !== 'undefined') {
      try {
        return await runWithTimeout(
          new Promise<ConvertAnyResult>((resolve, reject) => {
            const worker = new Worker(new URL('./workers/convert.worker.ts', import.meta.url), { type: 'module' });
            worker.onmessage = (ev) => {
              worker.terminate();
              resolve(ev.data.result as ConvertAnyResult);
            };
            worker.onerror = (err) => {
              worker.terminate();
              reject(err);
            };
            worker.postMessage(req, [req.buffer]);
          }),
          (timeoutMsg) => renderError(timeoutMsg, true)
        );
      } catch {
        // fall through to the main thread
      }
    }
    return runConversionLocally({ ...req, buffer: buffer.slice(0) } as ConvertWorkerRequest);
  }

  function renderResult(res: Extract<ConvertAnyResult, { ok: true }>): void {
    const state = getEl('cvParseState');
    state.textContent = 'OK';
    state.style.color = 'var(--status-ok)';

    const m = res.metrics;
    getEl('cvKpiA').textContent = `${m.bboxMm.sizeX.toFixed(2)} × ${m.bboxMm.sizeY.toFixed(2)} × ${m.bboxMm.sizeZ.toFixed(2)} mm`;
    getEl('cvKpiB').textContent = res.triangleCount.toLocaleString();
    getEl('cvKpiC').textContent = formatBytes(res.outputBytes);
    const kpiCSub = maybeEl('cvKpiCSub');
    if (kpiCSub) kpiCSub.textContent = `from ${formatBytes(res.inputBytes)} (×${(res.outputBytes / res.inputBytes).toFixed(2)})`;

    const kpiD = getEl('cvKpiD');
    const kpiDSub = maybeEl('cvKpiDSub');
    if (cfg.action === '3mf-to-stl' && 'info' in res) {
      kpiD.textContent = `${res.info.meshes.length}`;
      if (kpiDSub) kpiDSub.textContent = `mesh object(s) · unit ${res.info.unit}`;
    } else if (cfg.action === 'stl-to-3mf' && 'vertexCount' in res) {
      kpiD.textContent = res.vertexCount.toLocaleString();
      if (kpiDSub) kpiDSub.textContent = `welded vertices (from ${(res.triangleCount * 3).toLocaleString()})`;
    } else if ('inputFormat' in res && 'outputFormat' in res) {
      kpiD.textContent = `${res.inputFormat.toUpperCase()} → ${res.outputFormat.toUpperCase()}`;
      if (kpiDSub) kpiDSub.textContent = m.isWatertight ? 'watertight mesh' : `${m.boundaryEdges} open edges`;
    }

    const watertight = m.isWatertight ? 'watertight' : `${m.boundaryEdges} open edges`;
    getEl('cvExportStatus').textContent = `Ready: ${res.triangleCount.toLocaleString()} facets, ${watertight}, ${formatBytes(res.outputBytes)}.`;

    logBox.innerHTML = [
      `<div style="color:#FF5C1A; margin-bottom:8px;">// ${cfg.logTitle} — ${activeName}</div>`,
      ...res.logs.map((line) => `<div>[OK] ${line}</div>`),
    ].join('');
  }

  async function runConversion(): Promise<void> {
    if (!activeBuffer) return;
    retryBtn?.classList.add('hidden');
    setProgress(35);
    const t0 = performance.now();
    const res = await convertViaWorker(activeBuffer);
    setProgress(100);
    setTimeout(() => setProgress(null), 250);
    if (!res.ok) {
      trackFileLoadError(cfg.inputKind, res.errorCode);
      renderError(res.error);
      return;
    }
    lastResult = res;
    trackCalculate(cfg.action);
    trackFileLoadSuccess(cfg.action, cfg.inputKind, res.inputBytes, performance.now() - t0);
    renderResult(res);
  }

  function loadBuffer(buffer: ArrayBuffer, filename: string, notice?: string): void {
    activeBuffer = buffer;
    activeName = filename;
    const prefix = notice ? `${notice} — ` : '';
    getEl('cvFileName').textContent = `${prefix}FILE LOADED: ${filename} (${formatBytes(buffer.byteLength)})`;
    void runConversion();
  }

  wireDropzone(
    'cvDropzone',
    'cvFileInput',
    'cvBrowseBtn',
    cfg.inputKind,
    (file, notice) => {
      setProgress(15);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const buffer = ev.target?.result as ArrayBuffer;
        if (buffer) loadBuffer(buffer, file.name, notice);
      };
      reader.readAsArrayBuffer(file);
    },
    (message) => renderError(message)
  );

  retryBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    void runConversion();
  });

  ['cvFormatSelect', 'cvUnitSelect', 'cvTargetSelect', 'cvObjectName'].forEach((id) => {
    maybeEl(id)?.addEventListener('change', () => void runConversion());
  });
  maybeEl('cvObjectName')?.addEventListener('input', debounce(() => void runConversion(), 250));

  maybeEl('cvDownloadBtn')?.addEventListener('click', () => {
    if (!lastResult) {
      renderError(`Select a valid ${cfg.inputKind === 'threemf' ? '.3MF' : '.STL'} file before exporting.`);
      return;
    }
    const filename = cfg.outputName(activeName, lastResult);
    if ('threeMf' in lastResult) {
      downloadBlobFile(filename, new Blob([lastResult.threeMf], { type: 'model/3mf' }));
      trackExportDownload(cfg.action, '3mf');
    } else if ('asciiStl' in lastResult && lastResult.asciiStl) {
      downloadTextFile(filename, lastResult.asciiStl);
      trackExportDownload(cfg.action, 'ascii_stl');
    } else if ('binaryStl' in lastResult && lastResult.binaryStl) {
      downloadBlobFile(filename, new Blob([lastResult.binaryStl], { type: 'application/octet-stream' }));
      trackExportDownload(cfg.action, 'binary_stl');
    }
  });

  async function fetchSample(): Promise<ArrayBuffer | null> {
    try {
      const resp = await fetch(cfg.samplePath);
      return resp.ok ? await resp.arrayBuffer() : null;
    } catch {
      return null;
    }
  }

  maybeEl('cvSampleBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    trackSampleLoad(cfg.action);
    setProgress(15);
    const buf = await fetchSample();
    if (buf) loadBuffer(buf, cfg.sampleName);
    else renderError('The sample could not be fetched. Check your connection and retry.', true);
  });

  maybeEl('cvGetSampleBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const buf = await fetchSample();
    if (buf) {
      downloadBlobFile(cfg.sampleName, new Blob([buf], { type: 'application/octet-stream' }));
      trackExportDownload(`${cfg.action}_sample`, cfg.inputKind);
    }
  });

  void fetchSample().then((buf) => {
    if (buf) loadBuffer(buf, cfg.sampleName);
  });
}

initPrivacyPageControls();
wireInternalLinkAnalytics();
initGcodeAndCostPage();
initStlVolumePage();
initStlPage();
initStepPage();
initResinPage();
initSpoolPage();
initSpoolDatabasePage();
initGramsMetersPage();
initConverterPage();
