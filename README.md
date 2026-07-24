# AbilityERP Agents

Home for AbilityERP backend agents. First product: **Ross the Roster Agent** — a Digital Rostering Officer that fills shifts, matches workers, and talks to staff via Pathways while humans supervise from an admin UI.

## Ross API (`ross-roster/`)

| | |
|---|---|
| **Ticket** | SAW042 (done) |
| **Port** | 3002 |
| **EC2 path** | `/opt/ross-roster` |
| **Phase 1 contract** | [docs/PHASE-1-CONTRACT.md](./docs/PHASE-1-CONTRACT.md) |
| **Full product spec** | [docs/ROSS-SCOPE.md](./docs/ROSS-SCOPE.md) |

## Ross Admin UI (`admin-ui/`)

| | |
|---|---|
| **Ticket** | SAW043 |
| **Port** | 3003 |
| **EC2 path** | `/opt/ross-admin` |
| **URL** | http://54.206.8.250:3003 |

```bash
# API
cd ross-roster && cp .env.example .env && npm install && npm run migrate && npm run dev

# Admin (proxies to API with server-side key)
cd admin-ui && cp .env.example .env && npm install && npm run dev
```

## Docs

- `docs/PHASE-1-CONTRACT.md` — Phase 1 freeze (complete on EC2)
- `docs/ROSS-SCOPE.md` — full product specification
- Ticket registry: AbilityERP Mobile APP `docs/TICKETS.md` + `docs/TICKETS.md` here
