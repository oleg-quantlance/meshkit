import { MAX_SAFE_INPUT, formatDurationSeconds } from './format';

export interface ResinCostInput {
  solidVolumeMl: number;
  retainedFraction: number; // e.g., 1.0 for solid, 0.42 for 42% retained
  supportPct: number;       // e.g., 22 for 22%
  pricePerUnit: number;     // $/L or $/kg
  priceBasis?: 'per_liter' | 'per_kg';
  densityGPerMl?: number;   // default 1.10 g/mL
  surfaceAreaCm2?: number;  // optional from STL
  wallThicknessMm?: number; // optional when surfaceAreaCm2 is provided
  ipaPerPrint?: number;
  glovesPerPrint?: number;
  fepCost?: number;
  printsPerFep?: number;
  lcdCost?: number;
  printsPerLcd?: number;
  markupMultiplier?: number;
}

export type ResinCostResult =
  | {
      ok: true;
      retainedFractionUsed: number;
      resinMl: number;
      resinGrams: number;
      resinLiquidCost: number;
      fepAmortized: number;
      lcdAmortized: number;
      consumablesCost: number;
      unitCost: number;
      recommendedQuote: number;
    }
  | {
      ok: false;
      error: string;
    };

export interface ResinTimeInput {
  heightMm: number;
  layerHeightMm: number;
  exposureSec: number;
  liftRetractSec: number;
  bottomLayers?: number;
  bottomExposureSec?: number;
}

export type ResinTimeResult =
  | {
      ok: true;
      layers: number;
      seconds: number;
      hours: number;
      formattedTime: string;
    }
  | {
      ok: false;
      error: string;
    };

export function calculateResinCost(input: ResinCostInput): ResinCostResult {
  const {
    solidVolumeMl,
    retainedFraction,
    supportPct,
    pricePerUnit,
    priceBasis = 'per_liter',
    densityGPerMl = 1.1,
    surfaceAreaCm2,
    wallThicknessMm,
    ipaPerPrint = 0.25,
    glovesPerPrint = 0.15,
    fepCost = 18,
    printsPerFep = 40,
    lcdCost = 110,
    printsPerLcd = 400,
    markupMultiplier = 4.0,
  } = input;

  const nums = [
    solidVolumeMl,
    retainedFraction,
    supportPct,
    pricePerUnit,
    densityGPerMl,
    ipaPerPrint,
    glovesPerPrint,
    fepCost,
    printsPerFep,
    lcdCost,
    printsPerLcd,
    markupMultiplier,
  ];

  if (!nums.every((n) => Number.isFinite(n) && Math.abs(n) < MAX_SAFE_INPUT)) {
    return { ok: false, error: 'Enter valid numbers in all resin cost fields.' };
  }

  if (
    solidVolumeMl < 0 ||
    supportPct < 0 ||
    pricePerUnit < 0 ||
    ipaPerPrint < 0 ||
    glovesPerPrint < 0 ||
    fepCost < 0 ||
    lcdCost < 0 ||
    markupMultiplier < 0
  ) {
    return { ok: false, error: 'Volume, support percentage, and costs cannot be negative.' };
  }

  if (densityGPerMl <= 0) {
    return { ok: false, error: 'Resin density must be greater than zero.' };
  }

  if (printsPerFep <= 0 || printsPerLcd <= 0) {
    return { ok: false, error: 'Prints per FEP and prints per LCD screen must be greater than zero.' };
  }

  let effectiveRetained = retainedFraction;
  if (surfaceAreaCm2 !== undefined && wallThicknessMm !== undefined && wallThicknessMm > 0) {
    if (!Number.isFinite(surfaceAreaCm2) || surfaceAreaCm2 < 0) {
      return { ok: false, error: 'Surface area cannot be negative.' };
    }
    if (solidVolumeMl > 0) {
      // surfaceAreaCm2 * (wallThicknessMm / 10 cm) = shell volume in cm³ (mL)
      const shellVolMl = Math.min(solidVolumeMl, surfaceAreaCm2 * (wallThicknessMm / 10));
      effectiveRetained = shellVolMl / solidVolumeMl;
    } else {
      effectiveRetained = 1;
    }
  } else {
    if (effectiveRetained <= 0 || effectiveRetained > 1) {
      return { ok: false, error: 'Retained shell percentage must be between 1% and 100%.' };
    }
  }

  const resinMl = solidVolumeMl * effectiveRetained * (1 + supportPct / 100);
  const resinGrams = resinMl * densityGPerMl;
  const resinLiquidCost =
    priceBasis === 'per_kg'
      ? (resinGrams / 1000) * pricePerUnit
      : (resinMl / 1000) * pricePerUnit;

  const fepAmortized = fepCost / printsPerFep;
  const lcdAmortized = lcdCost / printsPerLcd;
  const consumablesCost = ipaPerPrint + glovesPerPrint + fepAmortized + lcdAmortized;
  const unitCost = resinLiquidCost + consumablesCost;
  const recommendedQuote = unitCost * markupMultiplier;

  return {
    ok: true,
    retainedFractionUsed: effectiveRetained,
    resinMl,
    resinGrams,
    resinLiquidCost,
    fepAmortized,
    lcdAmortized,
    consumablesCost,
    unitCost,
    recommendedQuote,
  };
}

export function calculateResinTime(input: ResinTimeInput): ResinTimeResult {
  const {
    heightMm,
    layerHeightMm,
    exposureSec,
    liftRetractSec,
    bottomLayers = 0,
    bottomExposureSec = 30,
  } = input;

  const nums = [heightMm, layerHeightMm, exposureSec, liftRetractSec, bottomLayers, bottomExposureSec];
  if (!nums.every((n) => Number.isFinite(n) && Math.abs(n) < MAX_SAFE_INPUT)) {
    return { ok: false, error: 'Enter valid numbers in all exposure time fields.' };
  }

  if (layerHeightMm <= 0) {
    return { ok: false, error: 'Layer height must be greater than zero.' };
  }

  if (heightMm < 0 || exposureSec < 0 || liftRetractSec < 0 || bottomLayers < 0 || bottomExposureSec < 0) {
    return { ok: false, error: 'Height, layer count, and exposure times cannot be negative.' };
  }

  const layers = Math.ceil(heightMm / layerHeightMm);
  const seconds =
    layers * (exposureSec + liftRetractSec) +
    bottomLayers * (bottomExposureSec - exposureSec);
  const clampedSeconds = Math.max(0, seconds);
  const hours = clampedSeconds / 3600;

  return {
    ok: true,
    layers,
    seconds: clampedSeconds,
    hours,
    formattedTime: formatDurationSeconds(clampedSeconds),
  };
}
