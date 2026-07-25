---
migration: ross-to-amplify
status: cutover-complete
ticket: SAW048
from: "EC2-hosted Express + Next.js (SAW042–047)"
to: "Standalone Amplify Next.js app — all config self-contained"
principle: "EC2 is the operational DB only. Zero agent compute on the ERP server."
cutover: "2026-07-26 — PM2 ross-roster + ross-admin stopped (saved dump); ability-erp-api left online; Amplify ross-admin primary"
---

# Ross → Amplify Migration (SAW048)

## Why

Ross' Express API and cron workers run on the iDempiere EC2 alongside the ERP. Every future agent would repeat SSH + PM2 + port contention. This breaks that pattern — Ross becomes the first standalone Amplify agent that happens to read/write iDempiere PG remotely.

**EC2 becomes database-only.** All agent compute (API + UI + cron) lives in Amplify.

## Target Architecture

```
                    AWS Amplify
┌─────────────────────────────────────────────────────┐
│  Next.js App (admin-ui/)                             │
│                                                      │
│  app/api/v1/...   — 25 route handler files            │
│  lib/              —  shared code (engine/services/db) │
│  middleware.ts     —  API key auth                     │
│  scripts/          —  cron wrappers for EventBridge    │
└────────────────────────┬────────────────────────────┘
                         │ SSL
                         ▼
┌──────────────────────────────────────────────────────┐
│  EC2 (54.206.8.250)                                  │
│  iDempiere :5444   ← untouched                        │
│  PostgreSQL :5432  ← ross_agent user, firewalled      │
└──────────────────────────────────────────────────────┘
```

## What moves (no rewrite)

| From (ross-roster/src/) | To (admin-ui/lib/) | Change |
|---|---|---|
| `db/config.ts` | `lib/db/config.ts` | Pool → remote host + SSL + ross_agent user |
| `db/pool.ts` | `lib/db/pool.ts` | Same (reads config) |
| `engine/matcher.ts` | `lib/engine/matcher.ts` | None |
| `engine/types.ts` | `lib/engine/types.ts` | None |
| `services/*.ts` (12 files) | `lib/services/*.ts` | None |
| `middleware/auth.ts` | `lib/middleware/auth.ts` | None (used by cron scripts) |
| `pathways.ts` | `lib/pathways.ts` | None |

## What rewrites

### Express routes → Next.js API routes

Each Express handler becomes a file under `admin-ui/app/api/v1/.../route.ts`. Pattern:

```typescript
// Express-style (delete)
router.get('/shifts/vacant', async (req, res) => {
  const rows = await getVacantShifts(pool)
  res.json(rows)
})

// Next.js App Router (create)
// app/api/v1/shifts/vacant/route.ts
import { NextResponse } from 'next/server'
import { getVacantShifts } from '@/lib/services/vacantShifts'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await getVacantShifts()
  return NextResponse.json(rows)
}
```

Full route map in [Obsidian reference] or inline at the bottom of this doc.

### Express middleware → Next.js Edge Middleware

```typescript
// admin-ui/middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  if (request.headers.get('x-ross-cron') === process.env.CRON_SECRET) return NextResponse.next()
  const key = request.headers.get('authorization')?.replace('Bearer ', '')
  if (key !== process.env.ROSS_API_KEY) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.next()
}

export const config = { matcher: '/api/:path*' }
```

### Cron workers → EventBridge Scheduler + scripts

Remove `setInterval` / `node-cron` from codebase. Create three scripts in `admin-ui/scripts/`:

```typescript
// scripts/run-emergency.ts — triggered by EventBridge every 30min
await fetch(`${BASE_URL}/api/v1/worker/run`, {
  headers: { 'x-ross-cron': process.env.CRON_SECRET! }
})

// scripts/run-planner.ts — triggered daily 2am AEST
await fetch(`${BASE_URL}/api/v1/planner/run`, { headers })

// scripts/run-leave.ts — triggered hourly
await fetch(`${BASE_URL}/api/v1/leave/run`, { headers })
```

Deployed as **Amplify scheduled functions** in the same app.

### DB pool config

```typescript
// lib/db/config.ts
pool = new Pool({
  host: process.env.DB_HOST,               // EC2 private IP
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'idempiere',
  user: process.env.DB_USER || 'ross_agent',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  max: 5,
})
```

## What's new (one-time EC2 setup)

### 1. PG user
```sql
CREATE USER ross_agent WITH PASSWORD '<password>';
GRANT USAGE ON SCHEMA adempiere TO ross_agent;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA adempiere TO ross_agent;
ALTER DEFAULT PRIVILEGES IN SCHEMA adempiere GRANT SELECT, INSERT, UPDATE ON TABLES TO ross_agent;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA adempiere TO ross_agent;
```

### 2. pg_hba.conf
```
hostssl adempiere ross_agent <amplify-nat-cidr> md5
```

### 3. Security group
Allow inbound TCP 5432 from Amplify NAT IPs only.

## Amplify config

### Environment variables
```
ROSS_API_KEY=<uuid>
CRON_SECRET=<uuid>
DB_HOST=<ec2-private-ip>
DB_PORT=5432
DB_NAME=idempiere
DB_USER=ross_agent
DB_PASSWORD=<password>
DB_SSL=true
AUTO_APPROVE_THRESHOLD=90
SCAN_INTERVAL_MINUTES=30
```

