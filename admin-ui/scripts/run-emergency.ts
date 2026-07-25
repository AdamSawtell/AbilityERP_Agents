/**
 * EventBridge / Amplify scheduled runner — run-emergency
 * Usage: BASE_URL=https://... CRON_SECRET=... npx tsx scripts/run-emergency.ts
 */
const base = (process.env.BASE_URL || process.env.ROSS_BASE_URL || '').replace(/\/$/, '');
const secret = process.env.CRON_SECRET || '';

if (!base) {
  console.error('[ross] BASE_URL (or ROSS_BASE_URL) is required');
  process.exit(1);
}
if (!secret) {
  console.error('[ross] CRON_SECRET is required');
  process.exit(1);
}

const url = `${base}/api/v1/worker/run`;

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'x-ross-cron': secret,
    'Content-Type': 'application/json',
  },
});

const text = await res.text();
let body: unknown = text;
try {
  body = JSON.parse(text);
} catch {
  /* keep text */
}

if (!res.ok) {
  console.error(`[ross] run-emergency failed ${res.status}`, body);
  process.exit(1);
}

console.log(`[ross] run-emergency ok`, body);
