import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { runPlannerCycle } from '@/lib/worker/planner';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const { summary, briefing } = await runPlannerCycle('manual');
    return NextResponse.json({ success: true, summary, briefing });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'planner_cycle_busy' ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
