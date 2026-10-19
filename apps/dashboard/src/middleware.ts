import { NextResponse, type NextRequest } from 'next/server';

/**
 * Visitors without a session see the landing page at "/"; signed-in users get the dashboard there. Only the
 * cookie's presence is checked: a stale cookie still reaches the dashboard, which sends it to sign-in.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.has('sst_session')) return NextResponse.next();
  return NextResponse.rewrite(new URL('/welcome', request.url));
}

export const config = { matcher: '/' };
