import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { getSkill, isSkillRunnable } from '@/lib/services/skills';
import { runConfirmCycle } from '@/lib/worker/confirm';
import { runEmergencyScan } from '@/lib/worker/emergency';
import { runLeaveCycle } from '@/lib/worker/leave';
import { runPlannerCycle } from '@/lib/worker/planner';
import { runSwapCycle } from '@/lib/worker/swap';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

export async function POST(_request: Request, context: Ctx) {
  try {
    const { key } = await context.params;
    const skill = await getSkill(String(key));
    if (!skill) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const runnable = await isSkillRunnable(String(key));
    if (!runnable) {
      return NextResponse.json(
        {
          error: 'skill_off',
          message: `${skill.name} is Off — turn On or Paused to run`,
        },
        { status: 409 },
      );
    }

    switch (key) {
      case 'shift_scanner':
      case 'worker_matching':
      case 'gap_detector': {
        const summary = await runEmergencyScan('manual');
        return NextResponse.json({ success: true, skillKey: key, result: summary });
      }
      case 'pre_shift_confirm': {
        const summary = await runConfirmCycle('manual');
        return NextResponse.json({ success: true, skillKey: key, result: summary });
      }
      case 'swap_handler': {
        const summary = await runSwapCycle('manual');
        return NextResponse.json({ success: true, skillKey: key, result: summary });
      }
      case 'planner_briefing': {
        const { summary, briefing } = await runPlannerCycle('manual');
        return NextResponse.json({
          success: true,
          skillKey: key,
          result: { ...summary, fillRate: briefing.fillRate.thisPeriod },
        });
      }
      case 'leave_replacer': {
        const summary = await runLeaveCycle('manual');
        return NextResponse.json({ success: true, skillKey: key, result: summary });
      }
      case 'pathways_message':
      case 'credential_watch':
        return NextResponse.json(
          {
            error: 'not_runnable',
            message: `${skill.name} has no standalone runner`,
          },
          { status: 400 },
        );
      default:
        return NextResponse.json({ error: 'not_runnable' }, { status: 400 });
    }
  } catch (err) {
    const message = errorMessage(err);
    if (message.includes('_busy') || message.includes('already_running')) {
      return NextResponse.json({ error: 'busy', message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
