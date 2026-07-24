# SAW042 — Ross Phase 1 Contract (Frozen)

> **Status:** Phase 1 complete on EC2 `54.206.8.250` (1a–1d)  
> **Ticket:** SAW042_ross_roster_phase1  
> **Kind:** app  
> **Canonical product spec:** [ROSS-SCOPE.md](./ROSS-SCOPE.md)  
> **This file wins** on any conflict with Product Scope / Cursor Scope / older drafts.

---

## Freeze decisions

| Topic | Decision |
|---|---|
| **Product name** | Ross the Roster Agent (`ross-roster`) |
| **Repository** | https://github.com/AdamSawtell/AbilityERP_Agents (monorepo) |
| **Service path (EC2)** | `/opt/ross-roster` |
| **Port** | `3002` (nginx: `/ross-roster/` → `:3002`) |
| **Code root** | `ross-roster/` in this repo |
| **Admin UI** | Later (Phase 2) under `admin-ui/` in this same repo — not a separate Amplify repo |
| **Skills Manager** | **Out of Phase 1.** Phase 1 ships a fixed pipeline: Shift Scanner → Worker Matching → Gap Detector → (Pathways in 1d). Runtime skill editing is Phase 2+. |
| **Soft rule #6** | **Availability pattern** (20 pts) — not “no soft-rule flags” |
| **Gender preference** | **Hard rule** by default. Human may override on assign with `isOverride=true` + logged reason. |
| **Auth (Phase 1)** | Service API key only: `Authorization: Bearer {ROSTER_BOT_API_KEY}`. Human JWT / Entra SSO arrives with admin UI (Phase 2). |
| **Auto-assign in Phase 1** | **Off by default for writes.** Scanner + matcher log proposals/gaps/audit. `POST /assign` exists but is manual/API-only until Phase 2 UI. |
| **Secrets** | Never commit DB passwords or API keys. Use `.env` (gitignored) + `.env.example`. |

---

## Soft rules (locked totals = 100)

| Rule | Weight |
|---|---|
| Continuity of care | 25 |
| Location proximity | 20 |
| Availability pattern | 20 |
| Contract capacity | 15 |
| Transport match | 10 |
| Response history | 10 |

Auto-approve threshold default: **90** (config table). Phase 1 may compute `isAutoApproved` but must not auto-write assignments until explicitly enabled.

---

## Tables (create in Phase 1a)

All in `adempiere` schema, **not** AD-registered:

1. `rostering_agent_config`
2. `rostering_agent_audit_log`
3. `rostering_agent_gaps`
4. `rostering_agent_proposals` (create now; used from 1c / Phase 2)

---

## Phase 1 sessions & exit criteria

| Session | Deliverable | Exit |
|---|---|---|
| **1a** | Express/TS skeleton, pool, migrations, config/audit helpers, route stubs, `GET /health` | Health returns OK (with DB status) |
| **1b** | Matching engine (hard + soft) | `GET /api/v1/shifts/vacant/:id/matches` ranks real workers |
| **1c** | Emergency Rosterer cron + hot failover + gap/proposal logging | Cron logs `scan_run`; gaps written on zero-match |
| **1d** | Pathways writer (validate live chat schema first) | Assign path can notify a worker |

**Phase 1 overall exit:** Agent scans, matches, logs audit/gaps/proposals. No Amplify UI yet. Verify via API + SQL.

---

## Phase 1 API surface

| Method | Path | Session |
|---|---|---|
| GET | `/health` | 1a |
| GET | `/api/v1/shifts/vacant` | 1b |
| GET | `/api/v1/shifts/vacant/:shiftId/matches` | 1b |
| POST | `/api/v1/assign` | 1b/1d |
| GET | `/api/v1/audit` | 1a |
| GET | `/api/v1/gaps` | 1a |
| POST | `/api/v1/gaps/:id/training-request` | 1c |
| GET | `/api/v1/proposals/pending` | 1c |
| POST | `/api/v1/worker/run` | 1c |

---

## Explicitly deferred

- Skills Manager / matrix box / draft skill versions
- Amplify admin chat UI
- JWT / Entra for humans
- Auto-assign side effects in production scans
- Swap handler, leave replacer, planner briefing, credential watch UI
- WebSocket/SSE push (Phase 2 can poll)

---

## Derived docs

| Doc | Role |
|---|---|
| `docs/ROSS-SCOPE.md` | Canonical full product specification |
| Obsidian `Product Scope.md` | Historical product vision — derived |
| Obsidian `Cursor Scope.md` | Superseded by this contract for Phase 1 |
| Obsidian `ROSS-SCOPE.md` | Mirror of canonical; keep in sync when scope changes |
