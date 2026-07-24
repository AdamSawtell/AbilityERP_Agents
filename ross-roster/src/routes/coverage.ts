import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { getCoverageHeatmap } from '../services/coverage';

export const coverageRouter = Router();

coverageRouter.get('/coverage', async (req, res) => {
  try {
    const horizon = String(req.query.horizon ?? 'period');
    const data = await getCoverageHeatmap(horizon);
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: 'coverage_failed', message: errorMessage(err) });
  }
});
