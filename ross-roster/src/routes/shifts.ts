import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { assignWorker } from '../db/queries/assign';
import { listVacantShifts, mapVacantShift } from '../db/queries/shifts';
import { matchShift } from '../engine/matcher';

export const shiftsRouter = Router();

function horizonWindow(horizon: string): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (horizon === 'today') {
    end.setDate(end.getDate() + 2); // today + 48h window for emergency horizon
  } else if (horizon === 'next') {
    start.setDate(start.getDate() + 14);
    end.setDate(end.getDate() + 28);
  } else {
    // period — next 14 days
    end.setDate(end.getDate() + 14);
  }
  return { start, end };
}

shiftsRouter.get('/shifts/vacant', async (req, res) => {
  try {
    const horizon = String(req.query.horizon ?? 'today');
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { start, end } = horizonWindow(horizon);

    if (typeof req.query.period_start === 'string') {
      start.setTime(Date.parse(req.query.period_start));
    }
    if (typeof req.query.period_end === 'string') {
      end.setTime(Date.parse(req.query.period_end));
    }

    const rows = await listVacantShifts({ start, end, limit });
    const shifts = rows.map(mapVacantShift);
    const urgent = shifts.filter((s) => s.urgency === 'critical' || s.urgency === 'high').length;

    res.json({
      shifts,
      meta: {
        totalVacant: shifts.length,
        totalUrgent: urgent,
        period: {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
        },
        horizon,
      },
    });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

shiftsRouter.get('/shifts/vacant/:shiftId/matches', async (req, res) => {
  try {
    const shiftId = Number(req.params.shiftId);
    if (!Number.isFinite(shiftId)) {
      res.status(400).json({ error: 'invalid_shift_id' });
      return;
    }
    const result = await matchShift(shiftId);
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: 'match_failed', message: errorMessage(err) });
  }
});

shiftsRouter.post('/assign', async (req, res) => {
  try {
    const shiftId = Number(req.body?.shiftId);
    const workerId = Number(req.body?.workerId);
    const approvedBy = String(req.body?.approvedBy ?? '').trim();

    if (!Number.isFinite(shiftId) || !Number.isFinite(workerId) || !approvedBy) {
      res.status(400).json({
        error: 'invalid_body',
        message: 'shiftId, workerId, and approvedBy are required',
      });
      return;
    }

    if (req.body?.isOverride && !req.body?.overrideReason) {
      res.status(400).json({
        error: 'override_reason_required',
        message: 'overrideReason is required when isOverride=true',
      });
      return;
    }

    const result = await assignWorker({
      shiftId,
      workerId,
      approvedBy,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : null,
      isOverride: Boolean(req.body?.isOverride),
      overrideReason:
        typeof req.body?.overrideReason === 'string' ? req.body.overrideReason : null,
    });

    res.json(result);
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'shift_not_found' ? 404 : 503;
    res.status(status).json({ error: 'assign_failed', message });
  }
});
