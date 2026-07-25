import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { runConfirmCycle } from '@/lib/worker/confirm';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const summary = await runConfirmCycle('manual');
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'confirm_cycle_busy' ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
