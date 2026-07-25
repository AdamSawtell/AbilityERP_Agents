/**
 * Ross runtime env (Amplify / Next.js). DB pool settings live in lib/db/config.ts.
 */
function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Env var ${name} must be a number`);
  }
  return n;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  apiKey: (process.env.ROSS_API_KEY || process.env.ROSTER_BOT_API_KEY || '').trim(),
  cronSecret: (process.env.CRON_SECRET || '').trim(),
  openai: {
    apiKey: (process.env.OPENAI_API_KEY ?? '').trim(),
    model: (process.env.OPENAI_MODEL ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini',
  },
  defaults: {
    autoApproveThreshold: optionalInt('AUTO_APPROVE_THRESHOLD', 90),
    scanIntervalMinutes: optionalInt('SCAN_INTERVAL_MINUTES', 30),
    preShiftConfirmHours: optionalInt('PRE_SHIFT_CONFIRM_HOURS', 14),
    escalationHoursBeforeShift: optionalInt('ESCALATION_HOURS_BEFORE_SHIFT', 4),
  },
};

export const SERVICE_VERSION = '0.2.0';
export const startedAt = new Date();
