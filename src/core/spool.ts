export type SpoolResult =
  | { ok: true; netG: number; meters: number; pctLeft: number; belowTare: boolean }
  | { ok: false; error: string };

export function spoolRemaining(
  grossG: number,
  tareG: number,
  density: number,
  diameterMm: number,
  spoolNetG: number
): SpoolResult {
  const nums = [grossG, tareG, density, diameterMm, spoolNetG];
  if (!nums.every(Number.isFinite)) return { ok: false, error: 'Enter numbers only.' };
  if (grossG < 0 || tareG < 0) return { ok: false, error: 'Weights cannot be negative.' };
  if (density <= 0 || diameterMm <= 0 || spoolNetG <= 0)
    return { ok: false, error: 'Density, diameter and spool size must be above zero.' };
  const netG = Math.max(0, grossG - tareG);
  const rCm = diameterMm / 10 / 2;
  const gramsPerMeter = Math.PI * rCm * rCm * 100 * density;
  return {
    ok: true,
    netG,
    meters: netG / gramsPerMeter,
    pctLeft: Math.min(100, (netG / spoolNetG) * 100),
    belowTare: grossG < tareG,
  };
}
