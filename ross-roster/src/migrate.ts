import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { env } from './config';
import { pool } from './db/pool';

async function migrate(): Promise<void> {
  if (!env.db.password && env.nodeEnv === 'production') {
    throw new Error('DB_PASSWORD is required in production');
  }

  const dir = join(__dirname, '..', 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`[ross] migrating ${files.length} file(s) against ${env.db.host}/${env.db.database}`);

  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      console.log(`[ross] applying ${file}`);
      await client.query(sql);
    }
    console.log('[ross] migrations complete');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('[ross] migration failed', err);
  process.exit(1);
});
