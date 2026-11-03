import { MAX_SAFE_INPUT } from './format';

export type SpoolResult =
  | {
      ok: true;
      netG: number;
      meters: number;
      pctLeft: number;
      rawPctLeft: number;
      belowTare: boolean;
      overCapacity: boolean;
    }
  | { ok: false; error: string };

export function spoolRemaining(
  grossG: number,
  tareG: number,
  density: number,
  diameterMm: number,
  spoolNetG: number
): SpoolResult {
  const nums = [grossG, tareG, density, diameterMm, spoolNetG];
  if (!nums.every((n) => Number.isFinite(n) && Math.abs(n) < MAX_SAFE_INPUT)) {
    return { ok: false, error: 'Enter numbers only.' };
  }
  if (grossG < 0 || tareG < 0) {
    return { ok: false, error: 'Weights cannot be negative.' };
  }
  if (density <= 0 || diameterMm <= 0 || spoolNetG <= 0) {
    return { ok: false, error: 'Density, diameter and spool size must be above zero.' };
  }
  const netG = Math.max(0, grossG - tareG);
  const rCm = diameterMm / 10 / 2;
  const gramsPerMeter = Math.PI * rCm * rCm * 100 * density;
  const rawPctLeft = (netG / spoolNetG) * 100;
  return {
    ok: true,
    netG,
    meters: netG / gramsPerMeter,
    pctLeft: Math.min(100, rawPctLeft),
    rawPctLeft,
    belowTare: grossG < tareG,
    overCapacity: rawPctLeft > 100,
  };
}

export function gramsToMeters(
  grams: number,
  density: number,
  diameterMm: number
): { ok: true; meters: number; gramsPerMeter: number } | { ok: false; error: string } {
  const nums = [grams, density, diameterMm];
  if (!nums.every((n) => Number.isFinite(n) && Math.abs(n) < MAX_SAFE_INPUT)) {
    return { ok: false, error: 'Enter numbers only.' };
  }
  if (grams < 0) {
    return { ok: false, error: 'Weight cannot be negative.' };
  }
  if (density <= 0 || diameterMm <= 0) {
    return { ok: false, error: 'Density and diameter must be above zero.' };
  }
  const rCm = diameterMm / 10 / 2;
  const gramsPerMeter = Math.PI * rCm * rCm * 100 * density;
  return {
    ok: true,
    meters: grams / gramsPerMeter,
    gramsPerMeter,
  };
}

export function metersToGrams(
  meters: number,
  density: number,
  diameterMm: number
): { ok: true; grams: number; gramsPerMeter: number } | { ok: false; error: string } {
  const nums = [meters, density, diameterMm];
  if (!nums.every((n) => Number.isFinite(n) && Math.abs(n) < MAX_SAFE_INPUT)) {
    return { ok: false, error: 'Enter numbers only.' };
  }
  if (meters < 0) {
    return { ok: false, error: 'Length cannot be negative.' };
  }
  if (density <= 0 || diameterMm <= 0) {
    return { ok: false, error: 'Density and diameter must be above zero.' };
  }
  const rCm = diameterMm / 10 / 2;
  const gramsPerMeter = Math.PI * rCm * rCm * 100 * density;
  return {
    ok: true,
    grams: meters * gramsPerMeter,
    gramsPerMeter,
  };
}

export function willPrintFinish(
  netRemainingG: number,
  jobRequiredG: number
):
  | {
      ok: true;
      canFinish: boolean;
      marginG: number;
      safetyMarginPct: number | null;
    }
  | { ok: false; error: string } {
  if (
    !Number.isFinite(netRemainingG) ||
    !Number.isFinite(jobRequiredG) ||
    Math.abs(netRemainingG) >= MAX_SAFE_INPUT ||
    Math.abs(jobRequiredG) >= MAX_SAFE_INPUT
  ) {
    return { ok: false, error: 'Enter valid numbers for remaining and required filament.' };
  }
  if (netRemainingG < 0 || jobRequiredG < 0) {
    return { ok: false, error: 'Weights cannot be negative.' };
  }
  const marginG = netRemainingG - jobRequiredG;
  const safetyMarginPct = jobRequiredG > 0 ? (marginG / jobRequiredG) * 100 : null;
  return {
    ok: true,
    canFinish: netRemainingG >= jobRequiredG,
    marginG,
    safetyMarginPct,
  };
}
