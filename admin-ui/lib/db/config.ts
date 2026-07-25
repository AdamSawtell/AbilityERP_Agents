/**
 * Remote PG pool config for Amplify → EC2 Postgres.
 * EC2 is DB-only; Amplify runs all agent compute.
 */
export type DbPoolConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: false | { rejectUnauthorized: boolean };
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getDbPoolConfig(): DbPoolConfig {
  const sslEnv = (process.env.DB_SSL ?? '').trim().toLowerCase();
  const useSsl = sslEnv === 'true' || sslEnv === '1' || sslEnv === 'require';

  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: optionalInt('DB_PORT', 5432),
    database: process.env.DB_NAME || 'idempiere',
    user: process.env.DB_USER || 'ross_agent',
    password: process.env.DB_PASSWORD ?? '',
    ssl: useSsl ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    max: optionalInt('DB_POOL_MAX', 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}
