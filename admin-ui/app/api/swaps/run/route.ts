import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { runSwapCycle } from '@/lib/worker/swap';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const summary = await runSwapCycle('manual');
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'swap_cycle_busy' ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
