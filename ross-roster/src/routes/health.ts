import { Router } from 'express';
import { env, SERVICE_VERSION, startedAt } from '../config';
import { testConnection } from '../db/pool';
import { getConfig } from '../services/configStore';
import { getLastScanTimestamps } from '../services/audit';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const db = await testConnection();
  let config = null;
  let lastScan = { emergency: null as string | null, planner: null as string | null };

  if (db.ok) {
    config = await getConfig();
    try {
      lastScan = await getLastScanTimestamps();
    } catch {
      // tables may not exist until migrate
    }
  }

  const uptimeSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);

  res.status(db.ok ? 200 : 503).json({
    status: db.ok ? 'ok' : 'degraded',
    uptime: uptimeSeconds,
    version: SERVICE_VERSION,
    service: 'ross-roster',
    ticket: 'SAW042',
    lastScan,
    config: config
      ? {
          auto_approve_threshold: config.auto_approve_threshold,
          scan_interval_minutes: config.scan_interval_minutes,
        }
      : {
          auto_approve_threshold: env.defaults.autoApproveThreshold,
          scan_interval_minutes: env.defaults.scanIntervalMinutes,
        },
    db: db.ok ? { ok: true } : { ok: false, error: db.error },
  });
});
