import {
  cookieNameMatches,
  parseCookieHeader,
  parseSetCookie,
  serializeCookieHeader,
  serializeSetCookie,
} from './cookies.js';
import type { ConsentState } from './consent.js';
import type { PowerUps } from './schemas.js';

/** HttpOnly backup of the kept cookies, so scripts and script-based cookie limits cannot touch it. */
export const BACKUP_COOKIE = '_sst_ck';
const MAX_BACKUP_LENGTH = 3800;

export interface CookieKeeperPlan {
  /** Cookie header to send to the tagging server, with restored cookies added and the backup removed. */
  forwardCookieHeader: string | undefined;
  /** Cookies taken from the backup because the browser no longer had them. */
  restored: string[];
  /** Given the tagging server's Set-Cookie headers, returns the extra Set-Cookie headers to add to the response. */
  finalize(upstreamSetCookies: readonly string[]): string[];
}

function decodeBackup(value: string | undefined): Map<string, string> {
  if (!value) return new Map();
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return new Map(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
    }
  } catch {
    // A damaged backup is dropped and rebuilt from the cookies the browser still has.
  }
  return new Map();
}

function encodeBackup(cookies: Map<string, string>): string {
  return Buffer.from(JSON.stringify(Object.fromEntries(cookies))).toString('base64url');
}

/**
 * Cookie keeper power-up. Browsers cap cookies written by JavaScript (Safari: 7 days), so the gateway re-sends the
 * marketing cookies it sees as server-set cookies with a long lifetime, and keeps an HttpOnly backup to restore
 * them when the browser has dropped them.
 *
 * Privacy rules: it never creates a marketing cookie the browser did not already have from a vendor script.
 * Restoring from the backup requires a request that grants ad_storage, and a request that denies ad_storage
 * removes the backup and extends nothing.
 */
export function planCookieKeeper(
  config: PowerUps['cookieKeeper'],
  cookieHeader: string | undefined,
  consent: ConsentState,
  cookieDomain: string,
): CookieKeeperPlan {
  if (!config.enabled) {
    return { forwardCookieHeader: cookieHeader, restored: [], finalize: () => [] };
  }
  const cookies = parseCookieHeader(cookieHeader);
  const hadBackup = cookies.has(BACKUP_COOKIE);
  const backup = decodeBackup(cookies.get(BACKUP_COOKIE));
  cookies.delete(BACKUP_COOKIE);
  const deleteBackup = () =>
    hadBackup
      ? [serializeSetCookie(BACKUP_COOKIE, '', { maxAgeSeconds: 0, domain: cookieDomain, httpOnly: true })]
      : [];

  if (consent.adStorage === false) {
    return { forwardCookieHeader: serializeCookieHeader(cookies), restored: [], finalize: deleteBackup };
  }

  const present = new Map([...cookies].filter(([name]) => cookieNameMatches(name, config.cookies)));
  const restored = new Map<string, string>();
  if (consent.adStorage === true) {
    for (const [name, value] of backup) {
      if (!present.has(name) && cookieNameMatches(name, config.cookies)) {
        restored.set(name, value);
        cookies.set(name, value);
      }
    }
  }

  return {
    forwardCookieHeader: serializeCookieHeader(cookies),
    restored: [...restored.keys()],
    finalize(upstreamSetCookies) {
      const maxAgeSeconds = config.maxAgeDays * 86400;
      const kept = new Map([...backup].filter(([name]) => cookieNameMatches(name, config.cookies)));
      for (const [name, value] of [...present, ...restored]) kept.set(name, value);
      const setByUpstream = new Set<string>();
      for (const header of upstreamSetCookies) {
        const parsed = parseSetCookie(header);
        if (!parsed || !cookieNameMatches(parsed.name, config.cookies)) continue;
        setByUpstream.add(parsed.name);
        if (parsed.deleted) kept.delete(parsed.name);
        else kept.set(parsed.name, parsed.value);
      }
      const out: string[] = [];
      for (const [name, value] of [...present, ...restored]) {
        if (!setByUpstream.has(name))
          out.push(serializeSetCookie(name, value, { maxAgeSeconds, domain: cookieDomain }));
      }
      const encoded = kept.size ? encodeBackup(kept) : '';
      if (encoded && encoded.length <= MAX_BACKUP_LENGTH) {
        out.push(
          serializeSetCookie(BACKUP_COOKIE, encoded, { maxAgeSeconds, domain: cookieDomain, httpOnly: true }),
        );
      } else {
        out.push(...deleteBackup());
      }
      return out;
    },
  };
}
