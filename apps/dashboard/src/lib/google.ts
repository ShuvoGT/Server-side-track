import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { env } from './env';

/** Google's OAuth endpoints (OpenID Connect). */
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export const OAUTH_COOKIE = 'sst_oauth';
export const redirectUri = () => new URL('/api/auth/google/callback', env().DASHBOARD_URL).toString();

/** A fresh state (against forged callbacks) and PKCE verifier (against stolen codes) for one sign-in. */
export function newAuthorization() {
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { url, state, verifier };
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * Trades the code for an ID token. The token comes straight from Google over TLS to this server, in exchange for
 * the client secret, so its claims are checked but its signature need not be (OpenID Connect Core 3.1.3.7).
 */
export async function exchangeCode(code: string, verifier: string): Promise<GoogleIdentity> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env().GOOGLE_CLIENT_ID!,
      client_secret: env().GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!response.ok || !data.id_token)
    throw new Error(`Google token exchange failed: ${data.error ?? response.status}`);

  const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
    iss?: string;
    aud?: string;
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  };
  if (!claims.iss || !ISSUERS.has(claims.iss)) throw new Error('Unexpected ID token issuer');
  if (claims.aud !== env().GOOGLE_CLIENT_ID) throw new Error('ID token is for another client');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('ID token expired');
  if (!claims.sub || !claims.email) throw new Error('ID token without sub or email');
  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name ?? '',
  };
}
