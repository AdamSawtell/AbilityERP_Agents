import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { buildPlannerBriefing } from '../services/planner';
import {
  getLastBriefing,
  getLastPlannerCycle,
  runPlannerCycle,
} from '../worker/planner';

export const plannerRouter = Router();

plannerRouter.get('/planner/briefing', async (_req, res) => {
  try {
    const cached = getLastBriefing();
    const briefing = cached ?? (await buildPlannerBriefing());
    res.json({
      briefing,
      cached: Boolean(cached),
      lastCycle: getLastPlannerCycle(),
    });
  } catch (err) {
    res.status(503).json({ error: 'briefing_failed', message: errorMessage(err) });
  }
});

plannerRouter.post('/planner/run', async (_req, res) => {
  try {
    const { summary, briefing } = await runPlannerCycle('manual');
    res.json({ success: true, summary, briefing });
  } catch (err) {
    const message = errorMessage(err);
    const status = message === 'planner_cycle_busy' ? 409 : 503;
    res.status(status).json({ error: 'planner_run_failed', message });
  }
});
