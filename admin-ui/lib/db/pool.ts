import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { getDbPoolConfig } from './config';

const cfg = getDbPoolConfig();

export const pool = new Pool({
  host: cfg.host,
  port: cfg.port,
  database: cfg.database,
  user: cfg.user,
  password: cfg.password,
  ssl: cfg.ssl,
  max: cfg.max,
  idleTimeoutMillis: cfg.idleTimeoutMillis,
  connectionTimeoutMillis: cfg.connectionTimeoutMillis,
});

pool.on('error', (err) => {
  console.error('[ross] unexpected PG pool error', err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { errors?: Error[]; code?: string };
    if (Array.isArray(anyErr.errors) && anyErr.errors.length > 0) {
      return anyErr.errors.map((e) => e.message).join('; ') || err.message;
    }
    return err.message || anyErr.code || 'unknown error';
  }
  return String(err);
}

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    await pool.query('SELECT 1 AS ok');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
