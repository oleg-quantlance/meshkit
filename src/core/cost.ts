import { MAX_SAFE_INPUT } from './format';

export interface PrintCostInput {
  grams: number;
  hours: number;
  pricePerKg: number;
  watts: number;
  electricityRatePerKwh: number;
  wearRatePerHour: number;
  failurePct: number;
  channelFeePct: number;
  channelFixedFee: number;
  pricingMode?: 'multiplier' | 'target_margin';
  markupMultiplier?: number;
  targetMarginPct?: number;
  timeCorrectionPct?: number;
}

export type PrintCostResult =
  | {
      ok: true;
      adjustedHours: number;
      materialCost: number;
      energyCost: number;
      wearCost: number;
      overheadCost: number;
      unitCost: number;
      sellingPrice: number;
      channelFees: number;
      profit: number;
      marginPct: number | null;
      belowCostWarning: boolean;
    }
  | {
      ok: false;
      error: string;
    };

export function calculatePrintCost(input: PrintCostInput): PrintCostResult {
  const {
    grams,
    hours,
    pricePerKg,
    watts,
    electricityRatePerKwh,
    wearRatePerHour,
    failurePct,
    channelFeePct,
    channelFixedFee,
    pricingMode = 'multiplier',
    markupMultiplier = 3.5,
    targetMarginPct = 50,
    timeCorrectionPct = 0,
  } = input;

  const coreNums = [
    grams,
    hours,
    pricePerKg,
    watts,
    electricityRatePerKwh,
    wearRatePerHour,
    failurePct,
    channelFeePct,
    channelFixedFee,
    timeCorrectionPct,
  ];

  if (!coreNums.every((n) => Number.isFinite(n) && Math.abs(n) < MAX_SAFE_INPUT)) {
    return { ok: false, error: 'Enter valid numbers in all cost fields.' };
  }

  if (
    grams < 0 ||
    hours < 0 ||
    pricePerKg < 0 ||
    watts < 0 ||
    electricityRatePerKwh < 0 ||
    wearRatePerHour < 0 ||
    failurePct < 0 ||
    channelFeePct < 0 ||
    channelFixedFee < 0
  ) {
    return { ok: false, error: 'Values cannot be negative.' };
  }

  if (timeCorrectionPct <= -100) {
    return { ok: false, error: 'Time correction cannot be -100% or lower.' };
  }

  if (channelFeePct >= 100) {
    return { ok: false, error: 'Channel fee percentage must be below 100%.' };
  }

  const adjustedHours = hours * (1 + timeCorrectionPct / 100);
  const materialCost = (grams / 1000) * pricePerKg;
  const energyCost = (watts / 1000) * adjustedHours * electricityRatePerKwh;
  const wearCost = adjustedHours * wearRatePerHour;
  const baseTotal = materialCost + energyCost + wearCost;
  const unitCost = baseTotal * (1 + failurePct / 100);
  const overheadCost = unitCost - materialCost;

  const channelRate = channelFeePct / 100;
  let sellingPrice = 0;
  let belowCostWarning = false;

  if (pricingMode === 'target_margin') {
    if (!Number.isFinite(targetMarginPct) || targetMarginPct < 0 || targetMarginPct >= 100) {
      return { ok: false, error: 'Target margin must be between 0% and 99.9%.' };
    }
    const targetMarginRate = targetMarginPct / 100;
    if (channelRate + targetMarginRate >= 1) {
      return { ok: false, error: 'Channel fee + target margin must be below 100%.' };
    }
    sellingPrice = (unitCost + channelFixedFee) / (1 - channelRate - targetMarginRate);
  } else {
    if (!Number.isFinite(markupMultiplier) || markupMultiplier < 0 || markupMultiplier >= MAX_SAFE_INPUT) {
      return { ok: false, error: 'Enter a valid markup multiplier.' };
    }
    if (markupMultiplier < 1) {
      belowCostWarning = true;
    }
    sellingPrice = (unitCost * markupMultiplier + channelFixedFee) / (1 - channelRate);
  }

  const channelFees = sellingPrice * channelRate + channelFixedFee;
  const profit = sellingPrice - unitCost - channelFees;
  const marginPct = sellingPrice > 0 ? Math.round((profit / sellingPrice) * 100) : null;

  if (sellingPrice < unitCost && unitCost > 0) {
    belowCostWarning = true;
  }

  return {
    ok: true,
    adjustedHours,
    materialCost,
    energyCost,
    wearCost,
    overheadCost,
    unitCost,
    sellingPrice,
    channelFees,
    profit,
    marginPct,
    belowCostWarning,
  };
}
