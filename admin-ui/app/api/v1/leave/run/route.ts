import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { isSkillRunnable } from '@/lib/services/skills';
import { runLeaveCycle } from '@/lib/worker/leave';

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
    if (message.includes('busy')) {
      return NextResponse.json({ error: 'busy', message }, { status: 409 });
    }
    return NextResponse.json({ error: 'leave_run_failed', message }, { status: 503 });
  }
}
