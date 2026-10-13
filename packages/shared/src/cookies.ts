/** Parses a Cookie request header. The first occurrence of a name wins, as in browsers' ordering. */
export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name && !cookies.has(name)) cookies.set(name, part.slice(eq + 1).trim());
  }
  return cookies;
}

export function serializeCookieHeader(cookies: Map<string, string>): string | undefined {
  if (cookies.size === 0) return undefined;
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

export interface ParsedSetCookie {
  name: string;
  value: string;
  /** True if the header expires the cookie (Max-Age <= 0 or Expires in the past). */
  deleted: boolean;
}

export function parseSetCookie(header: string, now = Date.now()): ParsedSetCookie | null {
  const [pair, ...attributes] = header.split(';');
  const eq = pair?.indexOf('=') ?? -1;
  if (!pair || eq <= 0) return null;
  let deleted = false;
  for (const attribute of attributes) {
    const eqAt = attribute.indexOf('=');
    const key = (eqAt === -1 ? attribute : attribute.slice(0, eqAt)).trim().toLowerCase();
    const val = eqAt === -1 ? '' : attribute.slice(eqAt + 1).trim();
    if (key === 'max-age' && Number(val) <= 0) deleted = true;
    if (key === 'expires' && Date.parse(val) <= now) deleted = true;
  }
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), deleted };
}

export interface SetCookieOptions {
  domain?: string;
  maxAgeSeconds: number;
  httpOnly?: boolean;
}

export function serializeSetCookie(name: string, value: string, options: SetCookieOptions): string {
  const parts = [`${name}=${value}`, 'Path=/', `Max-Age=${options.maxAgeSeconds}`, 'Secure', 'SameSite=Lax'];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

/** Matches a cookie name against patterns where a trailing `*` matches any suffix (e.g. `_ga_*`). */
export function cookieNameMatches(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  );
}
