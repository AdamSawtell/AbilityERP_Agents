import { Router } from 'express';
import { errorMessage } from '../db/pool';
import {
  listGaps,
  listTrainingGapSummaries,
  requestTraining,
  resolveGap,
} from '../services/gaps';
import { writeAudit } from '../services/audit';

export const gapsRouter = Router();

gapsRouter.get('/gaps', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    let resolved: boolean | undefined;
    if (req.query.resolved === 'true') resolved = true;
    if (req.query.resolved === 'false') resolved = false;

    const rows = await listGaps(resolved, limit, offset);
    res.json({
      gaps: rows.map((g) => ({
        id: Number(g.id),
        detected_at: g.detected_at,
        shift_id: g.shift_id != null ? Number(g.shift_id) : null,
        shift_name: g.shift_name,
        shift_date: g.shift_date,
        shift_time: g.shift_time,
        reason: g.reason,
        credential_id: g.credential_id != null ? Number(g.credential_id) : null,
        credential_name: g.credential_name,
        blocked_count: g.blocked_count != null ? Number(g.blocked_count) : null,
        resolved: Boolean(g.resolved),
        training_requested: Boolean(g.training_requested),
        escalation_level: g.escalation_level,
        resolution_notes: g.resolution_notes,
      })),
      limit,
      offset,
    });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

gapsRouter.get('/gaps/training-summary', async (_req, res) => {
  try {
    const summaries = await listTrainingGapSummaries();
    res.json({ summaries });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

gapsRouter.post('/gaps/:id/training-request', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const requestedBy = String(req.body?.requestedBy ?? '').trim();
    if (!Number.isFinite(id) || !requestedBy) {
      res.status(400).json({
        error: 'invalid_body',
        message: 'requestedBy required',
      });
      return;
    }

    const result = await requestTraining({
      gapId: id,
      requestedBy,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
      bulkSameCredential: Boolean(req.body?.bulkSameCredential),
    });

    if (result.gaps.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    await writeAudit({
      agentType: 'system',
      action: 'training_requested',
      shiftId: result.gaps[0].shift_id != null ? Number(result.gaps[0].shift_id) : null,
      notes: `${result.gaps.length} gap(s); Pathways=${result.pathwaysSent}; ${result.pathwaysMessage.slice(0, 120)}`,
      approvedBy: requestedBy,
    });

    res.json({
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
    res.status(503).json({ error: 'training_request_failed', message: errorMessage(err) });
  }
});

gapsRouter.post('/gaps/:id/resolve', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const resolvedBy = String(req.body?.resolvedBy ?? req.body?.requestedBy ?? '').trim();
    if (!Number.isFinite(id) || !resolvedBy) {
      res.status(400).json({ error: 'invalid_body', message: 'resolvedBy required' });
      return;
    }

    const notes =
      typeof req.body?.resolutionNotes === 'string'
        ? req.body.resolutionNotes
        : typeof req.body?.notes === 'string'
          ? req.body.notes
          : `Resolved by ${resolvedBy}`;

    const gap = await resolveGap(id, notes);
    if (!gap) {
      res.status(404).json({ error: 'not_found_or_already_resolved' });
      return;
    }

    await writeAudit({
      agentType: 'system',
      action: 'gap_logged',
      shiftId: gap.shift_id != null ? Number(gap.shift_id) : null,
      notes: `gap #${id} resolved: ${notes}`,
      approvedBy: resolvedBy,
    });

    res.json({
      success: true,
      gap: {
        id: Number(gap.id),
        resolved: true,
        resolution_notes: gap.resolution_notes,
      },
    });
  } catch (err) {
    res.status(503).json({ error: 'resolve_failed', message: errorMessage(err) });
  }
});
