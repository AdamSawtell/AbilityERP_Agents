import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/db/pool';
import { assignWorker } from '@/lib/db/queries/assign';
import { writeAudit } from '@/lib/services/audit';
import { getConfig } from '@/lib/services/configStore';
import {
  expireSiblingProposals,
  listBulkApproveTargets,
  markProposalStatus,
} from '@/lib/services/proposals';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const approvedBy = String(body?.approvedBy ?? '').trim();
    if (!approvedBy) {
      return NextResponse.json(
        { error: 'invalid_body', message: 'approvedBy required' },
        { status: 400 },
      );
    }
    const config = await getConfig();
    const minScore = Number.isFinite(Number(body?.minScore))
      ? Number(body.minScore)
      : config.auto_approve_threshold;
    const targets = await listBulkApproveTargets(minScore, 50);
    const results: {
      proposalId: number;
      success: boolean;
      error?: string;
      assignmentId?: number;
      pathwaysMessageSent?: boolean;
    }[] = [];

    for (const proposal of targets) {
      try {
        const marked = await markProposalStatus({
          id: proposal.id,
          status: 'approved',
          reviewedBy: approvedBy,
          notes: `Bulk approve (score ${proposal.score} ≥ ${minScore})`,
        });
        if (!marked) {
          results.push({ proposalId: proposal.id, success: false, error: 'not_pending' });
          continue;
        }
        const assignResult = await assignWorker({
          shiftId: proposal.shiftId,
          workerId: proposal.workerId,
          approvedBy,
          notes: `Bulk approved proposal #${proposal.id}`,
          notifyWorker: body?.notifyWorker !== false,
        });
        await writeAudit({
          agentType: 'emergency',
          action: 'match_approved',
          shiftId: proposal.shiftId,
          workerId: proposal.workerId,
          score: proposal.score,
          approvedBy,
          notes: `bulk proposal #${proposal.id}`,
        });
        await expireSiblingProposals(proposal.shiftId, proposal.id);
        results.push({
          proposalId: proposal.id,
          success: true,
          assignmentId: assignResult.assignmentId,
          pathwaysMessageSent: assignResult.pathwaysMessageSent,
        });
      } catch (err) {
        results.push({
          proposalId: proposal.id,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return NextResponse.json({
      success: true,
      minScore,
      attempted: targets.length,
      approved: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 502 });
  }
}
