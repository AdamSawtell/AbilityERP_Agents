import { Router } from 'express';
import { errorMessage } from '../db/pool';
import { writeAudit } from '../services/audit';
import { getConfig, updateConfig, type ConfigPatch } from '../services/configStore';

export const configRouter = Router();

configRouter.get('/config', async (_req, res) => {
  try {
    const config = await getConfig();
    res.json({ config });
  } catch (err) {
    res.status(503).json({ error: 'db_unavailable', message: errorMessage(err) });
  }
});

configRouter.put('/config', async (req, res) => {
  try {
    const updatedBy = String(req.body?.updatedBy ?? '').trim();
    if (!updatedBy) {
      res.status(400).json({ error: 'invalid_body', message: 'updatedBy required' });
      return;
    }

    const patch: ConfigPatch = {};
    const keys: (keyof ConfigPatch)[] = [
      'auto_approve_threshold',
      'scan_interval_minutes',
      'pre_shift_confirm_hours',
      'escalation_hours_before_shift',
      'max_safe_matches_per_scan',
      'employee_no_auto_approve',
      'auto_assign_enabled',
    ];
    for (const key of keys) {
      if (req.body?.[key] !== undefined) {
        (patch as Record<string, unknown>)[key] = req.body[key];
      }
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'invalid_body', message: 'no config fields provided' });
      return;
    }

    const before = await getConfig();
    const config = await updateConfig(patch, updatedBy);
    await writeAudit({
      agentType: 'system',
      action: 'config_updated',
      approvedBy: updatedBy,
      notes: JSON.stringify({ before, after: config, patch }),
    });

    res.json({ success: true, config });
  } catch (err) {
    res.status(503).json({ error: 'config_update_failed', message: errorMessage(err) });
  }
});
