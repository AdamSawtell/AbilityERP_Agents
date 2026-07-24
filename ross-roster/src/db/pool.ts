import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config';

export const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  max: env.db.max,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
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
