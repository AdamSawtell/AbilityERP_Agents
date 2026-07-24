import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { listGaps, markTrainingRequested } from '../services/gaps';
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
    res.json({ gaps: rows, limit, offset });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

gapsRouter.post('/gaps/:id/training-request', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }

    const notes =
      typeof req.body?.notes === 'string'
        ? req.body.notes
        : typeof req.body?.requestedBy === 'string'
          ? `Requested by ${req.body.requestedBy}`
          : undefined;

    const gap = await markTrainingRequested(id, notes);
    if (!gap) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    await writeAudit({
      agentType: 'system',
      action: 'training_requested',
      shiftId: gap.shift_id != null ? Number(gap.shift_id) : null,
      notes: notes ?? null,
      approvedBy: typeof req.body?.requestedBy === 'string' ? req.body.requestedBy : null,
    });

    res.json({ success: true, gap });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});
