import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from './env';

const COOKIE = 'sst_session';
const MAX_AGE_SECONDS = 12 * 3600;

function sign(payload: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwordMatches(password: string): boolean {
  // Compare HMACs so the comparison is constant-time whatever the lengths.
  return safeEqual(sign(`pw:${password}`), sign(`pw:${env().DASHBOARD_PASSWORD}`));
}

export async function createSession(): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `admin.${expires}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function hasSession(): Promise<boolean> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return false;
  const lastDot = value.lastIndexOf('.');
  const payload = value.slice(0, lastDot);
  if (!safeEqual(value.slice(lastDot + 1), sign(payload))) return false;
  const expires = Number(payload.split('.')[1]);
  return Number.isFinite(expires) && expires > Date.now() / 1000;
}

/** Call at the top of every protected page, route handler and server action. */
export async function requireSession(): Promise<void> {
  if (!(await hasSession())) redirect('/login');
}
