#!/usr/bin/env node
/**
 * Server-side feedback & spool-submission email digest forwarder.
 *
 * Reads un-emailed documents from Firestore (`feedbackSubmissions` and
 * `spoolSubmissions`), bundles up to 20 items into a single HTML-escaped
 * digest email to `meshkit@quantlance.com` via Resend (preventing inbox floods
 * or Resend quota exhaustion even under spam bursts), and stamps `emailedAt`
 * on each forwarded document.
 *
 * Secrets (`FIREBASE_SERVICE_ACCOUNT`, `RESEND_API_KEY`) are read exclusively
 * from environment variables and never logged.
 */
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROJECT_ID = 'meshkit-e1c10';
const DEFAULT_TO = 'meshkit@quantlance.com';
const DEFAULT_FROM = 'MeshKit Feedback <no-reply@velafolio.com>';
const MAX_PER_RUN = 20;
const SAFE_EMAIL_RE = /^[^@\s\r\n"<>]{1,64}@[^@\s\r\n"<>]{1,185}\.[^@\s\r\n"<>]{2,24}$/;

export function escapeHtml(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeHeaderLine(raw, max = 140) {
  return String(raw ?? '')
    .replace(/[\r\n\t\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function unwrapFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('booleanValue' in v) out[k] = Boolean(v.booleanValue);
  }
  return out;
}

export function buildDigestEmail(feedbackItems, spoolItems) {
  const total = feedbackItems.length + spoolItems.length;
  const subject =
    total === 1 && feedbackItems.length === 1
      ? sanitizeHeaderLine(
          `[MeshKit ${feedbackItems[0].topic || 'feedback'}] ${(feedbackItems[0].message || '').slice(0, 72)}`
        )
      : sanitizeHeaderLine(
          `[MeshKit Digest] ${feedbackItems.length} feedback, ${spoolItems.length} spool submission(s)`
        );

  let replyTo;
  if (
    feedbackItems.length === 1 &&
    spoolItems.length === 0 &&
    typeof feedbackItems[0].replyEmail === 'string' &&
    SAFE_EMAIL_RE.test(feedbackItems[0].replyEmail.trim())
  ) {
    replyTo = feedbackItems[0].replyEmail.trim();
  }

  const fbBlocks = feedbackItems.map((it) => {
    const reply = it.replyEmail ? escapeHtml(it.replyEmail) : '<em>anonymous (none given)</em>';
    const tool = it.toolRef ? escapeHtml(it.toolRef) : escapeHtml(it.page || '/about');
    return `<div style="border:1px solid #d1d5db;border-radius:6px;padding:14px 16px;margin:0 0 12px;background:#ffffff;">
      <div style="font-size:12px;color:#6b7280;font-family:monospace;margin-bottom:6px;">
        <strong>[${escapeHtml(it.topic || 'other').toUpperCase()}]</strong> &middot; Ref: ${escapeHtml(it.id.slice(0, 8))} &middot; ${escapeHtml(it.clientTime || '')}
      </div>
      <div style="font-size:13px;color:#374151;margin-bottom:8px;">
        <strong>Reply-To:</strong> ${reply} &nbsp;|&nbsp; <strong>Tool/Page:</strong> ${tool}
      </div>
      <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5;color:#111827;background:#f9fafb;padding:10px;border-radius:4px;">${escapeHtml(it.message || '')}</pre>
    </div>`;
  });

  const spoolBlocks = spoolItems.map(
    (it) => `<div style="border:1px solid #d1d5db;border-radius:6px;padding:12px 16px;margin:0 0 10px;background:#ffffff;font-size:13px;color:#1f2937;">
      <strong>[SPOOL TARE]</strong> ${escapeHtml(it.brand)} ${escapeHtml(it.line || '')} (${escapeHtml(it.spoolMaterial)}) &mdash;
      <strong>${escapeHtml(it.tareG)} g</strong> tare / ${escapeHtml(it.netG)} g net
      ${it.credit ? `&middot; credit: ${escapeHtml(it.credit)}` : ''}
      ${it.note ? `<div style="color:#4b5563;margin-top:4px;">Note: ${escapeHtml(it.note)}</div>` : ''}
      <div style="font-size:11px;color:#6b7280;font-family:monospace;margin-top:4px;">Ref: ${escapeHtml(it.id)} &middot; Run: python3 scripts/import-spool-submissions.py list</div>
    </div>`
  );

  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;padding:20px;margin:0;">
    <div style="max-width:680px;margin:0 auto;">
      <h2 style="font-size:16px;color:#111827;margin:0 0 12px;">MeshKit Submissions (${total})</h2>
      ${fbBlocks.join('\n')}
      ${spoolBlocks.join('\n')}
      <p style="font-size:11px;color:#6b7280;margin-top:16px;">
        Forwarded automatically from Firestore project <code>${PROJECT_ID}</code>.
        ${replyTo ? 'Hit Reply to respond directly to the sender.' : ''}
      </p>
    </div>
  </body></html>`;

  return { subject, html, replyTo };
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function mintAccessToken(saJson) {
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  const assertion = `${unsigned}.${base64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function listUnemailed(token, collection) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}`;
  const pending = [];
  let pageToken = '';
  while (pending.length < MAX_PER_RUN) {
    const url = `${base}?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Firestore list ${collection} failed: HTTP ${res.status}`);
    const body = await res.json();
    for (const doc of body.documents || []) {
      const f = unwrapFields(doc.fields);
      if (!f.emailedAt && f.status !== 'rejected') {
        pending.push({ id: doc.name.split('/').pop(), docName: doc.name, ...f });
        if (pending.length >= MAX_PER_RUN) break;
      }
    }
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return pending;
}

async function markEmailed(token, docName, isoNow) {
  const url = `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=emailedAt`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { emailedAt: { stringValue: isoNow } } }),
  });
  if (!res.ok) throw new Error(`Firestore patch failed: HTTP ${res.status}`);
}

async function main() {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const resendKey = process.env.RESEND_API_KEY;
  if (!saJson || !resendKey) {
    throw new Error('Required secrets FIREBASE_SERVICE_ACCOUNT and RESEND_API_KEY must be set in environment.');
  }

  const token = await mintAccessToken(saJson);
  const feedbackItems = await listUnemailed(token, 'feedbackSubmissions');
  const spoolItems = await listUnemailed(token, 'spoolSubmissions');

  if (feedbackItems.length === 0 && spoolItems.length === 0) {
    console.log('No new submissions to forward.');
    return;
  }

  const toEmail = process.env.FEEDBACK_TO_EMAIL || DEFAULT_TO;
  const fromEmail = process.env.RESEND_FROM || DEFAULT_FROM;
  const { subject, html, replyTo } = buildDigestEmail(feedbackItems, spoolItems);

  const payload = {
    from: fromEmail,
    to: [toEmail],
    subject,
    html,
  };
  if (replyTo) payload.reply_to = replyTo;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!emailRes.ok) {
    throw new Error(`Resend API returned HTTP ${emailRes.status}`);
  }

  const isoNow = new Date().toISOString();
  for (const item of [...feedbackItems, ...spoolItems]) {
    await markEmailed(token, item.docName, isoNow);
  }
  console.log(`Forwarded ${feedbackItems.length} feedback and ${spoolItems.length} spool submission(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : 'Forwarder failed');
    process.exit(1);
  });
}
