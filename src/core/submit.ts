/**
 * Community spool-measurement submissions.
 *
 * Writes one document to Firestore over REST with the public web API key.
 * There is no SDK, no auth and no read path: the security rules in
 * firestore.rules accept only a well-formed `create` and reject everything
 * else, and the key itself grants nothing beyond what the rules allow.
 * Validation here mirrors the rules so users get a useful message instead
 * of a 403.
 */
import firebasePublic from '../data/firebase-public.json';

export interface SpoolSubmissionInput {
  brand: string;
  line: string;
  spoolMaterial: 'plastic' | 'cardboard' | 'other';
  tareG: number;
  netG: number;
  scale?: string;
  note?: string;
  credit?: string;
  /** Path of the page the form was on. */
  page: string;
  /** Milliseconds the form was open before submit (bot deterrent; rules require ≥ 2000). */
  formMs: number;
  /** Honeypot; must be empty. */
  website: string;
}

export type SpoolSubmissionValidation = { ok: true; data: SpoolSubmissionInput } | { ok: false; error: string };

export function validateSpoolSubmission(raw: Record<string, unknown>): SpoolSubmissionValidation {
  const str = (k: string, max: number) => (typeof raw[k] === 'string' ? (raw[k] as string).trim().slice(0, max) : '');
  const brand = str('brand', 60);
  const line = str('line', 80);
  const spoolMaterial = raw.spoolMaterial;
  const tareG = Number(raw.tareG);
  const netG = Number(raw.netG);
  const scale = str('scale', 60);
  const note = str('note', 280);
  const credit = str('credit', 40);
  const page = str('page', 120) || '/empty-spool-weight-database';
  const formMs = Number(raw.formMs);
  const website = str('website', 200);

  if (brand.length < 2) return { ok: false, error: 'Enter the brand (at least 2 characters).' };
  if (spoolMaterial !== 'plastic' && spoolMaterial !== 'cardboard' && spoolMaterial !== 'other') return { ok: false, error: 'Pick the spool material.' };
  if (!Number.isFinite(tareG) || tareG < 20 || tareG > 1500) return { ok: false, error: 'Empty spool weight must be between 20 g and 1500 g.' };
  if (!Number.isFinite(netG) || netG < 100 || netG > 10000) return { ok: false, error: 'Net filament weight must be between 100 g and 10 kg (e.g. 1000 for a 1 kg spool).' };
  if (website !== '') return { ok: false, error: 'Submission rejected.' };
  if (!Number.isFinite(formMs) || formMs < 2000) return { ok: false, error: 'Please take a moment to check the numbers, then submit again.' };

  return {
    ok: true,
    data: { brand, line, spoolMaterial, tareG: Math.round(tareG * 10) / 10, netG: Math.round(netG), scale, note, credit, page, formMs: Math.min(formMs, 86400000), website: '' },
  };
}

function toFirestoreFields(d: SpoolSubmissionInput): Record<string, unknown> {
  const s = (v: string) => ({ stringValue: v });
  const n = (v: number) => ({ doubleValue: v });
  return {
    brand: s(d.brand),
    line: s(d.line),
    spoolMaterial: s(d.spoolMaterial),
    tareG: n(d.tareG),
    netG: n(d.netG),
    scale: s(d.scale ?? ''),
    note: s(d.note ?? ''),
    credit: s(d.credit ?? ''),
    page: s(d.page),
    clientTime: s(new Date().toISOString()),
    formMs: n(d.formMs),
    website: s(''),
  };
}

export async function submitSpoolMeasurement(
  data: SpoolSubmissionInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { projectId, apiKey } = firebasePublic as { projectId: string; apiKey: string };
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/spoolSubmissions?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 403) return { ok: false, error: 'The submission did not pass validation. Check the numbers and try again.' };
      return { ok: false, error: `Could not send (HTTP ${res.status}). ${text.slice(0, 120)}` };
    }
    const json = (await res.json()) as { name?: string };
    return { ok: true, id: (json.name ?? '').split('/').pop() ?? '' };
  } catch {
    return { ok: false, error: 'Network error — the measurement was not sent. Please try again.' };
  }
}
