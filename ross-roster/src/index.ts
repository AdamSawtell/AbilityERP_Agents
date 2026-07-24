import cors from 'cors';
import express from 'express';
import { env, SERVICE_VERSION } from './config';
import { pool, testConnection } from './db/pool';
import { apiKeyAuth } from './middleware/auth';
import { auditRouter } from './routes/audit';
import { configRouter } from './routes/config';
import { confirmationsRouter } from './routes/confirmations';
import { gapsRouter } from './routes/gaps';
import { healthRouter } from './routes/health';
import { pathwaysRouter } from './routes/pathways';
import { profilesRouter } from './routes/profiles';
import { shiftsRouter } from './routes/shifts';
import { workerRouter } from './routes/worker';
import { writeAudit } from './services/audit';
import { startConfirmCron, stopConfirmCron } from './worker/confirm';
import { startEmergencyCron, stopEmergencyCron } from './worker/emergency';

async function main(): Promise<void> {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigins.length > 0 ? env.corsOrigins : true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // Health is public so nginx / ops can probe without a key.
  app.use(healthRouter);

  app.use(
    '/api/v1',
    apiKeyAuth,
    shiftsRouter,
    workerRouter,
    pathwaysRouter,
    auditRouter,
    gapsRouter,
    configRouter,
    profilesRouter,
    confirmationsRouter,
  );

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error('[ross] unhandled route error', err);
      res.status(500).json({ error: 'internal_error' });
    },
  );

  const db = await testConnection();
  if (!db.ok) {
    console.warn(`[ross] DB not reachable at startup: ${db.error}`);
    console.warn('[ross] service will start degraded — run npm run migrate when DB is available');
  } else {
    console.log(`[ross] DB connected (${env.db.host}:${env.db.port}/${env.db.database})`);
    try {
      await writeAudit({
        agentType: 'system',
        action: 'system_startup',
        notes: `ross-roster ${SERVICE_VERSION} listening on :${env.port}`,
      });
    } catch (err) {
      console.warn('[ross] could not write startup audit (migrate first?)', err);
    }
    startEmergencyCron();
    startConfirmCron();
  }

  const server = app.listen(env.port, () => {
    console.log(`[ross] ross-roster ${SERVICE_VERSION} on :${env.port} (SAW044 Phase 3)`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[ross] ${signal} — shutting down`);
    stopEmergencyCron();
    stopConfirmCron();
    server.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[ross] fatal startup error', err);
  process.exit(1);
});
