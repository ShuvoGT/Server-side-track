import { NextResponse, type NextRequest } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { env } from '@/lib/env';
import { exchangeCode, OAUTH_COOKIE } from '@/lib/google';
import { createSession, selectWorkspace, unseal } from '@/lib/session';

export const dynamic = 'force-dynamic';

const safeNext = (value: unknown) =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : '/';

/** Google sends the browser back here with a code; the account is created or linked by the API. */
export async function GET(request: NextRequest) {
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${reason}`, env().DASHBOARD_URL));
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  };

  const params = request.nextUrl.searchParams;
  if (params.get('error')) return fail('google_cancelled');
  const saved = unseal(request.cookies.get(OAUTH_COOKIE)?.value);
  if (!saved) return fail('google_expired');
  const { state, verifier, next } = JSON.parse(Buffer.from(saved, 'base64url').toString('utf8')) as {
    state: string;
    verifier: string;
    next: string;
  };
  const code = params.get('code');
  if (!code || params.get('state') !== state) return fail('google_expired');

  try {
    const identity = await exchangeCode(code, verifier);
    const me = await api.signInWithGoogle(identity);
    await createSession(me.user.id);
    const own = me.workspaces.find((w) => w.role === 'owner') ?? me.workspaces[0];
    if (own) await selectWorkspace(own.id);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'email_not_verified') return fail('google_unverified');
    console.error('Google sign-in failed', error);
    return fail('google_failed');
  }
  const response = NextResponse.redirect(new URL(safeNext(next), env().DASHBOARD_URL));
  response.cookies.delete(OAUTH_COOKIE);
  return response;
}
