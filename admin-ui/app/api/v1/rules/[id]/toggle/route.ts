import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { toggleRosterRule } from '@/lib/services/rosterRulesStore';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const updatedBy = String(body?.updatedBy ?? 'api').trim() || 'api';
    const rule = await toggleRosterRule(id, updatedBy);
    if (!rule) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, rule });
  } catch (err) {
    return NextResponse.json(
      { error: 'rules_write_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
