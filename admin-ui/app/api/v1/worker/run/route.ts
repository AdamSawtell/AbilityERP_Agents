import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { runEmergencyScan } from '@/lib/worker/emergency';

export async function POST() {
  try {
    const summary = await runEmergencyScan('manual');
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'scan_already_running' ? 409 : 503;
    return NextResponse.json(
      { error: message === 'scan_already_running' ? 'busy' : 'scan_failed', message },
      { status },
    );
  }
}
