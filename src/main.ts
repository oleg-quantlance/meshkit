import './style.css';
import channelsData from './data/channels.json';
import {
  formatCurrency,
  formatDurationHours,
  parseStrictNumber,
} from './core/format';
import { calculatePrintCost } from './core/cost';
import { parseGcode, ToolpathPoint } from './core/gcode';
import { calculateResinCost, calculateResinTime } from './core/resin';
import {
  spoolRemaining,
  gramsToMeters,
  metersToGrams,
  willPrintFinish,
} from './core/spool';

function maybeEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// =========================================================================
// THEME MANAGEMENT
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

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function wireDropzone(
  dropzoneId: string,
  fileInputId: string,
  browseBtnId: string,
  onFileSelected: (file: File) => void
): void {
  const zone = maybeEl(dropzoneId);
  const input = maybeEl<HTMLInputElement>(fileInputId);
  const browseBtn = maybeEl<HTMLButtonElement>(browseBtnId);
  if (!zone || !input || !browseBtn) return;

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
    if (target.files && target.files[0]) {
      onFileSelected(target.files[0]);
    }
  });

  zone.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    zone.classList.add('drag-active');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-active'));
  zone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    zone.classList.remove('drag-active');
    if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
      onFileSelected(e.dataTransfer.files[0]);
    }
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

  // Subtle background grid
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
  }

  function loadGcodeText(text: string, labelName: string): void {
    const density = getSelectedDensity() || 1.24;
    const diameter = getSelectedDiameter() || 1.75;
    const parsed = parseGcode(text, { densityGPerCm3: density, diameterMm: diameter });

    const statusTitle = maybeEl('gcodeStatusTitle');
    const statusSub = maybeEl('gcodeStatusSub');
    const parseState = maybeEl('gcodeParseState');

    if (!parsed.ok) {
      if (statusTitle) statusTitle.textContent = parsed.error;
      if (parseState) {
        parseState.textContent = 'ERROR';
        parseState.style.color = 'var(--status-warn)';
      }
      return;
    }

    getEl<HTMLInputElement>('filamentGrams').value = parsed.filamentGrams.toFixed(1);
    getEl<HTMLInputElement>('printHours').value = parsed.printHours.toFixed(2);

    const layerLabel = maybeEl('layerCountLabel');
    const moveLabel = maybeEl('moveCountLabel');
    if (layerLabel) layerLabel.textContent = parsed.layerCount.toLocaleString();
    if (moveLabel) moveLabel.textContent = parsed.moveCount.toLocaleString();

    if (statusTitle) statusTitle.textContent = `FILE LOADED: ${labelName}`;
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
          : 'Estimate (trapezoidal accel)';
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
    maybeEl(id)?.addEventListener('input', recalculateCost);
    maybeEl(id)?.addEventListener('change', recalculateCost);
  });

  wireDropzone('gcodeDropzone', 'gcodeFileInput', 'gcodeBrowseBtn', (file) => {
    if (file.size === 0) {
      const titleEl = maybeEl('gcodeStatusTitle');
      if (titleEl) titleEl.textContent = 'This file is empty (0 bytes). Please choose another file.';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => loadGcodeText(String(ev.target?.result ?? ''), file.name);
    reader.readAsText(file);
  });

  maybeEl<HTMLInputElement>('layerSlider')?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    const pctEl = maybeEl('layerPctLabel');
    if (pctEl) pctEl.textContent = `${val}%`;
    renderRealToolpath(parseInt(val, 10));
  });

  maybeEl('gcodeSampleBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const resp = await fetch('/samples/enclosure-bracket.gcode');
      if (resp.ok) {
        const text = await resp.text();
        loadGcodeText(text, 'enclosure-bracket.gcode');
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
      }
    } catch {
      // ignore
    }
  });

  recalculateCost();
  if (maybeEl('gcodeCanvas')) {
    fetch('/samples/enclosure-bracket.gcode')
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        if (text) {
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

    getEl('outStlVolCm3').textContent = `${effectiveVol.toFixed(1)} cm³`;
    getEl('outStlWeightG').textContent = `${weightG.toFixed(1)} g`;
    getEl('outStlDensitySub').textContent = `@ ${density.toFixed(2)} g/cm³`;
    getEl('outStlMeters').textContent = lenRes.ok ? `${lenRes.meters.toFixed(1)} m` : '—';
    getEl('outStlDiaSub').textContent = `${diameter.toFixed(2)} mm diameter`;
    getEl('outStlSpoolPct').textContent = `${((weightG / 1000) * 100).toFixed(1)}%`;
  }

  ['stlVolInputCm3', 'stlVolInfillPct', 'stlVolMaterialSelect', 'stlVolCustomDensity', 'stlVolDiameterSelect'].forEach(
    (id) => {
      maybeEl(id)?.addEventListener('input', calc);
      maybeEl(id)?.addEventListener('change', calc);
    }
  );

  calc();
}

