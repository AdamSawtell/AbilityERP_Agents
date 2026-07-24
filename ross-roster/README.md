# ross-roster (SAW042)

Express/TypeScript service for **Ross the Roster Agent** on port **3002**.

Build authority: [`docs/PHASE-1-CONTRACT.md`](../docs/PHASE-1-CONTRACT.md).

## Status (SAW042)

### Phase 1a
- Express skeleton + API key auth, PG pool, migrations, `GET /health`, audit/gaps

### Phase 1b
- Vacant shifts + matching engine (hard/soft rules aligned with SAW003 leave/needs)
- `POST /api/v1/assign` (staff line fill/insert + audit; Pathways in 1d)

### Phase 1c
- Emergency Rosterer cron (config `scan_interval_minutes`, default 30)
- `POST /api/v1/worker/run`, `GET /api/v1/proposals/pending`
- Proposals + gap logging on zero-match (no auto-assign in Phase 1)

### Phase 1d
- Pathways writer via Rostering Chat (`r_request.lastresult` + sync trigger) + `aberp_rosteredresponselog` MSG
- `POST /api/v1/assign` notifies worker by default (`notifyWorker: false` to skip)
- `POST /api/v1/pathways/send` for manual smoke sends

**Deploy target:** AbilityERP EC2 `54.206.8.250` only (`/opt/ross-roster`, PM2 `ross-roster`).

## Local

```bash
cp .env.example .env
# set DB_PASSWORD + ROSTER_BOT_API_KEY
npm install
npm run migrate
npm run dev
```

```bash
curl http://localhost:3002/health
curl -H "Authorization: Bearer $ROSTER_BOT_API_KEY" http://localhost:3002/api/v1/audit
```

## EC2

Deploy to `/opt/ross-roster`, then:

```bash
npm ci
npm run build
npm run migrate
pm2 start ecosystem.config.js
```
