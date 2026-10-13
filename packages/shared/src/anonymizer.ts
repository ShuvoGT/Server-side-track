import type { PowerUps } from './schemas.js';

const EMAIL_RE = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PERSONAL_PARAM_RE =
  /^(e-?mail|email_?address|phone|phone_?number|tel|mobile|first_?name|last_?name|full_?name|name|address|street|password)$/i;
export const REDACTED = '[redacted]';

/** Masks email addresses anywhere in a string, including URL-encoded ones. */
export function redactEmails(value: string): string {
  return value.replace(EMAIL_RE, REDACTED);
}

/** Masks personal query parameters (email, phone, name...) and email addresses in a URL. */
export function redactUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return redactEmails(value);
  }
  for (const key of [...url.searchParams.keys()]) {
    if (PERSONAL_PARAM_RE.test(key)) url.searchParams.set(key, REDACTED);
  }
  return redactEmails(url.toString());
}

const URL_PARAMS = new Set(['dl', 'dr', 'ep.page_location', 'ep.page_referrer']);

/**
 * Applies the anonymizer to one set of GA4 collect parameters (the query string, or one line of the body).
 * Returns true if anything changed.
 */
export function anonymizeGa4Params(params: URLSearchParams, config: PowerUps['anonymizer']): boolean {
  let changed = false;
  if (config.removeUserId && params.has('uid')) {
    params.delete('uid');
    changed = true;
  }
  if (config.anonymizeIp && params.has('_uip')) {
    params.delete('_uip');
    changed = true;
  }
  if (config.redactPii) {
    for (const [key, value] of [...params]) {
      const isText = URL_PARAMS.has(key) || key === 'dt' || key.startsWith('ep.') || key.startsWith('up.');
      if (!isText) continue;
      const next = URL_PARAMS.has(key) ? redactUrl(value) : redactEmails(value);
      if (next !== value) {
        params.set(key, next);
        changed = true;
      }
    }
  }
  return changed;
}

/** GA4 batches events in the POST body as one query string per line. */
export function anonymizeGa4Body(body: string, config: PowerUps['anonymizer']): string {
  return body
    .split('\n')
    .map((line) => {
      if (!line) return line;
      const params = new URLSearchParams(line);
      return anonymizeGa4Params(params, config) ? params.toString() : line;
    })
    .join('\n');
}

/** GA4 web tags send events to /g/collect on the server container URL. */
export function isGa4CollectPath(path: string): boolean {
  return path === '/g/collect' || path.endsWith('/g/collect');
}
