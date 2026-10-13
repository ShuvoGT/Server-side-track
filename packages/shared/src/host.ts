import { getDomain } from 'tldts';

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** Lower-cases a Host header value and strips the port and any trailing dot. Returns null for invalid names. */
export function normalizeHost(value: string | undefined | null): string | null {
  if (!value) return null;
  let host = value.trim().toLowerCase();
  if (host.startsWith('[')) return null; // IP literal; customers always use names.
  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return HOSTNAME_RE.test(host) ? host : null;
}

/**
 * The registrable domain to scope first-party cookies to, so that sst.shop.com sets cookies for shop.com.
 * Uses the public suffix list, so sst.shop.com.bd gives shop.com.bd.
 */
export function cookieDomainFor(host: string): string {
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}
