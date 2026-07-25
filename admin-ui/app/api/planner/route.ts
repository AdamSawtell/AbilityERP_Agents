import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { buildPlannerBriefing } from '@/lib/services/planner';
import { getLastBriefing, getLastPlannerCycle } from '@/lib/worker/planner';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cached = getLastBriefing();
    const briefing = cached ?? (await buildPlannerBriefing());
    return NextResponse.json({
      briefing,
      cached: Boolean(cached),
      lastCycle: getLastPlannerCycle(),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