### Build settings (amplify.yml)
```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands: [npm ci]
    build:
      commands: [npm run build]
  artifacts:
    baseDirectory: .next
    files: ['**/*']
  cache:
    paths: [node_modules/**/*]
```

## What gets deleted

When Amplify passes smoke tests:
- `ross-roster/` directory (entirely — all logic moved to `admin-ui/lib/`)
- `admin-ui/scripts/deploy-ec2.sh`
- EC2: `pm2 delete ross-roster; pm2 delete ross-admin; rm -rf /opt/ross-roster /opt/ross-admin`

## Order of operations

1. **EC2 prep** — PG user, pg_hba, security group (5 min)
2. **Code move** — Copy lib files, rewrite routes as Next.js API handlers, add middleware, create cron scripts, delete Express entry point, remove ross-roster directory (Cursor session, ~1 hr)
3. **Amplify setup** — New app, env vars, build settings, first deploy (15 min)
4. **Smoke test** — Hit each endpoint group against live PG (30 min)
5. **EventBridge** — Create 3 scheduled functions (10 min)
6. **Verify cron** — Confirm proposals/gaps appear after scan cycle (next day)
7. **Cleanup** — Delete EC2 processes, delete ross-roster from repo (5 min)

## Route Mapping (all 25 endpoints)

| Express Route | Next.js Path | File |
|---|---|---|
| `GET /health` | `app/api/health/route.ts` | Straight copy |
| `GET /api/v1/shifts/vacant` | `app/api/v1/shifts/vacant/route.ts` | Straight copy |
| `GET /api/v1/shifts/vacant/:shiftId/matches` | `app/api/v1/shifts/vacant/[shiftId]/matches/route.ts` | Param change only |
| `POST /api/v1/assign` | `app/api/v1/assign/route.ts` | Straight copy |
| `GET /api/v1/audit` | `app/api/v1/audit/route.ts` | Straight copy |
| `GET /api/v1/audit/export` | `app/api/v1/audit/export/route.ts` | Straight copy |
| `GET /api/v1/gaps` | `app/api/v1/gaps/route.ts` | Straight copy |
| `POST /api/v1/gaps/:id/training-request` | `app/api/v1/gaps/[id]/training-request/route.ts` | Param change only |
| `GET /api/v1/proposals/pending` | `app/api/v1/proposals/pending/route.ts` | Straight copy |
| `POST /api/v1/proposals/:id/approve` | `app/api/v1/proposals/[id]/approve/route.ts` | Param change only |
| `POST /api/v1/proposals/:id/reject` | `app/api/v1/proposals/[id]/reject/route.ts` | Param change only |
| `POST /api/v1/proposals/bulk-approve` | `app/api/v1/proposals/bulk-approve/route.ts` | Straight copy |
| `POST /api/v1/worker/run` | `app/api/v1/worker/run/route.ts` | Straight copy |
| `POST /api/v1/planner/run` | `app/api/v1/planner/run/route.ts` | Straight copy |
| `POST /api/v1/leave/run` | `app/api/v1/leave/run/route.ts` | Straight copy |
| `POST /api/v1/pathways/send` | `app/api/v1/pathways/send/route.ts` | Straight copy |
| `POST /api/v1/swaps/detect` | `app/api/v1/swaps/detect/route.ts` | Straight copy |
| `POST /api/v1/swaps/:id/execute` | `app/api/v1/swaps/[id]/execute/route.ts` | Param change only |
| `GET /api/v1/credentials/expiring` | `app/api/v1/credentials/expiring/route.ts` | Straight copy |
| `POST /api/v1/credentials/remind` | `app/api/v1/credentials/remind/route.ts` | Straight copy |
| `GET /api/v1/forecast` | `app/api/v1/forecast/route.ts` | Straight copy |
| `GET /api/v1/coverage` | `app/api/v1/coverage/route.ts` | Straight copy |
| `GET /api/v1/config` | `app/api/v1/config/route.ts` | Straight copy |
| `PUT /api/v1/config` | `app/api/v1/config/route.ts` | Straight copy |
| `GET /api/v1/workers/:id/profile` | `app/api/v1/workers/[id]/profile/route.ts` | Param change only |
| `GET /api/v1/shifts/:id/detail` | `app/api/v1/shifts/[id]/detail/route.ts` | Param change only |
| `GET /api/v1/leaves` | `app/api/v1/leaves/route.ts` | Straight copy |
| `POST /api/v1/skills/run` | `app/api/v1/skills/run/route.ts` | Straight copy |

## Acceptance

- [ ] All API routes respond from Amplify against remote PG
- [ ] API key auth works (browser + cron header)
- [ ] Admin UI dashboard loads with real data
- [x] EventBridge triggers all 3 cron schedules (SAW054 — Scheduler + `ross-cron-invoke` Lambda)
- [ ] No Ross processes on EC2 (`pm2 list`)
- [ ] `ross_agent` user has no DDL/DROP privileges
- [ ] Port 5432 firewalled to Amplify IPs only
