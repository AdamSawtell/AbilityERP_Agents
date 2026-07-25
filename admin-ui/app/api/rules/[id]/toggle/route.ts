import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { writeAudit } from '@/lib/services/audit';
import { toggleRosterRule } from '@/lib/services/rosterRulesStore';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const updatedBy = String(body?.updatedBy ?? 'admin-ui').trim() || 'admin-ui';
    const rule = await toggleRosterRule(id, updatedBy);
    if (!rule) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    await writeAudit({
      agentType: 'system',
      action: 'rule_toggled',
      approvedBy: updatedBy,
      notes: JSON.stringify({ id, enabled: rule.enabled }),
    });
    return NextResponse.json({ success: true, rule });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
