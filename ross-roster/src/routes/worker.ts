import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { getLastEmergencyScan, runEmergencyScan } from '../worker/emergency';
import { listPendingProposals } from '../services/proposals';

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
