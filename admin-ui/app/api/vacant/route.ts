import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { listVacantShifts, mapVacantShift } from '@/lib/db/queries/shifts';
import { horizonWindow } from '@/lib/horizon';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const horizon = url.searchParams.get('horizon') ?? 'today';
    const { start, end } = horizonWindow(horizon);
    const rows = await listVacantShifts({ start, end, limit: 20 });
    const shifts = rows.map(mapVacantShift);
    return NextResponse.json({
      shifts,
      meta: {
        totalVacant: shifts.length,
        totalUrgent: shifts.filter((s) => s.urgency === 'critical' || s.urgency === 'high').length,
        period: {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
        },
        horizon,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
