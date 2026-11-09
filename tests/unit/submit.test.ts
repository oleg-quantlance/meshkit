import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { submitSpoolMeasurement, validateSpoolSubmission } from '../../src/core/submit';

const GOOD = {
  brand: 'Polymaker',
  line: 'PolyTerra 1 kg',
  spoolMaterial: 'cardboard',
  tareG: '141.5',
  netG: '1000',
  scale: '0.1 g kitchen scale',
  note: 'Bought 2026-03',
  credit: 'oleg',
  page: '/polymaker-empty-spool-weight',
  formMs: 5400,
  website: '',
};

describe('validateSpoolSubmission', () => {
  it('accepts a good submission and normalises it', () => {
    const r = validateSpoolSubmission(GOOD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ brand: 'Polymaker', tareG: 141.5, netG: 1000, spoolMaterial: 'cardboard', website: '' });
  });

  it('rejects what the Firestore rules would reject, with a human message', () => {
    expect(validateSpoolSubmission({ ...GOOD, brand: 'P' })).toMatchObject({ ok: false, error: /brand/i });
    expect(validateSpoolSubmission({ ...GOOD, spoolMaterial: 'metal' })).toMatchObject({ ok: false, error: /material/i });
    expect(validateSpoolSubmission({ ...GOOD, tareG: '5' })).toMatchObject({ ok: false, error: /20 g and 1500 g/ });
    expect(validateSpoolSubmission({ ...GOOD, tareG: 'abc' })).toMatchObject({ ok: false });
    expect(validateSpoolSubmission({ ...GOOD, netG: '50' })).toMatchObject({ ok: false, error: /100 g and 10 kg/ });
    expect(validateSpoolSubmission({ ...GOOD, website: 'http://spam' })).toMatchObject({ ok: false, error: /rejected/i });
    expect(validateSpoolSubmission({ ...GOOD, formMs: 300 })).toMatchObject({ ok: false, error: /take a moment/i });
  });

  it('truncates long free text to the rule limits', () => {
    const r = validateSpoolSubmission({ ...GOOD, note: 'x'.repeat(1000), credit: 'y'.repeat(100), line: 'z'.repeat(200) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.note!.length).toBe(280);
    expect(r.data.credit!.length).toBe(40);
    expect(r.data.line.length).toBe(80);
  });

  it('mirrors the keys allowed by firestore.rules exactly', () => {
    const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
    const allowed = rules.match(/hasOnly\(\[([\s\S]*?)\]\)/)![1].match(/'([a-zA-Z]+)'/g)!.map((s) => s.replace(/'/g, '')).sort();
    const r = validateSpoolSubmission(GOOD);
    if (!r.ok) throw new Error('fixture');
    const sent = [...Object.keys(r.data), 'clientTime'].sort(); // clientTime is added at send time
    expect(sent).toEqual(allowed);
  });
});

describe('submitSpoolMeasurement', () => {
  it('posts Firestore-typed fields to the REST endpoint with the public key and returns the id', async () => {
    const r = validateSpoolSubmission(GOOD);
    if (!r.ok) throw new Error('fixture');
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toMatch(/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/meshkit-e1c10\/databases\/\(default\)\/documents\/spoolSubmissions\?key=/);
      const body = JSON.parse(init.body as string);
      expect(body.fields.brand).toEqual({ stringValue: 'Polymaker' });
      expect(body.fields.tareG).toEqual({ doubleValue: 141.5 });
      expect(body.fields.website).toEqual({ stringValue: '' });
      expect(body.fields.clientTime.stringValue).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      return new Response(JSON.stringify({ name: 'projects/x/databases/(default)/documents/spoolSubmissions/abc123' }), { status: 200 });
    });
    const res = await submitSpoolMeasurement(r.data, fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ ok: true, id: 'abc123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 403 to a validation message and network failures to a retry message', async () => {
    const r = validateSpoolSubmission(GOOD);
    if (!r.ok) throw new Error('fixture');
    const forbidden = (async () => new Response('denied', { status: 403 })) as unknown as typeof fetch;
    expect(await submitSpoolMeasurement(r.data, forbidden)).toMatchObject({ ok: false, error: /did not pass validation/ });
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await submitSpoolMeasurement(r.data, boom)).toMatchObject({ ok: false, error: /Network error/ });
    const other = (async () => new Response('oops', { status: 500 })) as unknown as typeof fetch;
    expect(await submitSpoolMeasurement(r.data, other)).toMatchObject({ ok: false, error: /HTTP 500/ });
  });
});
