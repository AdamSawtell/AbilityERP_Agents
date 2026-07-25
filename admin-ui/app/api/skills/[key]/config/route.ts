import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { writeAudit } from '@/lib/services/audit';
import { getSkill, updateSkillConfig } from '@/lib/services/skills';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

export async function PUT(request: Request, context: Ctx) {
  try {
    const { key } = await context.params;
    const body = await request.json().catch(() => ({}));
    const updatedBy = String(body?.updatedBy ?? '').trim() || 'Rostering Officer';
    const skill = await getSkill(String(key));
    if (!skill) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    if (key === 'worker_matching' && body?.soft_weights) {
      const weights = body.soft_weights as Record<string, unknown>;
      const soft_weights: Record<string, number> = {};
      for (const [k, v] of Object.entries(weights)) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        soft_weights[k] = Math.min(100, Math.max(0, Math.round(n)));
      }
      const nextConfig = { ...skill.config_json, soft_weights };
      const updated = await updateSkillConfig(String(key), nextConfig, updatedBy);
      await writeAudit({
        agentType: 'system',
        action: 'config_updated',
        approvedBy: updatedBy,
        notes: JSON.stringify({ skillKey: key, soft_weights }),
      });
      return NextResponse.json({ success: true, skill: updated, softWeights: soft_weights });
    }
    return NextResponse.json(
      { error: 'invalid_body', message: 'No supported config fields' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
