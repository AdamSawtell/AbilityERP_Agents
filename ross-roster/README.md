# ross-roster (SAW042)

Express/TypeScript service for **Ross the Roster Agent** on port **3002**.

Build authority: [`docs/PHASE-1-CONTRACT.md`](../docs/PHASE-1-CONTRACT.md).

## Phase 1a (this commit)

- Express skeleton + API key auth
- PG pool
- Migrations for config / audit / gaps / proposals
- `GET /health`
- `GET /api/v1/audit`, `GET /api/v1/gaps` (+ training-request stub write)
- 501 stubs for 1b/1c routes

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
