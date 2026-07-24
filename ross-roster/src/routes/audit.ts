import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { listAudit } from '../services/audit';

export const auditRouter = Router();

auditRouter.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const rows = await listAudit(limit, offset);
    res.json({ entries: rows, limit, offset });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});
