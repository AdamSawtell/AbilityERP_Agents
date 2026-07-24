import { Router } from 'express';
import { errorMessage } from '../db/pool';
import {
  listLeaveReplacements,
  listPendingOverlaps,
} from '../services/leaveReplacer';
import { isSkillRunnable } from '../services/skills';
import { getLastLeaveCycle, runLeaveCycle } from '../worker/leave';

export const leaveRouter = Router();

leaveRouter.get('/leave', async (req, res) => {
  try {
    const status =
      typeof req.query.status === 'string' && req.query.status
        ? req.query.status
        : undefined;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const [replacements, pending, lastCycle] = await Promise.all([
      listLeaveReplacements(limit, status),
      listPendingOverlaps(30),
      Promise.resolve(getLastLeaveCycle()),
    ]);
    res.json({ replacements, pending, lastCycle });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

leaveRouter.get('/leave/pending', async (_req, res) => {
  try {
    const pending = await listPendingOverlaps(50);
    res.json({ pending, count: pending.length });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

leaveRouter.post('/leave/run', async (_req, res) => {
  try {
    const runnable = await isSkillRunnable('leave_replacer');
    if (!runnable) {
      res.status(409).json({
        error: 'skill_off',
        message: 'Leave Replacer is Off — turn On or Paused to run',
      });
      return;
    }
    const summary = await runLeaveCycle('manual');
    res.json({ success: true, summary });
  } catch (err) {
    const message = errorMessage(err);
    if (message.includes('busy')) {
      res.status(409).json({ error: 'busy', message });
      return;
    }
    res.status(503).json({ error: 'leave_run_failed', message });
  }
});
