import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { destroySession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Pages cannot clear cookies; they send a session whose user is gone here. */
export async function GET() {
  await destroySession();
  return NextResponse.redirect(new URL('/login', env().DASHBOARD_URL));
}
