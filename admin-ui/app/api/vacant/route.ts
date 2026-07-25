import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { listVacantShifts, mapVacantShift } from '@/lib/db/queries/shifts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const horizon = url.searchParams.get('horizon') ?? 'today';
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + (horizon === 'period' ? 14 : 2));
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
