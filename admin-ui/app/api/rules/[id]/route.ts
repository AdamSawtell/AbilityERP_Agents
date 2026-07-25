import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { writeAudit } from '@/lib/services/audit';
import {
  getRosterRule,
  softDeleteRosterRule,
  updateRosterRule,
  type RosterRulePatch,
} from '@/lib/services/rosterRulesStore';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const rule = await getRosterRule(id);
    if (!rule) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ rule });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const updatedBy = String(body?.updatedBy ?? 'admin-ui').trim() || 'admin-ui';
    const patch: RosterRulePatch = {};
    for (const key of [
      'name',
      'description',
      'enabled',
      'enforcement',
      'priority',
      'parameters',
      'effectiveFrom',
      'effectiveTo',
    ] as const) {
      if (body?.[key] !== undefined) {
        (patch as Record<string, unknown>)[key] = body[key];
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'no rule fields provided' },
        { status: 400 },
      );
    }
    const before = await getRosterRule(id);
    const rule = await updateRosterRule(id, patch, updatedBy);
    if (!rule) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    await writeAudit({
      agentType: 'system',
      action: 'rule_updated',
      approvedBy: updatedBy,
      notes: JSON.stringify({ id, before, after: rule, patch }),
    });
    return NextResponse.json({ success: true, rule });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const updatedBy = String(body?.updatedBy ?? 'admin-ui').trim() || 'admin-ui';
    const ok = await softDeleteRosterRule(id, updatedBy);
    if (!ok) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    await writeAudit({
      agentType: 'system',
      action: 'rule_deleted',
      approvedBy: updatedBy,
      notes: JSON.stringify({ id }),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
