import { NextResponse, type NextRequest } from 'next/server';
import { env, googleEnabled } from '@/lib/env';
import { newAuthorization, OAUTH_COOKIE } from '@/lib/google';
import { cookieOptions, sealed } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** "Continue with Google": remembers state and PKCE verifier in a short-lived cookie, then goes to Google. */
export async function GET(request: NextRequest) {
  if (!googleEnabled()) return NextResponse.redirect(new URL('/login?error=google_off', env().DASHBOARD_URL));
  const next = request.nextUrl.searchParams.get('next') ?? '/';
  const { url, state, verifier } = newAuthorization();
  const response = NextResponse.redirect(url);
  const payload = Buffer.from(JSON.stringify({ state, verifier, next })).toString('base64url');
  response.cookies.set(OAUTH_COOKIE, sealed(payload), cookieOptions(10 * 60));
  return response;
}
