import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { writeAudit } from '@/lib/services/audit';
import { resolveGap } from '@/lib/services/gaps';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const { id: raw } = await context.params;
    const id = Number(raw);
    const body = await request.json().catch(() => ({}));
    const resolvedBy = String(body?.resolvedBy ?? body?.requestedBy ?? '').trim();
    if (!Number.isFinite(id) || !resolvedBy) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'resolvedBy required' },
        { status: 400 },
      );
    }
    const notes =
      typeof body?.resolutionNotes === 'string'
        ? body.resolutionNotes
        : typeof body?.notes === 'string'
          ? body.notes
          : `Resolved by ${resolvedBy}`;
    const gap = await resolveGap(id, notes);
    if (!gap) {
      return NextResponse.json({ error: 'not_found_or_already_resolved' }, { status: 404 });
    }
    await writeAudit({
      agentType: 'system',
      action: 'gap_logged',
      shiftId: gap.shift_id != null ? Number(gap.shift_id) : null,
      notes: `gap #${id} resolved: ${notes}`,
      approvedBy: resolvedBy,
    });
    return NextResponse.json({
      success: true,
      gap: {
        id: Number(gap.id),
        resolved: true,
        resolution_notes: gap.resolution_notes,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