// =========================================================================
// TOOL 02 & 03: STL REPAIR & STEP TO STL (WEEK 2 FULL WASM SOLVERS)
// =========================================================================
function initStlPage(): void {
  if (!maybeEl('stlCanvas')) return;

  function drawStlMesh(repaired = false): void {
    const c = getEl<HTMLCanvasElement>('stlCanvas');
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = repaired ? '#34D399' : '#D4D3CD';
    ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c.width / 2, 32);
      ctx.lineTo(c.width / 2 + Math.cos(a) * 155, 175 + Math.sin(a) * 32);
      ctx.lineTo(c.width / 2 + Math.cos(a + 0.31) * 155, 175 + Math.sin(a + 0.31) * 32);
      ctx.closePath();
      ctx.stroke();
    }
  }

  wireDropzone('stlDropzone', 'stlFileInput', 'stlBrowseBtn', (file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      if (!buffer) return;
      let triCount = 0;
      if (buffer.byteLength >= 84) {
        const expectedN = new DataView(buffer).getUint32(80, true);
        if (buffer.byteLength === 84 + 50 * expectedN) {
          triCount = expectedN;
        } else {
          const fullText = new TextDecoder().decode(buffer);
          const matches = fullText.match(/facet normal/g);
          triCount = matches ? matches.length : 0;
        }
      }
      getEl('stlFileName').textContent = `FILE LOADED: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      getEl('stlTris').textContent = triCount.toLocaleString();
      drawStlMesh(false);
    };
    reader.readAsArrayBuffer(file);
  });

  drawStlMesh(false);
}

function initStepPage(): void {
  if (!maybeEl('stepTolPresetSelect')) return;

  const presetSelect = getEl<HTMLSelectElement>('stepTolPresetSelect');
  const customWrap = getEl('stepCustomTolWrap');
  const customInput = getEl<HTMLInputElement>('stepCustomTolInput');
  const formatSelect = getEl<HTMLSelectElement>('stepOutputFormatSelect');

  function updateStepControls(): void {
    const isCustom = presetSelect.value === 'custom';
    customWrap.classList.toggle('hidden', !isCustom);
    const tol = isCustom ? parseStrictNumber(customInput.value) : parseStrictNumber(presetSelect.value);
    if (Number.isFinite(tol) && tol > 0) {
      getEl('stepTolLabel').textContent = `${tol.toFixed(3)} mm`;
      getEl('stepChordVal').textContent = `${tol.toFixed(3)} mm`;
    } else {
      getEl('stepTolLabel').textContent = '—';
      getEl('stepChordVal').textContent = '—';
    }
    getEl('stepFormatSub').textContent = formatSelect.value === 'ascii' ? 'ASCII STL' : 'Binary STL';
  }

  ['stepTolPresetSelect', 'stepCustomTolInput', 'stepUnitsSelect', 'stepOutputFormatSelect'].forEach((id) => {
    maybeEl(id)?.addEventListener('input', updateStepControls);
    maybeEl(id)?.addEventListener('change', updateStepControls);
  });

  updateStepControls();
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

  function calcResin(): void {
    customRetainedWrap.classList.toggle('hidden', hollowSelect.value !== 'custom');
    customLayerWrap.classList.toggle('hidden', layerSelect.value !== 'custom');

    const basis = priceBasisSelect.value === 'per_kg' ? 'per_kg' : 'per_liter';
    getEl('resinRateUnitTag').textContent = basis === 'per_kg' ? '[$/kg]' : '[$/L]';

    const solidVolumeMl = parseStrictNumber(getEl<HTMLInputElement>('resinVolMl').value);
    const supportPct = parseStrictNumber(getEl<HTMLInputElement>('resinSupportPct').value);
    const retainedFraction =
      hollowSelect.value === 'custom'
        ? parseStrictNumber(getEl<HTMLInputElement>('resinCustomRetainedPct').value) / 100
        : parseStrictNumber(hollowSelect.value);
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
  }

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
    maybeEl(id)?.addEventListener('input', calcResin);
    maybeEl(id)?.addEventListener('change', calcResin);
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
    const diameter =
      diaSelect.value === 'custom'
        ? parseStrictNumber(getEl<HTMLInputElement>('customSpoolDiameterMm').value)
        : parseStrictNumber(diaSelect.value);
    const density =
      densitySelect.value === 'custom'
        ? parseStrictNumber(getEl<HTMLInputElement>('customSpoolDensityVal').value)
        : parseStrictNumber(densitySelect.value);

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
  }

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
    maybeEl(id)?.addEventListener('input', calcSpool);
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
  }

  ['gmDirectionSelect', 'gmInputVal', 'gmMaterialSelect', 'gmCustomDensity', 'gmDiameterSelect'].forEach((id) => {
    maybeEl(id)?.addEventListener('input', calc);
    maybeEl(id)?.addEventListener('change', calc);
  });

  calc();
}

initGcodeAndCostPage();
initStlVolumePage();
initStlPage();
initStepPage();
initResinPage();
initSpoolPage();
initSpoolDatabasePage();
initGramsMetersPage();
