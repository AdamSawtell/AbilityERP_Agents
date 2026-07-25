import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { isSkillRunnable } from '@/lib/services/skills';
import { runLeaveCycle } from '@/lib/worker/leave';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const runnable = await isSkillRunnable('leave_replacer');
    if (!runnable) {
      return NextResponse.json(
        {
          error: 'skill_off',
          message: 'Leave Replacer is Off — turn On or Paused to run',
        },
        { status: 409 },
      );
    }
    const summary = await runLeaveCycle('manual');
    return NextResponse.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    const status = message.includes('busy') ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
