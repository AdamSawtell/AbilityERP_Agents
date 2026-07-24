# SAW047 — Ross Phase 6 Contract (Leave Replacer)

> **Status:** Complete on EC2 `54.206.8.250` (Entra/Amplify still deferred) · commit `f109c69`  
> **Ticket:** SAW047_ross_leave_replacer · AbilityERP_Agents  
> **Kind:** app  
> **Canonical product spec:** [ROSS-SCOPE.md](./ROSS-SCOPE.md) §7.5 / skill Leave Replacer  
> **This file wins** on Phase 6 conflicts with Amplify / Entra-first drafts.

---

## Freeze decisions

| Topic | Decision |
|---|---|
| **Auth / Entra** | **Deferred.** Private EC2, no Microsoft Entra/JWT. |
| **Hosting** | Keep Next.js `:3003` + Express `:3002`. |
| **Leave signal** | Approved leave = `aberp_unavailability_leave.aberp_approverstatus = 'AP'` + `isactive='Y'` (same as matcher). Do **not** require `processed='Y'`. |
| **Skill gate** | Cron only when `leave_replacer` status is **on**. Manual Run Now when on or paused. |
| **Auto-assign** | Uses existing `auto_assign_enabled` + `auto_approve_threshold`. If auto-assign off → vacate + proposals. |
| **Idempotency** | Track `(leave_id, shift_id)` in `rostering_agent_leave_replacements` — never double-vacate. |

---

## Slice mapping

| ID | Scope item | Contract | Status |
|---|---|---|---|
| **6a** | Detect + vacate | Find AP leave overlapping staffed shifts; vacate line; persist tracking | **done** (`f109c69`) |
| **6b** | Replace / propose | Match → auto-assign or proposals; Pathways to worker / officer on fail | **done** (`f109c69`) |
| **6c** | Admin + Run Now | Leaves page + `POST /leave/run` + skill runner | **done** (`f109c69`) |

**Exit:**

1. `POST /api/v1/leave/run` processes pending leave overlaps  
2. Affected staff lines vacated; replacements assigned or proposed  
3. Audit `leave_replacement`; skill last-run updates  
4. Admin **Leaves** page lists results + Run cycle  
5. Verified on EC2 **without Entra**

---

## Explicitly deferred

- Microsoft Entra ID / JWT  
- Amplify hosting  
- Freeform Add Skill / draft publish  
- Post-shift follow-up (§7.6)  

---

## Deploy

```bash
bash /opt/ross-roster/scripts/deploy-ec2.sh
bash /opt/ross-admin/scripts/deploy-ec2.sh
# http://54.206.8.250:3003/leaves
```
