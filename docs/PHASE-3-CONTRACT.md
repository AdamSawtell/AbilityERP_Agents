# SAW044 — Ross Phase 3 Contract (Value Features)

> **Status:** In progress on EC2 `54.206.8.250`  
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
| **3a** | Auto-pilot threshold + bulk approve + summary | Config toggle + scan auto-write + bulk Approve + dashboard summary | **this ticket (first)** |
| **3b** | Pre-shift confirmation + worker chat | Pathways confirm requests + response handling | later in SAW044 |
| **3c** | Swap management | Detect / propose / execute swaps | later |
| **3d** | Record panel | Slide-in shift + worker detail | next after 3a |
| **3e** | Coverage heatmap | Sidebar heatmap | later |

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
- Full 3b–3e until after 3a lands

---

## Deploy

```bash
bash ross-roster/scripts/deploy-ec2.sh
bash admin-ui/scripts/deploy-ec2.sh
# http://54.206.8.250:3003 — no login required on this host
```
