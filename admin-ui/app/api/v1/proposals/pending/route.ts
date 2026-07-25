import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { listPendingProposals } from '@/lib/services/proposals';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
    const payload = await listPendingProposals(limit, offset);
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: 'db_unavailable', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
