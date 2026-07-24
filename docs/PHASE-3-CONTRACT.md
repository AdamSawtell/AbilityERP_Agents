# SAW044 — Ross Phase 3 Contract (Value Features)

> **Status:** Complete on EC2 `54.206.8.250` (Entra/Amplify/Skills Manager still deferred)  
> **Ticket:** SAW044_ross_phase3 · AbilityERP_Agents  
> **Kind:** app  
> **Canonical product spec:** [ROSS-SCOPE.md](./ROSS-SCOPE.md) §10.3  
> **This file wins** on Phase 3 conflicts with Amplify / Entra-first drafts.

---

## Freeze decisions

| Topic | Decision |
|---|---|
| **Auth / Entra** | **Deferred.** Phase 3 stays testable on private EC2 without Microsoft Entra or JWT. Admin UI remains open on `:3003`; Ross API stays Bearer API-key only. |
| **Hosting** | Keep Next.js on EC2 `:3003` + Express `:3002`. Amplify not required to exit Phase 3. |
| **Auto-assign writes** | Gated by config `auto_assign_enabled` (**default OFF**). When ON, scores ≥ `auto_approve_threshold` write staff + Pathways during scan. |
| **Bulk approve** | Human can bulk-approve pending proposals at/above threshold (or flagged `isAutoApproved`) from Dashboard — works with auto-assign OFF. |
| **Skills Manager** | Still deferred (Config covers auto-pilot + thresholds). |
| **Sessions order** | **3a first** (auto-pilot + bulk + summary), then 3d record panel, then 3b/3c/3e as capacity allows. |

---

## ROSS-SCOPE §10.3 mapping

| ID | Scope item | Phase 3 contract | Status |
|---|---|---|---|
| **3a** | Auto-pilot threshold + bulk approve + summary | Config toggle + scan auto-write + bulk Approve + dashboard summary | **done** (`f4c1a9c`) |
| **3b** | Pre-shift confirmation + worker chat | Pathways confirm + REQ/DEC poll + escalate/vacate + Confirms admin | **done** (`11cc4e5`) |
| **3c** | Swap management | Detect / propose / execute swaps + Swaps admin | **done** (`0fdfb0d`) |
| **3d** | Record panel | Slide-in shift + worker detail | **done** (`af393e3`) |
| **3e** | Coverage heatmap | Sidebar heatmap | **done** (`dbbe4c1`) |

**Phase 3e exit:**

1. `GET /api/v1/coverage?horizon=` returns day × AM/PM/Eve fill cells  
2. Dashboard rail shows Coverage heatmap (admin BFF `/api/heatmap`)  
3. Horizon tabs refresh coverage with vacant list  
4. Verified on EC2 **without Entra**

**Phase 3c exit:**

1. `POST /api/v1/swaps/run` detects cross-day assignment pairs (clash/leave-safe) + scans Pathways “swap” intents  
2. Propose writes `rostering_agent_swaps`, Pathways both workers, audit `swap_proposed`  
3. Admin approve (or dual respond accept) rewrites both staff lines, audit `swap_approved`, notifies both  
4. Admin **Swaps** page: Run detect + Approve/Reject  
5. Verified on EC2 **without Entra**

**Phase 3b exit:**

1. Hourly cron + `POST /api/v1/confirmations/run` send Pathways reminders within `pre_shift_confirm_hours`
2. Poll `aberp_rosteredresponselog` REQ → confirm / DEC → vacate staff line + audit
3. Escalate when still pending within `escalation_hours_before_shift`
4. Admin **Confirms** page: run cycle + manual confirm/decline (no-Entra smoke)
5. Verified on EC2 **without Entra**

**Phase 3a exit (this slice):**

1. Config exposes `auto_assign_enabled` + threshold  
2. With toggle ON, emergency scan auto-assigns top match ≥ threshold (audit `match_auto_assigned`)  
3. Dashboard can bulk-approve safe pending proposals  
4. Summary shows auto-assigned / pending / exceptions  
5. Verified on EC2 **without Entra**

---

## Explicitly deferred

- Microsoft Entra ID / JWT for admin UI  
- Amplify hosting  
- Skills Manager runtime editing

---

## Deploy

```bash
bash ross-roster/scripts/deploy-ec2.sh
bash admin-ui/scripts/deploy-ec2.sh
# http://54.206.8.250:3003 — no login required on this host
```
