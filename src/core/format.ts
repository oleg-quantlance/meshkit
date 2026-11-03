export const MAX_SAFE_INPUT = 1e9;

/**
 * Strictly parses a numeric string from an input field.
 * Rejects empty strings, whitespace-only, decimal commas ("48,5"), letters,
 * non-finite numbers, or absurdly large numbers (>= 1e9).
 */
export function parseStrictNumber(raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || Math.abs(raw) >= MAX_SAFE_INPUT) return NaN;
    return raw;
  }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.includes(',')) return NaN;
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return NaN;
  const val = Number(trimmed);
  if (!Number.isFinite(val) || Math.abs(val) >= MAX_SAFE_INPUT) return NaN;
  return val;
}

/**
 * Formats hours as "Xh YYm" by rounding to total minutes first,
 * preventing "2h 60m" when hours = 2.999 (Golden Vector C4).
 */
export function formatDurationHours(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * Formats seconds as "Xh YYm" by rounding to total minutes first.
 */
export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  return formatDurationHours(seconds / 3600);
}

/**
 * Formats currency to 2 decimal places ("$1.83").
 */
export function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return `$${amount.toFixed(2)}`;
}
