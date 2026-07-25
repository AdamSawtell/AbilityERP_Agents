import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { listConfirmations } from '@/lib/services/confirmations';
import { getLastConfirmCycle } from '@/lib/worker/confirm';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? undefined;
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const rows = await listConfirmations({ status, limit });
    return NextResponse.json({
      confirmations: rows.map((r) => ({
        id: Number(r.id),
        shiftId: Number(r.shift_id),
        shiftName: r.shift_name,
        workerId: Number(r.worker_id),
        workerName: r.worker_name,
        staffLineId: r.staff_line_id != null ? Number(r.staff_line_id) : null,
        status: r.status,
        requestedAt: r.requested_at,
        respondedAt: r.responded_at,
        escalatedAt: r.escalated_at,
        shiftStart: r.shift_start,
        notes: r.notes,
      })),
      lastCycle: getLastConfirmCycle(),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
