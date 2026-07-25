import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { writeAudit } from '@/lib/services/audit';
import { requestTraining } from '@/lib/services/gaps';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const { id: raw } = await context.params;
    const id = Number(raw);
    const body = await request.json().catch(() => ({}));
    const requestedBy = String(body?.requestedBy ?? '').trim();
    if (!Number.isFinite(id) || !requestedBy) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'requestedBy required' },
        { status: 400 },
      );
    }
    const result = await requestTraining({
      gapId: id,
      requestedBy,
      notes: typeof body?.notes === 'string' ? body.notes : undefined,
      bulkSameCredential: Boolean(body?.bulkSameCredential),
    });
    if (result.gaps.length === 0) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    await writeAudit({
      agentType: 'system',
      action: 'training_requested',
      shiftId: result.gaps[0].shift_id != null ? Number(result.gaps[0].shift_id) : null,
      notes: `${result.gaps.length} gap(s); Pathways=${result.pathwaysSent}; ${result.pathwaysMessage.slice(0, 120)}`,
      approvedBy: requestedBy,
    });
    return NextResponse.json({
      success: true,
      updatedCount: result.gaps.length,
      pathwaysSent: result.pathwaysSent,
      gaps: result.gaps.map((g) => ({
        id: Number(g.id),
        training_requested: Boolean(g.training_requested),
        credential_name: g.credential_name,
        reason: g.reason,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
