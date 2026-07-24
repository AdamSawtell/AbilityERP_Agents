# SAW045 — Ross Phase 4 Contract (Planner & Reports)

> **Status:** In progress on EC2 `54.206.8.250`  
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
| **Sessions order** | **4a first** (planner briefing), then 4b/4c/4e/4d as capacity allows. |

---

## ROSS-SCOPE §10.4 mapping

| ID | Scope item | Phase 4 contract | Status |
|---|---|---|---|
| **4a** | Workforce Planner reports | Daily briefing API + cron + Planner admin page | **done** (`e581294`) |
| **4b** | Training gaps + Request Training | Gaps page actions / Pathways | **done** (`d74c38e`) |

**Phase 4b exit:**

1. `GET /gaps/training-summary` aggregates open gaps by credential/reason  
2. `POST /gaps/:id/training-request` marks gap(s), Pathways notifies officer, audit `training_requested`  
3. `POST /gaps/:id/resolve` closes a gap  
4. Admin Gaps: Unresolved/Resolved, training cards + Request/Resolve  
5. Verified on EC2 **without Entra**
| **4c** | Credential watch + bulk remind | Expiry radar + Pathways remind | **done** (`a032724`) |

**Phase 4c exit:**

1. `GET /credentials/expiring` returns 7/14/30d radar + groups  
2. `POST /credentials/bulk-remind` sends Pathways reminders (audit `cred_remind`)  
3. Admin **Credentials** page: radar cards + Bulk remind  
4. Verified on EC2 **without Entra**
| **4d** | Next Period forecast | Forecast on Next horizon / Planner | later |
| **4e** | Audit log + export | Filter + CSV export | later |

**Phase 4a exit:**

1. `GET /api/v1/planner/briefing` returns fill rates, training gaps, credential expiry, hiring signals, recommendations  
2. Daily 4am cron (+ `POST /planner/run`) writes audit `daily_plan`  
3. Admin **Planner** page shows the briefing (no Entra)  
4. Verified on EC2

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
# http://54.206.8.250:3003/planner
```
