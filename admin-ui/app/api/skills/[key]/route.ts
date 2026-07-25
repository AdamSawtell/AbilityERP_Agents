import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { writeAudit } from '@/lib/services/audit';
import {
  cycleSkillStatus,
  getSkill,
  getSoftWeights,
  setSkillStatus,
  type SkillStatus,
} from '@/lib/services/skills';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };
const VALID_STATUS = new Set<SkillStatus>(['on', 'paused', 'off']);

export async function GET(_request: Request, context: Ctx) {
  try {
    const { key } = await context.params;
    const skill = await getSkill(String(key));
    if (!skill) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const softWeights =
      skill.skill_key === 'worker_matching' ? await getSoftWeights() : undefined;
    return NextResponse.json({ skill, softWeights });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

export async function PATCH(request: Request, context: Ctx) {
  try {
    const { key } = await context.params;
    const body = await request.json().catch(() => ({}));
    const updatedBy = String(body?.updatedBy ?? '').trim() || 'Rostering Officer';
    const before = await getSkill(String(key));
    if (!before) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    let skill;
    if (body?.status !== undefined) {
      const status = String(body.status) as SkillStatus;
      if (!VALID_STATUS.has(status)) {
        return NextResponse.json(
          { error: 'invalid_body', message: 'status must be on|paused|off' },
          { status: 400 },
        );
      }
      skill = await setSkillStatus(String(key), status, updatedBy);
    } else {
      skill = await cycleSkillStatus(String(key), updatedBy);
    }
    if (!skill) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    await writeAudit({
      agentType: 'system',
      action: 'skill_toggled',
      approvedBy: updatedBy,
      notes: JSON.stringify({ skillKey: key, before: before.status, after: skill.status }),
    });
    return NextResponse.json({ success: true, skill });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
