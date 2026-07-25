import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { runEmergencyScan } from '@/lib/worker/emergency';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const summary = await runEmergencyScan('manual');
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'scan_already_running' ? 409 : 502;
    return NextResponse.json(
      { error: message === 'scan_already_running' ? 'busy' : message },
      { status },
    );
  }
}
