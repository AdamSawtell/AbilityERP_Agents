import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { runPlannerCycle } from '@/lib/worker/planner';

export async function POST() {
  try {
    const { summary, briefing } = await runPlannerCycle('manual');
    return NextResponse.json({ success: true, summary, briefing });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'planner_cycle_busy' ? 409 : 503;
    return NextResponse.json({ error: 'planner_run_failed', message }, { status });
  }
}
