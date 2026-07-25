import { NextResponse } from 'next/server';
import { env, SERVICE_VERSION, startedAt } from '@/lib/config';
import { testConnection, errorMessage } from '@/lib/db/pool';
import { getConfig } from '@/lib/services/configStore';
import { getLastScanTimestamps } from '@/lib/services/audit';
import { getLastEmergencyScan } from '@/lib/worker/emergency';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await testConnection();
    let config = null;
    let lastScan = { emergency: null as string | null, planner: null as string | null };
    const memoryScan = getLastEmergencyScan();

    if (db.ok) {
      config = await getConfig();
      try {
        lastScan = await getLastScanTimestamps();
      } catch {
        /* tables may not exist */
      }
    }

    if (!lastScan.emergency && memoryScan?.finishedAt) {
      lastScan.emergency = memoryScan.finishedAt;
    }

    const uptimeSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000);

    return NextResponse.json(
      {
        status: db.ok ? 'ok' : 'degraded',
        uptime: uptimeSeconds,
        version: SERVICE_VERSION,
        service: 'ross-admin',
        ticket: 'SAW048',
        ai: {
          enabled: Boolean(env.openai.apiKey),
          provider: 'openai',
          model: env.openai.model,
        },
        lastScan,
        lastEmergencySummary: memoryScan,
        config: config
          ? {
              auto_approve_threshold: config.auto_approve_threshold,
              scan_interval_minutes: config.scan_interval_minutes,
              auto_assign_enabled: config.auto_assign_enabled,
            }
          : {
              auto_approve_threshold: env.defaults.autoApproveThreshold,
              scan_interval_minutes: env.defaults.scanIntervalMinutes,
              auto_assign_enabled: false,
            },
        db: db.ok ? { ok: true } : { ok: false, error: db.error },
      },
      { status: db.ok ? 200 : 503 },
    );
  } catch (err) {
    return NextResponse.json(
      { status: 'down', error: errorMessage(err) },
      { status: 503 },
    );
  }
}
