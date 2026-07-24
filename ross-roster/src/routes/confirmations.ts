import { Router } from 'express';
import { errorMessage } from '../db/pool';
import {
  applyManualResponse,
  listConfirmations,
} from '../services/confirmations';
import { getLastConfirmCycle, runConfirmCycle } from '../worker/confirm';

export const confirmationsRouter = Router();

confirmationsRouter.get('/confirmations', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await listConfirmations({ status, limit });
    res.json({
      confirmations: rows.map((r) => ({
        id: Number(r.id),
        shiftId: Number(r.shift_id),
        shiftName: r.shift_name,
        workerId: Number(r.worker_id),
        workerName: r.worker_name,
        staffLineId: r.staff_line_id != null ? Number(r.staff_line_id) : null,
        status: r.status,
        requestedAt: r.requested_at,
        respondedAt: r.responded_at,
        escalatedAt: r.escalated_at,
        shiftStart: r.shift_start,
        notes: r.notes,
      })),
      lastCycle: getLastConfirmCycle(),
    });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

confirmationsRouter.post('/confirmations/run', async (_req, res) => {
  try {
    const summary = await runConfirmCycle('manual');
    res.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'confirm_cycle_busy' ? 409 : 503;
    res.status(status).json({ error: 'confirm_run_failed', message });
  }
});

confirmationsRouter.post('/confirmations/:id/respond', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const response = String(req.body?.response ?? '').toLowerCase();
    const by = String(req.body?.respondedBy ?? req.body?.approvedBy ?? '').trim();
    if (!Number.isFinite(id) || !by) {
      res.status(400).json({ error: 'invalid_body', message: 'respondedBy required' });
      return;
    }
    if (response !== 'confirmed' && response !== 'declined') {
      res.status(400).json({
        error: 'invalid_body',
        message: "response must be 'confirmed' or 'declined'",
      });
      return;
    }

    const marked = await applyManualResponse(id, response, by);
    if (!marked) {
      res.status(404).json({ error: 'not_found_or_not_open' });
      return;
    }
    res.json({
      success: true,
      confirmation: {
        id: Number(marked.id),
        status: marked.status,
        workerId: Number(marked.worker_id),
        shiftId: Number(marked.shift_id),
      },
    });
  } catch (err) {
    res.status(503).json({ error: 'respond_failed', message: errorMessage(err) });
  }
});
