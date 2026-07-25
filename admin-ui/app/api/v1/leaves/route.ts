import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import {
  listLeaveReplacements,
  listPendingOverlaps,
} from '@/lib/services/leaveReplacer';
import { getLastLeaveCycle } from '@/lib/worker/leave';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status =
      typeof url.searchParams.get('status') === 'string' && url.searchParams.get('status')
        ? (url.searchParams.get('status') as string)
        : undefined;
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const [replacements, pending, lastCycle] = await Promise.all([
      listLeaveReplacements(limit, status),
      listPendingOverlaps(30),
      Promise.resolve(getLastLeaveCycle()),
    ]);
    return NextResponse.json({ replacements, pending, lastCycle });
  } catch (err) {
    return NextResponse.json(
      { error: 'db_unavailable', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
