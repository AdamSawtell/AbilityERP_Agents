# SAW045 — Ross Phase 4 Contract (Planner & Reports)

> **Status:** Complete on EC2 `54.206.8.250` (Entra/Amplify/Skills Manager still deferred)  
> **Ticket:** SAW045_ross_phase4 · AbilityERP_Agents  
> **Kind:** app  
> **Canonical product spec:** [ROSS-SCOPE.md](./ROSS-SCOPE.md) §10.4  
> **This file wins** on Phase 4 conflicts with Amplify / Entra-first drafts.

---

## Freeze decisions

| Topic | Decision |
|---|---|
| **Auth / Entra** | **Deferred.** Same as Phase 3 — private EC2, no Microsoft Entra/JWT. |
| **Hosting** | Keep Next.js `:3003` + Express `:3002`. Amplify not required to exit Phase 4. |
| **Skills Manager** | Still deferred. |
| **Sessions order** | **4a → 4b → 4c → 4d → 4e** |

---

## ROSS-SCOPE §10.4 mapping

| ID | Scope item | Phase 4 contract | Status |
|---|---|---|---|
| **4a** | Workforce Planner reports | Daily briefing API + cron + Planner admin page | **done** (`e581294`) |
| **4b** | Training gaps + Request Training | Gaps page actions / Pathways | **done** (`d74c38e`) |
| **4c** | Credential watch + bulk remind | Expiry radar + Pathways remind | **done** (`a032724`) |
| **4d** | Next Period forecast | Forecast API + Planner table + Dashboard Next rail | **done** (`9b942ed`) |
| **4e** | Audit log + export | Filters + CSV export | **done** (`9b942ed`) |

**Phase 4d exit:**

1. `GET /planner/forecast` returns next-14d fill, day rows, thin days  
2. Planner page shows forecast table; Dashboard **Next Period** rail shows summary  
3. Verified on EC2 **without Entra**

**Phase 4e exit:**

1. `GET /audit` supports `agent_type`, `action`, `since`, `until`  
2. `GET /audit/export` returns CSV download  
3. Admin Audit: timeframe/agent/action filters + Export CSV  
4. Verified on EC2 **without Entra**

**Phase 4a–4c exits:** see prior commits / GitHub issue #4.

---

## Explicitly deferred

- Microsoft Entra ID / JWT  
- Amplify hosting  
- Skills Manager runtime editing  

---

## Deploy

```bash
bash ross-roster/scripts/deploy-ec2.sh
bash admin-ui/scripts/deploy-ec2.sh
# http://54.206.8.250:3003 — Planner, Credentials, Gaps, Audit
```
