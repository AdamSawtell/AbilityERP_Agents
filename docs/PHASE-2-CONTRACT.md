# SAW043 — Ross Phase 2 Contract (Admin UI)

> **Status:** Phase 2 exit met on EC2 `54.206.8.250` (`fad6b36`)  
> **Ticket:** SAW043_ross_admin_ui · [Agents #2](https://github.com/AdamSawtell/AbilityERP_Agents/issues/2)  
> **Kind:** app  
> **Canonical product spec:** [ROSS-SCOPE.md](./ROSS-SCOPE.md) §4 (Admin Portal) + §10.2  
> **This file wins** on Phase 2 conflicts with Product Scope / Amplify-first drafts.

---

## Freeze decisions

| Topic | Decision |
|---|---|
| **UI host (Phase 2)** | Next.js on **this EC2** `:3003` (`/opt/ross-admin`). Amplify is optional later — not a Phase 2 gate. |
| **Code root** | `admin-ui/` in AbilityERP_Agents |
| **API** | Proxies to `ross-roster` `:3002` with server-side `ROSS_API_KEY` (never exposed to browser) |
| **Auth (Phase 2)** | Still API-key for Ross; admin UI unauthenticated on private EC2. JWT / Entra deferred to Phase 2.5 / Phase 3. |
| **Skills Manager** | **Deferred** — Config screen covers scan/matching thresholds only. |
| **Chat surface** | Dashboard feed = Ross recommendation bubbles + gap cards + **command input bar**. Not a free-form LLM chat. |
| **Polling** | Refresh every ~20s; no WebSocket/SSE in Phase 2. |
| **Auto-assign writes** | Remain **off** until explicitly enabled (Config threshold may flag `isAutoApproved` only). |

---

## ROSS-SCOPE §10.2 mapping

| ID | Scope item | Phase 2 contract | Status |
|---|---|---|---|
| **2a** | Tabbed layout + chat bubble components | Dashboard / Gaps / Config / Audit; proposal + gap bubbles | **done** (horizons + input bar in this session) |
| **2b** | Approve / Reject / Alternates + proposal reads | Approve → staff + Pathways; Reject; alternates for same shift | Approve/Reject **done**; Alternates **this session** |
| **2c** | No-match cards + escalation | Gap cards in feed + Gaps page | **done** |
| **2d** | Sidebar widgets | Last scan / Config / Activity (+ vacant by horizon) | **done** / extending |

**Phase 2 exit (contract):**

1. Officer sees pending proposals and can Approve (assignment + Pathways) or Reject  
2. Gaps visible (feed + Gaps page)  
3. Audit trail readable  
4. Config readable/writable for scan + matching thresholds  
5. Dashboard has horizon tabs + command input (`scan`, `status`, `help`, …)  
6. Live on `http://54.206.8.250:3003`

---

## Explicitly deferred (not Phase 2 exit)

- Amplify hosting / custom domain  
- JWT / Microsoft Entra SSO  
- Skills Manager / matrix box / draft skills  
- Record panel slide-in (Phase 3d)  
- Coverage heatmap (Phase 3e)  
- Auto-pilot bulk approve (Phase 3a)  
- Swap / pre-shift confirm worker flows (Phase 3)

---

## Deploy (this instance)

```bash
# Admin UI
bash admin-ui/scripts/deploy-ec2.sh   # → /opt/ross-admin, pm2 ross-admin :3003

# API (if changed)
bash ross-roster/scripts/deploy-ec2.sh # → /opt/ross-roster, pm2 ross-roster :3002
```

---

## Derived docs

| Doc | Role |
|---|---|
| [ROSS-SCOPE.md](./ROSS-SCOPE.md) | Full product specification |
| [PHASE-1-CONTRACT.md](./PHASE-1-CONTRACT.md) | Frozen Phase 1 (complete) |
| This file | Frozen Phase 2 admin UI decisions |
| `admin-ui/README.md` | Runbook for the Next.js app |
