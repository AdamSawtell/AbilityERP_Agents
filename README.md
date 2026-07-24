# AbilityERP Agents

Home for AbilityERP backend agents. First product: **Ross the Roster Agent** — a Digital Rostering Officer that fills shifts, matches workers, and talks to staff via Pathways while humans supervise from an admin UI.

## Ross (`ross-roster/`)

| | |
|---|---|
| **Ticket** | SAW042_ross_roster_phase1 |
| **Port** | 3002 |
| **EC2 path** | `/opt/ross-roster` |
| **Phase 1 contract** | [docs/PHASE-1-CONTRACT.md](./docs/PHASE-1-CONTRACT.md) |
| **Full product spec** | [docs/ROSS-SCOPE.md](./docs/ROSS-SCOPE.md) |

Phase 1 builds the Express/TypeScript service only (no Amplify UI yet).

```bash
cd ross-roster
cp .env.example .env   # fill DB_* and ROSTER_BOT_API_KEY
npm install
npm run migrate
npm run dev
curl -H "Authorization: Bearer $ROSTER_BOT_API_KEY" http://localhost:3002/health
```

## Docs

- `docs/PHASE-1-CONTRACT.md` — frozen build decisions (wins on conflicts)
- `docs/ROSS-SCOPE.md` — full product specification
- Ticket registry lives in AbilityERP Mobile APP `docs/TICKETS.md` (SAW###)
