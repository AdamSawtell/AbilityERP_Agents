import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { getShiftDetail, getWorkerProfile } from '../db/queries/profiles';

export const profilesRouter = Router();

profilesRouter.get('/worker/:workerId/profile', async (req, res) => {
  try {
    const workerId = Number(req.params.workerId);
    if (!Number.isFinite(workerId)) {
      res.status(400).json({ error: 'invalid_worker_id' });
      return;
    }
    const profile = await getWorkerProfile(workerId);
    if (!profile) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ profile });
  } catch (err) {
    res.status(503).json({ error: 'profile_failed', message: errorMessage(err) });
  }
});

profilesRouter.get('/shifts/:shiftId', async (req, res) => {
  try {
    const shiftId = Number(req.params.shiftId);
    if (!Number.isFinite(shiftId)) {
      res.status(400).json({ error: 'invalid_shift_id' });
      return;
    }
    const shift = await getShiftDetail(shiftId);
    if (!shift) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ shift });
  } catch (err) {
    res.status(503).json({ error: 'shift_detail_failed', message: errorMessage(err) });
  }
});
