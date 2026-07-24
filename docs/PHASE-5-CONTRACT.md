# SAW046 — Ross Phase 5 Contract (Skills Manager)

> **Status:** In progress on EC2 `54.206.8.250` (Entra/Amplify still deferred)  
> **Ticket:** SAW046_ross_skills_manager · AbilityERP_Agents  
> **Kind:** app  
> **Canonical product spec:** [ROSS-SCOPE.md](./ROSS-SCOPE.md) §4.3 / §5  
> **This file wins** on Phase 5 conflicts with Amplify / Entra-first drafts.

---

## Freeze decisions

| Topic | Decision |
|---|---|
| **Auth / Entra** | **Deferred.** Private EC2, no Microsoft Entra/JWT. Admin UI open on `:3003`; Ross API Bearer API-key only. |
| **Hosting** | Keep Next.js `:3003` + Express `:3002`. Amplify not required to exit Phase 5. |
| **Skills model** | Built-in skill catalogue in DB (`rostering_agent_skills`). Status cycles **on → paused → off**. |
| **Runtime** | Cron / scan chain **respects status**: `on` runs automatically; `paused` skips cron (manual Run Now OK); `off` skips cron + chain effects. |
| **Add Skill / drafts** | **Deferred.** No freeform skill authoring or draft/publish cycle in Phase 5. |
| **Leave Replacer** | Catalogue row only — no leave-event wiring yet. |
| **Sessions order** | **5a → 5b → 5c → 5d** |

---

## Slice mapping

| ID | Scope item | Phase 5 contract | Status |
|---|---|---|---|
| **5a** | Skills list + toggle | Table + seed + `GET/PATCH /skills` + Skills admin page | shipping |
| **5b** | Skill detail + Run Now | Detail page (purpose/trigger/deps) + `POST /skills/:key/run` | shipping |
| **5c** | Runtime gating | Crons + emergency chain honour skill status | shipping |
| **5d** | Matching weights | Soft-rule weights editable on Worker Matching skill | shipping |

**Phase 5a exit:**

1. Migration seeds 9 built-in skills  
2. `GET /api/v1/skills` lists them with status + last run  
3. `PATCH /api/v1/skills/:key` cycles/sets status; audit `skill_toggled`  
4. Admin **Skills** page toggles without deploy  
5. Verified on EC2 **without Entra**

**Phase 5b exit:**

1. `GET /api/v1/skills/:key` returns detail  
2. `POST /api/v1/skills/:key/run` triggers applicable runners (scanner, confirm, swap, planner)  
3. Admin skill detail page + Run Now  
4. Verified on EC2 **without Entra**

**Phase 5c exit:**

1. Emergency cron skips when `shift_scanner` is paused/off  
2. Scan skips matching when `worker_matching` off; skips gaps when `gap_detector` off  
3. Confirm / swap / planner crons honour their skill status  
4. Verified on EC2 **without Entra**

**Phase 5d exit:**

1. Soft weights stored on Worker Matching skill (JSON)  
2. Matcher reads weights; admin can edit + save  
3. Verified on EC2 **without Entra**

---

## Explicitly deferred

- Microsoft Entra ID / JWT  
- Amplify hosting  
- Freeform **Add Skill** / draft-publish-rollback  
- Leave Replacer execution  
- LLM prompt editing as live agent instructions  

---

## Deploy

```bash
bash /opt/ross-roster/scripts/deploy-ec2.sh
bash /opt/ross-admin/scripts/deploy-ec2.sh
# http://54.206.8.250:3003/skills
```
