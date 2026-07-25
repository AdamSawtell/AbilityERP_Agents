import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { listGaps } from '@/lib/services/gaps';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);
    let resolved: boolean | undefined;
    if (url.searchParams.get('resolved') === 'true') resolved = true;
    if (url.searchParams.get('resolved') === 'false') resolved = false;
    const rows = await listGaps(resolved, limit, offset);
    return NextResponse.json({
      gaps: rows.map((g) => ({
        id: Number(g.id),
        detected_at: g.detected_at,
        shift_id: g.shift_id != null ? Number(g.shift_id) : null,
        shift_name: g.shift_name,
        shift_date: g.shift_date,
        shift_time: g.shift_time,
        reason: g.reason,
        credential_id: g.credential_id != null ? Number(g.credential_id) : null,
        credential_name: g.credential_name,
        blocked_count: g.blocked_count != null ? Number(g.blocked_count) : null,
        resolved: Boolean(g.resolved),
        training_requested: Boolean(g.training_requested),
        escalation_level: g.escalation_level,
        resolution_notes: g.resolution_notes,
      })),
      limit,
      offset,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
