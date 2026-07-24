import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { loadShiftContext } from '../db/queries/shifts';
import {
  buildAssignmentMessage,
  resolveWorkerUserId,
  sendPathwaysMessage,
} from '../pathways';

export const pathwaysRouter = Router();

/** Manual Pathways send — useful for smoke tests without assigning. */
pathwaysRouter.post('/pathways/send', async (req, res) => {
  try {
    const workerId = Number(req.body?.workerId);
    const shiftId = Number(req.body?.shiftId);
    const adClientId = Number(req.body?.adClientId ?? 1000002);
    let message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!Number.isFinite(workerId) || !Number.isFinite(shiftId)) {
      res.status(400).json({ error: 'invalid_body', message: 'workerId and shiftId required' });
      return;
    }

    const workerAdUserId = await resolveWorkerUserId(workerId);
    if (workerAdUserId == null) {
      res.status(404).json({ error: 'worker_user_not_found' });
      return;
    }

    if (!message) {
      const ctx = await loadShiftContext(shiftId);
      const nameRes = await resolveWorkerUserId(workerId);
      void nameRes;
      message = await buildAssignmentMessage({
        workerName: String(req.body?.workerName ?? `Worker ${workerId}`),
        shiftName: ctx?.name ?? `Shift ${shiftId}`,
        startTs: ctx?.startTs ?? new Date(),
        endTs: ctx?.endTs ?? new Date(),
        locationName: ctx?.locationName ?? null,
      });
    }

    const result = await sendPathwaysMessage({
      workerAdUserId,
      workerBPartnerId: workerId,
      shiftId,
      message,
      adClientId,
    });

    res.json({ success: result.sent, ...result });
  } catch (err) {
    res.status(503).json({ error: 'pathways_failed', message: errorMessage(err) });
  }
});
