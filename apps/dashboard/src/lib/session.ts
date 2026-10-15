import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from './env';

const COOKIE = 'sst_session';
const WORKSPACE_COOKIE = 'sst_workspace';
const MAX_AGE_SECONDS = 7 * 86_400;

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

function sign(payload: string): string {
  return createHmac('sha256', env().SESSION_SECRET).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "<payload>.<hmac>": tamper-proof, not secret. */
export function sealed(payload: string): string {
  return `${payload}.${sign(payload)}`;
}

export function unseal(value: string | undefined): string | null {
  if (!value) return null;
  const lastDot = value.lastIndexOf('.');
  if (lastDot < 1) return null;
  const payload = value.slice(0, lastDot);
  return safeEqual(value.slice(lastDot + 1), sign(payload)) ? payload : null;
}

export interface Session {
  userId: string;
}

export async function createSession(userId: string): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  (await cookies()).set(COOKIE, sealed(`v2.${userId}.${expires}`), cookieOptions(MAX_AGE_SECONDS));
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(WORKSPACE_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const payload = unseal((await cookies()).get(COOKIE)?.value);
  const [version, userId, expires] = payload?.split('.') ?? [];
  if (version !== 'v2' || !userId || !(Number(expires) > Date.now() / 1000)) return null;
  return { userId };
}

/** Call at the top of every protected page, route handler and server action. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/** The workspace picked in the sidebar. Only a preference: the API checks membership on every request. */
export async function selectedWorkspaceId(): Promise<string | undefined> {
  return (await cookies()).get(WORKSPACE_COOKIE)?.value;
}

export async function selectWorkspace(id: string): Promise<void> {
  (await cookies()).set(WORKSPACE_COOKIE, id, cookieOptions(365 * 86_400));
}
