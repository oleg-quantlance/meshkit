import { describe, expect, it, vi } from 'vitest';
import { submitFeedback, validateFeedbackSubmission } from '../../src/core/feedback';
// @ts-expect-error plain ESM maintainer script tested for escaping/header safety
import { buildDigestEmail, escapeHtml, sanitizeHeaderLine } from '../../scripts/forward-feedback.mjs';

const VALID = {
  topic: 'bug',
  message: 'Bambu 3MF file with two plates imported only plate 1.',
  replyEmail: 'maker@example.com',
  toolRef: '/3mf-to-stl-converter',
  page: '/about',
  formMs: 6200,
  website: '',
};

describe('validateFeedbackSubmission', () => {
  it('accepts a valid feedback payload with or without replyEmail', () => {
    const res1 = validateFeedbackSubmission(VALID);
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.data.topic).toBe('bug');
      expect(res1.data.replyEmail).toBe('maker@example.com');
      expect(res1.data.website).toBe('');
    }

    const res2 = validateFeedbackSubmission({ ...VALID, replyEmail: '   ' });
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2.data.replyEmail).toBe('');
  });

  it('rejects honeypot, fast bot submissions, unknown topics, short messages, and invalid emails', () => {
    expect(validateFeedbackSubmission({ ...VALID, website: 'https://spam.example' }).ok).toBe(false);
    expect(validateFeedbackSubmission({ ...VALID, formMs: 1200 }).ok).toBe(false);
    expect(validateFeedbackSubmission({ ...VALID, topic: 'seo_pitch' }).ok).toBe(false);
    expect(validateFeedbackSubmission({ ...VALID, message: 'too short' }).ok).toBe(false);
    expect(validateFeedbackSubmission({ ...VALID, replyEmail: 'not-an-email' }).ok).toBe(false);
    expect(validateFeedbackSubmission({ ...VALID, replyEmail: 'bad@domain\r\nBcc:victim@example.com' }).ok).toBe(false);
  });

  it('rejects link-farm spam (3+ URLs or HTML/BBCode anchor markup)', () => {
    expect(
      validateFeedbackSubmission({
        ...VALID,
        message: 'Visit https://a.test and https://b.test and https://c.test today!',
      }).ok
    ).toBe(false);
    expect(
      validateFeedbackSubmission({
        ...VALID,
        message: 'Great site <a href="https://spam.test">click here</a> please check.',
      }).ok
    ).toBe(false);
    expect(
      validateFeedbackSubmission({
        ...VALID,
        message: 'Check [url=https://spam.test]cheap filament[/url] right now.',
      }).ok
    ).toBe(false);
    // Up to 2 plain URLs (e.g. linking a sample STL + slicer issue) are allowed:
    expect(
      validateFeedbackSubmission({
        ...VALID,
        message: 'Repro file at https://example.com/a.3mf compared with https://example.com/b.stl',
      }).ok
    ).toBe(true);
  });
});

describe('submitFeedback', () => {
  it('posts Firestore document fields and returns document ID on 200', async () => {
    const v = validateFeedbackSubmission(VALID);
    expect(v.ok).toBe(true);
    if (!v.ok) return;

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ name: 'projects/meshkit-e1c10/databases/(default)/documents/feedbackSubmissions/abc123xyz' }),
    });
    const out = await submitFeedback(v.data, fakeFetch as unknown as typeof fetch);
    expect(out).toEqual({ ok: true, id: 'abc123xyz' });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('maps 403 and network errors cleanly without leaking raw server text', async () => {
    const v = validateFeedbackSubmission(VALID);
    if (!v.ok) return;
    const res403 = await submitFeedback(
      v.data,
      vi.fn().mockResolvedValue({ ok: false, status: 403 }) as unknown as typeof fetch
    );
    expect(res403.ok).toBe(false);

    const resNet = await submitFeedback(
      v.data,
      vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    );
    expect(resNet.ok).toBe(false);
  });
});

describe('forward-feedback digest escaping & header safety', () => {
  it('escapes hostile HTML in message/email/toolRef and strips CRLF in subject', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(sanitizeHeaderLine('Hello\r\nBcc: attacker@evil.test')).toBe('Hello Bcc: attacker@evil.test');

    const { subject, html, replyTo } = buildDigestEmail(
      [
        {
          id: 'doc123456',
          topic: 'bug',
          message: '<img src=x onerror=alert(1)>\r\nLine 2',
          replyEmail: 'user@example.com',
          toolRef: '"><svg onload=alert(2)>',
          page: '/about',
          clientTime: '2026-11-09T23:00:00Z',
        },
      ],
      []
    );
    expect(subject).not.toMatch(/[\r\n]/);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(replyTo).toBe('user@example.com');
  });

  it('omits replyTo when multiple items are digested or replyEmail has unsafe chars', () => {
    const multi = buildDigestEmail(
      [
        { id: '1', topic: 'bug', message: 'First valid note here', replyEmail: 'a@b.co' },
        { id: '2', topic: 'other', message: 'Second valid note here', replyEmail: 'c@d.co' },
      ],
      []
    );
    expect(multi.replyTo).toBeUndefined();

    const unsafe = buildDigestEmail(
      [{ id: '1', topic: 'bug', message: 'Valid message text', replyEmail: 'bad"<x>@b.co' }],
      []
    );
    expect(unsafe.replyTo).toBeUndefined();
  });
});
