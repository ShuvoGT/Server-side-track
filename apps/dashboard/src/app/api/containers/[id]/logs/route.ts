import { NextResponse, type NextRequest } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { hasSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Browser-side access to request logs; the admin API key stays on the server. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const before = request.nextUrl.searchParams.get('before') ?? undefined;
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit')) || 100, 500);
  try {
    return NextResponse.json(await api.logs(id, limit, before));
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
