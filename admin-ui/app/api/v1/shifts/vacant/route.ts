import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { listVacantShifts, mapVacantShift } from '@/lib/db/queries/shifts';
import { horizonWindow } from '@/lib/horizon';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const horizon = String(url.searchParams.get('horizon') ?? 'today');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const { start, end } = horizonWindow(horizon);

    const periodStart = url.searchParams.get('period_start');
    const periodEnd = url.searchParams.get('period_end');
    if (periodStart) start.setTime(Date.parse(periodStart));
    if (periodEnd) end.setTime(Date.parse(periodEnd));

    const rows = await listVacantShifts({ start, end, limit });
    const shifts = rows.map(mapVacantShift);
    const urgent = shifts.filter((s) => s.urgency === 'critical' || s.urgency === 'high').length;

    return NextResponse.json({
      shifts,
      meta: {
        totalVacant: shifts.length,
        totalUrgent: urgent,
        period: {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
        },
        horizon,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'db_unavailable', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
