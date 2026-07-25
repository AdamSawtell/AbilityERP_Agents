import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';
import { assignWorker } from '@/lib/db/queries/assign';
import { writeAudit } from '@/lib/services/audit';
import {
  expireSiblingProposals,
  getProposal,
  markProposalStatus,
} from '@/lib/services/proposals';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Ctx) {
  try {
    const { id: raw } = await context.params;
    const id = Number(raw);
    const body = await request.json().catch(() => ({}));
    const approvedBy = String(body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !approvedBy) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'approvedBy required' },
        { status: 400 },
      );
    }

    const proposal = await getProposal(id);
    if (!proposal) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (proposal.status !== 'pending') {
      return NextResponse.json(
        { error: 'not_pending', status: proposal.status },
        { status: 409 },
      );
    }

    const marked = await markProposalStatus({
      id,
      status: 'approved',
      reviewedBy: approvedBy,
      notes: typeof body?.notes === 'string' ? body.notes : null,
    });
    if (!marked) {
      return NextResponse.json({ error: 'not_pending' }, { status: 409 });
    }

    const assignResult = await assignWorker({
      shiftId: Number(proposal.shift_id),
      workerId: Number(proposal.worker_id),
      approvedBy,
      notes: typeof body?.notes === 'string' ? body.notes : `Approved proposal #${id}`,
      notifyWorker: body?.notifyWorker !== false,
    });

    await writeAudit({
      agentType: 'emergency',
      action: 'match_approved',
      shiftId: Number(proposal.shift_id),
      workerId: Number(proposal.worker_id),
      score: Number(proposal.score),
      approvedBy,
      notes: `proposal #${id}`,
    });

    await expireSiblingProposals(Number(proposal.shift_id), id);

    return NextResponse.json({ proposalId: id, ...assignResult });
  } catch (err) {
    return NextResponse.json(
      { error: 'approve_failed', message: errorMessage(err) },
      { status: 503 },
    );
  }
}
