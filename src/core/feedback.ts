/**
 * User feedback and bug-report submissions.
 *
 * Appends one validated document to Firestore (`feedbackSubmissions`) over REST
 * using the referrer-restricted public web API key. No read/update/delete path
 * exists on the client (`firestore.rules` denies everything except well-formed
 * `create` requests). A scheduled server-side job forwards un-emailed items as
 * a bounded digest to the maintainer inbox so neither raw email scraping nor
 * form-flood spam reaches the inbox directly.
 */
import firebasePublic from '../data/firebase-public.json';

export const FEEDBACK_TOPICS = [
  'bug',
  'formula',
  'feature',
  'spreadsheet',
  'spool_tare',
  'other',
] as const;

export type FeedbackTopic = (typeof FEEDBACK_TOPICS)[number];

export interface FeedbackSubmissionInput {
  topic: FeedbackTopic;
  message: string;
  replyEmail: string;
  toolRef: string;
  page: string;
  /** Milliseconds the form was open before submit (rules require >= 3500). */
  formMs: number;
  /** Honeypot; must be empty. */
  website: string;
}

export type FeedbackValidation =
  | { ok: true; data: FeedbackSubmissionInput }
  | { ok: false; error: string };

const EMAIL_RE = /^[^@\s\r\n]{1,64}@[^@\s\r\n]{1,185}\.[^@\s\r\n]{2,24}$/;
const URL_COUNT_RE = /https?:\/\//gi;
const MARKUP_SPAM_RE = /<\s*a\s+href\s*=|\[\s*url\s*=/i;
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function cleanSingleLine(val: unknown, max: number): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\r\n\t]+/g, ' ').replace(CTRL_RE, '').trim().slice(0, max);
}

function cleanMultiLine(val: unknown, max: number): string {
  if (typeof val !== 'string') return '';
  return val.replace(/\r\n?/g, '\n').replace(CTRL_RE, '').trim().slice(0, max);
}

export function validateFeedbackSubmission(raw: Record<string, unknown>): FeedbackValidation {
  const topicRaw = cleanSingleLine(raw.topic, 24);
  if (!(FEEDBACK_TOPICS as readonly string[]).includes(topicRaw)) {
    return { ok: false, error: 'Pick a feedback category.' };
  }
  const topic = topicRaw as FeedbackTopic;

  const website = cleanSingleLine(raw.website, 200);
  if (website !== '') {
    return { ok: false, error: 'Submission rejected.' };
  }

  const formMs = Number(raw.formMs);
  if (!Number.isFinite(formMs) || formMs < 3500) {
    return { ok: false, error: 'Please take a moment to finish your note, then submit again.' };
  }

  const replyEmail = cleanSingleLine(raw.replyEmail, 254);
  if (replyEmail !== '' && !EMAIL_RE.test(replyEmail)) {
    return { ok: false, error: 'Enter a valid reply email address, or leave it blank.' };
  }

  const message = cleanMultiLine(raw.message, 1500);
  if (message.length < 10) {
    return { ok: false, error: 'Please write at least 10 characters so we can act on your note.' };
  }
  const urlMatches = message.match(URL_COUNT_RE);
  if ((urlMatches && urlMatches.length > 2) || MARKUP_SPAM_RE.test(message)) {
    return { ok: false, error: 'Too many links in the message (maximum 2 plain URLs).' };
  }

  const toolRef = cleanSingleLine(raw.toolRef, 120);
  const rawPage = cleanSingleLine(raw.page, 120);
  const page = rawPage.startsWith('/') ? rawPage : '/about';

  return {
    ok: true,
    data: {
      topic,
      message,
      replyEmail,
      toolRef,
      page,
      formMs: Math.min(Math.round(formMs), 86400000),
      website: '',
    },
  };
}

function toFirestoreFields(d: FeedbackSubmissionInput): Record<string, unknown> {
  const s = (v: string) => ({ stringValue: v });
  const n = (v: number) => ({ doubleValue: v });
  return {
    topic: s(d.topic),
    message: s(d.message),
    replyEmail: s(d.replyEmail),
    toolRef: s(d.toolRef),
    page: s(d.page),
    clientTime: s(new Date().toISOString()),
    formMs: n(d.formMs),
    website: s(''),
  };
}

export async function submitFeedback(
  data: FeedbackSubmissionInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { projectId, apiKey } = firebasePublic as { projectId: string; apiKey: string };
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/feedbackSubmissions?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
    });
    if (!res.ok) {
      if (res.status === 403) {
        return { ok: false, error: 'Submission did not pass spam or field checks. Please review and try again.' };
      }
      return { ok: false, error: `Could not send right now (HTTP ${res.status}). Please try again later.` };
    }
    const json = (await res.json()) as { name?: string };
    return { ok: true, id: (json.name ?? '').split('/').pop() ?? '' };
  } catch {
    return { ok: false, error: 'Network error — your message was not sent. Check your connection and retry.' };
  }
}
