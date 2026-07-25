import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { runSwapCycle } from '@/lib/worker/swap';

/** Maps Express POST /swaps/run → detect + propose cycle. */
export async function POST() {
  try {
    const summary = await runSwapCycle('manual');
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'swap_cycle_busy' ? 409 : 503;
    return NextResponse.json({ error: 'swap_run_failed', message }, { status });
  }
}
