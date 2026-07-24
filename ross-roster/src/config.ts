import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

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
  port: optionalInt('PORT', 3002),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  apiKey: required('ROSTER_BOT_API_KEY', 'dev-ross-api-key-change-me'),
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    host: required('DB_HOST', 'localhost'),
    port: optionalInt('DB_PORT', 5432),
    database: required('DB_NAME', 'idempiere'),
    user: required('DB_USER', 'adempiere'),
    password: process.env.DB_PASSWORD ?? '',
    schema: required('DB_SCHEMA', 'adempiere'),
    max: optionalInt('DB_POOL_MAX', 10),
  },
  defaults: {
    autoApproveThreshold: optionalInt('AUTO_APPROVE_THRESHOLD', 90),
    scanIntervalMinutes: optionalInt('SCAN_INTERVAL_MINUTES', 30),
    preShiftConfirmHours: optionalInt('PRE_SHIFT_CONFIRM_HOURS', 14),
    escalationHoursBeforeShift: optionalInt('ESCALATION_HOURS_BEFORE_SHIFT', 4),
  },
  openai: {
    apiKey: (process.env.OPENAI_API_KEY ?? '').trim(),
    model: (process.env.OPENAI_MODEL ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini',
  },
};

export const SERVICE_VERSION = '0.1.0';
export const startedAt = new Date();
