import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { assignWorker } from '../db/queries/assign';
import { writeAudit } from '../services/audit';
import {
  getProposal,
  listPendingProposals,
  markProposalStatus,
} from '../services/proposals';
import { getLastEmergencyScan, runEmergencyScan } from '../worker/emergency';

export const workerRouter = Router();

workerRouter.post('/worker/run', async (_req, res) => {
  try {
    const summary = await runEmergencyScan('manual');
    res.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'scan_already_running' ? 409 : 503;
    res.status(status).json({ error: message === 'scan_already_running' ? 'busy' : 'scan_failed', message });
  }
});

workerRouter.get('/worker/last-scan', (_req, res) => {
  res.json({ lastScan: getLastEmergencyScan() });
});

workerRouter.get('/proposals/pending', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const payload = await listPendingProposals(limit, offset);
    res.json(payload);
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

workerRouter.post('/proposals/:id/approve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const approvedBy = String(req.body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !approvedBy) {
      res.status(400).json({ error: 'invalid_body', message: 'approvedBy required' });
      return;
    }

    const proposal = await getProposal(id);
    if (!proposal) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (proposal.status !== 'pending') {
      res.status(409).json({ error: 'not_pending', status: proposal.status });
      return;
    }

    const marked = await markProposalStatus({
      id,
      status: 'approved',
      reviewedBy: approvedBy,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : null,
    });
    if (!marked) {
      res.status(409).json({ error: 'not_pending' });
      return;
    }

    const assignResult = await assignWorker({
      shiftId: Number(proposal.shift_id),
      workerId: Number(proposal.worker_id),
      approvedBy,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : `Approved proposal #${id}`,
      notifyWorker: req.body?.notifyWorker !== false,
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

    res.json({ proposalId: id, ...assignResult });
  } catch (err) {
    res.status(503).json({ error: 'approve_failed', message: errorMessage(err) });
  }
});

workerRouter.post('/proposals/:id/reject', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rejectedBy = String(req.body?.rejectedBy ?? req.body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !rejectedBy) {
      res.status(400).json({ error: 'invalid_body', message: 'rejectedBy required' });
      return;
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
    const marked = await markProposalStatus({
      id,
      status: 'rejected',
      reviewedBy: rejectedBy,
      notes: reason,
    });
    if (!marked) {
      res.status(404).json({ error: 'not_found_or_not_pending' });
      return;
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

    res.json({ success: true, proposalId: id, status: 'rejected' });
  } catch (err) {
    res.status(503).json({ error: 'reject_failed', message: errorMessage(err) });
  }
});
