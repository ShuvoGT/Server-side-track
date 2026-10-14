import { NextResponse, type NextRequest } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { hasSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Browser-side access to request logs; the admin API key stays on the server. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const search = request.nextUrl.searchParams;
  const limit = Math.min(Number(search.get('limit')) || 100, 500);
  try {
    return NextResponse.json(
      await api.logs(id, {
        limit,
        before: search.get('before') ?? undefined,
        from: search.get('from') ?? undefined,
        to: search.get('to') ?? undefined,
      }),
    );
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
