import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { writeAudit } from '@/lib/services/audit';
import { markProposalStatus } from '@/lib/services/proposals';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const { id: raw } = await context.params;
    const id = Number(raw);
    const body = await request.json().catch(() => ({}));
    const rejectedBy = String(body?.rejectedBy ?? body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !rejectedBy) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'rejectedBy required' },
        { status: 400 },
      );
    }

    const reason = typeof body?.reason === 'string' ? body.reason : null;
    const marked = await markProposalStatus({
      id,
      status: 'rejected',
      reviewedBy: rejectedBy,
      notes: reason,
    });
    if (!marked) {
      return NextResponse.json({ error: 'not_found_or_not_pending' }, { status: 404 });
    }

    await writeAudit({
      agentType: 'emergency',
      action: 'match_rejected',
      shiftId: Number(marked.shift_id),
      workerId: Number(marked.worker_id),
      score: Number(marked.score),
      approvedBy: rejectedBy,
      notes: reason ?? `proposal #${id} rejected`,
    });

    return NextResponse.json({ success: true, proposalId: id, status: 'rejected' });
  } catch (err) {
    return NextResponse.json(
      { error: 'reject_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
