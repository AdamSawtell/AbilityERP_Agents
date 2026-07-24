# Ross — Full Build Specification

> **Version:** 1.0  
> **Status:** Canonical product specification  
> **Phase 1 build contract (wins on conflicts):** [PHASE-1-CONTRACT.md](./PHASE-1-CONTRACT.md) · ticket **SAW042**  
> **Applies to:** Ross the Roster Agent — backend service + Amplify admin UI + AbilityERP PWA worker integration  
> **Build target:** AbilityERP EC2 + AWS Amplify  
> **Nickname:** Ross the Roster Agent  
> **Repository:** https://github.com/AdamSawtell/AbilityERP_Agents  
> **Build tool:** Cursor (AI-assisted development)  

---

## 1. Product Overview

### 1.1 What It Is

Ross is a **Digital Rostering Officer** — a semi-autonomous backend service that manages shift filling, worker matching, and rostering communication for AbilityERP. It runs alongside iDempiere on the same EC2, reads/writes the same PostgreSQL database the PWA uses, and communicates with workers via the existing Pathways chat system.

**It is not a replacement for the AbilityERP PWA.** Workers continue using the PWA as their primary interface. Ross is an invisible backend that makes the PWA smarter — it populates schedules, sends curated shift offers, handles confirmations and swaps, and automates leave replacement. The only new UI is an Amplify admin chat for human oversight.

### 1.2 Actors

| Actor | Interface | Role |
|---|---|---|
| **Rostering Officer (human)** | Amplify admin chat (new) | Reviews exceptions, approves overrides, sees audit trail |
| **Support Worker** | AbilityERP PWA (existing) | Receives assignments, confirms shifts, requests swaps, submits leave |
| **Emergency Rosterer (agent)** | Backend service | Scans and fills shifts in the next 48h, proposes matches, handles cancellations |
| **Workforce Planner (agent)** | Backend service | Overnight analysis: predictions, trends, gap detection, hiring signals |

### 1.3 Architecture

```
                           Internet
                              │
                    ┌─────────┴──────────┐
                    │ AWS Amplify         │
                    │ Admin Chat UI       │  ← New (Next.js)
                    │ Worker PWA          │  ← Existing (Next.js)
                    └─────────┬──────────┘
                              │ HTTPS
                    ┌─────────┴──────────┐
                    │ EC2 (54.206.8.250)  │
                    │  :3001 — PWA API    │  ← Existing
                    │  :3002 — Ross │  ← New (Express/TS)
                    │  :5444 — iDempiere  │  ← Existing
                    └─────────┬──────────┘
                              │ localhost:5432
                    ┌─────────┴──────────┐
                    │ PostgreSQL          │
                    │ (idempiere schema)  │
                    │ 1,078 tables        │
                    └────────────────────┘
```

**Key constraints:**
- Port 3002 is the Ross Express service
- Reverse-proxied through nginx alongside the PWA API
- Direct PostgreSQL access via `pg` (node-postgres) — no REST API layer between agent and data
- Workers never hit port 3002 — they interact through the PWA only

### 1.4 Authentication & Authorisation

**Ross uses the same auth system as the existing AbilityERP PWA — no separate user management.**

| Auth method | Source | Used by |
|---|---|---|
| **AD_User password** | iDempiere `AD_User` table (username + hashed password) | Admin chat UI (rostering officers) |
| **Microsoft Entra ID SSO** | Microsoft OAuth2/OIDC, mapped to `AD_User` by email/UPN | Admin chat UI + worker PWA |

**Role-based access:**
- Only users with the **Rostering Officer** role (or admin) in AbilityERP can access the admin chat UI
- Ross validates via the same JWT middleware the PWA API uses
- Worker-facing interactions (Pathways chat) are governed by existing PWA auth — no change

### 1.5 Development & Build Requirements

**Ross is designed to be built by Cursor (AI-assisted development).** The scope document is the primary input for the Cursor agent (Jaideep).

| Requirement | Detail |
|---|---|
| **Repository** | `https://github.com/AdamSawtell/AbilityERP_Agents` |
| **Build tool** | Cursor (AI-assisted IDE) |
| **Code language** | TypeScript (Express backend) + TypeScript/Next.js (Amplify frontend) |
| **Hosting** | AWS Amplify (admin UI) + EC2 port 3002 (Express API) |
| **Database** | Direct PostgreSQL on same EC2 as iDempiere (localhost:5432) |
| **CI/CD** | Amplify auto-deploys on `git push origin main` for the admin UI<br/>PM2 restart on the EC2 for the Express service (manual or webhook) |
| **Phase delivery** | Each phase is a separate Cursor session with its own exit criteria (see Section 10) |
| **Verification** | Jaideep verifies exit criteria before advancing to the next phase |

---

## 2. Data Model — New Tables

### 2.1 `adempiere.rostering_agent_config`

Human-configurable settings for the agent behaviour.

```sql
CREATE TABLE adempiere.rostering_agent_config (
    key         VARCHAR(50) PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_by  VARCHAR(100),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

| key | Default value | Purpose |
|---|---|---|
| `auto_approve_threshold` | `90` | Score above this auto-assigns without human review |
| `scan_interval_minutes` | `30` | Emergency Rosterer scan frequency |
| `pre_shift_confirm_hours` | `14` | Hours before shift to send confirmation request |
| `escalation_hours_before_shift` | `4` | If shift still unfilled at T-4h, raise red alert |
| `max_safe_matches_per_scan` | `3` | Max candidates proposed per shift |
| `employee_no_auto_approve` | `[]` | JSON array of worker IDs excluded from auto-approve |

### 2.2 `adempiere.rostering_agent_audit_log`

Immutable action log for NDIS compliance. Every agent action is recorded.

**Storage location:** This table lives in the `adempiere` schema of the **iDempiere PostgreSQL database** — the same database that stores all AbilityERP data. It is NOT in a separate database. This ensures:
- All audit data is backed up as part of the standard iDempiere backup procedure
- Audit data can be queried alongside the `aberp_*` tables for cross-referencing
- No external storage to manage or reconcile
- Full ACID compliance — every audit write is transactional with the assignment it records

> **Note:** These tables are NOT registered in iDempiere's Application Dictionary (AD). They are raw PostgreSQL tables accessible to the Ross service and to direct SQL queries. If visibility inside iDempiere windows is required, AD registration can be added as a future phase.

```sql
CREATE TABLE adempiere.rostering_agent_audit_log (
    id              SERIAL PRIMARY KEY,
    timestamp       TIMESTAMPTZ DEFAULT NOW(),
    agent_type      VARCHAR(20) NOT NULL CHECK (agent_type IN ('emergency', 'planner', 'system')),
    action          VARCHAR(30) NOT NULL,
    shift_id        NUMERIC,
    worker_id       NUMERIC,
    score           INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
    rules_passed    JSONB,
    rules_failed    JSONB,
    approved_by     VARCHAR(100),
    notes           TEXT,
    previous_hash   VARCHAR(64),
    created         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_timestamp ON adempiere.rostering_agent_audit_log (timestamp DESC);
CREATE INDEX idx_audit_shift ON adempiere.rostering_agent_audit_log (shift_id);
CREATE INDEX idx_audit_worker ON adempiere.rostering_agent_audit_log (worker_id);
```

**Action values:**
| action | Meaning |
|---|---|
| `system_startup` | Service started |
| `config_changed` | Config value updated |
| `scan_run` | Emergency scan completed |
| `match_proposed` | Candidates proposed for a shift |
| `match_auto_assigned` | Shift auto-assigned (above threshold) |
| `match_approved` | Human approved a proposal |
| `match_rejected` | Human rejected a proposal |
| `shift_assigned` | Assignment written to aberp_rostered_shiftstaff |
| `shift_unassigned` | Assignment removed |
| `swap_proposed` | Worker swap proposed |
| `swap_approved` | Swap confirmed |
| `gap_logged` | No-match event recorded |
| `training_requested` | Training need flagged |
| `pre_shift_confirmed` | Worker confirmed shift |
| `pre_shift_cancelled` | Worker cancelled before shift |
| `leave_replacement` | Leave triggered auto-replacement |
| `daily_plan` | Workforce Planner daily report |

**`previous_hash`:** SHA256 of the previous row's `id || timestamp || action || shift_id || worker_id || score`. Creates a blockchain-lite chain for tamper-evident audit.

### 2.3 `adempiere.rostering_agent_gaps`

Records when the agent cannot find any eligible worker for a shift.

```sql
CREATE TABLE adempiere.rostering_agent_gaps (
    id                SERIAL PRIMARY KEY,
    detected_at       TIMESTAMPTZ DEFAULT NOW(),
    shift_id          NUMERIC NOT NULL,
    shift_name        VARCHAR(255),
    shift_date        DATE,
    shift_time        VARCHAR(20),
    reason            VARCHAR(30) NOT NULL,
    credential_id     NUMERIC,
    credential_name   VARCHAR(255),
    affected_workers  JSONB,
    blocked_count     INTEGER DEFAULT 1,
    resolved          BOOLEAN DEFAULT FALSE,
    training_requested BOOLEAN DEFAULT FALSE,
    escalation_level  VARCHAR(10) DEFAULT 'info' CHECK (escalation_level IN ('info', 'warning', 'critical')),
    escalated_at      TIMESTAMPTZ,
    resolved_at       TIMESTAMPTZ,
    resolution_notes  TEXT,
    created           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gaps_unresolved ON adempiere.rostering_agent_gaps (resolved, escalation_level);
CREATE INDEX idx_gaps_credential ON adempiere.rostering_agent_gaps (credential_id);
CREATE INDEX idx_gaps_detected ON adempiere.rostering_agent_gaps (detected_at DESC);
```

**`reason` values:**
| reason | Meaning |
|---|---|
| `missing_credential` | No worker holds the required credential (or it's expired) |
| `gender_pref` | Gender preference set but no matching workers available |
| `leave_block` | All eligible workers are on leave |
| `no_workers_in_zone` | No workers assigned to the shift's location zone |
| `contract_full` | All eligible workers are at contract max hours |
| `time_clash` | Eligible workers all have overlapping shifts |
| `excluded` | Only matching worker is excluded (hr_exclude) |
| `unknown` | Catch-all |

**`affected_workers` structure:**
```json
[
  {
    "id": 1000123,
    "name": "Emma Smith",
    "missing": "Diabetes Training",
    "other_blockers": ["transport"]
  }
]
```

### 2.4 `adempiere.rostering_agent_proposals`

Temporary table for pending proposals awaiting human review.

```sql
CREATE TABLE adempiere.rostering_agent_proposals (
    id              SERIAL PRIMARY KEY,
    shift_id        NUMERIC NOT NULL,
    shift_name      VARCHAR(255),
    worker_id       NUMERIC NOT NULL,
    worker_name     VARCHAR(255),
    score           INTEGER NOT NULL,
    rules_passed    JSONB,
    rules_failed    JSONB,
    proposed_at     TIMESTAMPTZ DEFAULT NOW(),
    status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    reviewed_by     VARCHAR(100),
    reviewed_at     TIMESTAMPTZ,
    notes           TEXT,
    created         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_proposals_pending ON adempiere.rostering_agent_proposals (status, proposed_at);
CREATE INDEX idx_proposals_shift ON adempiere.rostering_agent_proposals (shift_id);
```

Expired proposals (no review within 2h) are automatically rejected and a new scan is triggered.

---

## 3. Matching Engine Specification

### 3.1 Overview

The matching engine takes a `shift_id` and returns ranked candidates eligible for assignment. It runs synchronously and completes within 500ms for typical shifts.

**Input:** `shift_id: number`  
**Output:** 
```typescript
interface MatchResult {
  shiftId: number;
  candidates: MatchCandidate[];
  hasHardRules: boolean;       // true if any rules were evaluated
  totalEligible: number;       // workers who passed ALL hard rules
  totalConsidered: number;     // workers checked
  blocker?: MatchBlocker;      // present when zero candidates
  scanTimestamp: string;
}

interface MatchCandidate {
  workerId: number;
  workerName: string;
  score: number;               // 0-100
  scoreBreakdown: {
    category: string;
    weight: number;
    earned: number;
  }[];
  hardRules: { rule: string; pass: boolean }[];
  softRules: { rule: string; pass: boolean; weight: number }[];
  isAutoApproved: boolean;     // true if score >= threshold
  reason: string;              // human-readable summary
}

interface MatchBlocker {
  reason: string;              // the dominant blocker reason
  detail: string;              // human-readable explanation
  affectedWorkers: number;
  suggestedAction: string;     // e.g. 'train_workers', 'relax_filter', 'escalate'
}
```

### 3.2 Hard Rules (Filters — Exclude on Failure)

These are SQL WHERE clauses. A worker failing ANY hard rule is invisible to the engine.

| # | Rule | SQL Implementation | Notes |
|---|---|---|---|
| 1 | **Not on leave** | `NOT EXISTS (SELECT 1 FROM aberp_unavailability_leave ul WHERE ul.c_bpartner_staff_id = w.c_bpartner_id AND ul.startdate <= :shiftDate AND ul.enddate >= :shiftDate AND ul.isactive='Y' AND COALESCE(ul.processed,'N')='Y')` | Leave must be active AND processed |
| 2 | **All required credentials held** | For each credential from `aberp_sr_needs_rules` (via SR/LOC/RS association), check `EXISTS (SELECT 1 FROM aberp_credentialassignment ca WHERE ca.c_bpartner_staff_id = w.c_bpartner_id AND ca.aberp_credentials_id = :credId AND ca.isactive='Y' AND (ca.aberp_expirydate IS NULL OR ca.aberp_expirydate > :shiftDate))` | ALL must pass |
| 3 | **No shift clash** | `NOT EXISTS (SELECT 1 FROM aberp_rostered_shiftstaff ss JOIN aberp_rostered_shift s2 ON s2.aberp_rostered_shift_id = ss.aberp_rostered_shift_id WHERE ss.c_bpartner_staff_id = w.c_bpartner_id AND ss.isactive='Y' AND COALESCE(s2.iscancelled,'N')='N' AND s2.startdate = :shiftDate AND (s2.starttime, s2.endtime) OVERLAPS (:startTime, :endTime))` | Overlap check on time ranges |
| 4 | **Gender preference** | If `aberp_sr_needs_rules.aberp_gender_id IS NOT NULL` for this shift's SR → match against worker's gender. Gender stored in `c_bpartner` or `hr_employee` | Soft rule override available |
| 5 | **Not excluded** | `COALESCE(hr.hr_exclude,'N') != 'Y'` where `hr.c_bpartner_id = w.c_bpartner_id` | Hard block, no override |

### 3.3 Soft Rules (Scoring — Rank Candidates)

Each rule contributes weight to a 0-100 score. Hard rules must all pass first.

| # | Rule | Weight | Implementation | Scoring |
|---|---|---|---|---|
| 1 | **Contract capacity** | 15 pts | `SELECT aberp_contract_hrs, aberp_max_contract_hrs FROM aberp_employee_contract WHERE c_bpartner_staff_id = w.c_bpartner_id AND isactive='Y'` | 15 if under max, 10 if at 80%, 5 if at 90%, 0 if at max |
| 2 | **Transport match** | 10 pts | Shift has `aberp_transport_required = 'Y'` and worker has Drivers Licence credential | 10 if both met, 10 if neither requires, 0 if shift requires but worker lacks |
| 3 | **Continuity of care** | 25 pts | `SELECT COUNT(*) FROM aberp_rostered_shiftstaff ss JOIN aberp_rostered_shift s ON s.aberp_rostered_shift_id = ss.aberp_rostered_shift_id JOIN aberp_rostered_shiftreceiver sr ON sr.aberp_rostered_shift_id = s.aberp_rostered_shift_id WHERE ss.c_bpartner_staff_id = w.c_bpartner_id AND sr.c_bpartner_id = :srBPartnerId` | 25 if 5+ times, 20 if 3-4, 15 if 1-2, 5 if never |
| 4 | **Location proximity** | 20 pts | Compare `aberp_masterlocation_id` on shift vs worker's usual zone. `SELECT aberp_masterlocation_id FROM aberp_employee_contract WHERE c_bpartner_staff_id = w.c_bpartner_id` | 20 if same zone, 10 if adjacent zone, 5 if different zone |
| 5 | **Response history** | 10 pts | `SELECT aberp_rosteredresponse FROM aberp_rosteredresponselog WHERE aberp_user_contact_id = :workerUserId AND aberp_rostered_shift_id = :shiftId ORDER BY created DESC LIMIT 1` | 10 if previously accepted this shift, 5 if previously requested similar, 0 if declined previously |
| 6 | **Availability pattern** | 20 pts | Check ongoing unavailability `aberp_ongoingunavaildays` for recurring patterns (e.g. "never works Fridays") | 20 if clear, 10 if partial, 0 if recurring unavailability on shift day |

**Total possible:** 100 pts  
**Auto-approve threshold:** Configurable via `rostering_agent_config.auto_approve_threshold` (default: 90)

### 3.4 Hot Failover (Zero Candidates)

When the engine returns zero candidates, the worker logs the event to `rostering_agent_gaps` with:

1. **Identify the dominant blocker:** Which hard rule excluded the most workers?
2. **Capture affected workers:** Record which workers would be eligible if this blocker were removed
3. **Suggest action:** Based on blocker type:
   - `missing_credential` → suggest training
   - `gender_pref` → flag for human review
   - `leave_block` → check if any other workers exist in the system
   - `no_workers_in_zone` → hiring signal
4. **Escalate if critical:** If shift is <4h away → set `escalation_level = 'critical'`


## 4. Admin Portal — Full Specification

### 4.1 Navigation & Layout

The admin portal is the **control centre** for Ross. It has 5 main screens accessible from a sidebar:

```
┌──────────────┬───────────────────────────────────────────────────┐
│              │                                                   │
│  ROSS        │  [Active screen content — see sub-sections below] │
│              │                                                   │
│  ┌────────┐  │                                                   │
│  │ 💬     │  │                                                   │
│  │ DASH-  │  │                                                   │
│  │ BOARD  │  │                                                   │
│  │  (3) 🔴│  │                                                   │
│  ├────────┤  │                                                   │
│  │ ⚙️     │  │                                                   │
│  │ SKILLS │  │                                                   │
│  │        │  │                                                   │
│  ├────────┤  │                                                   │
│  │ 🔧     │  │                                                   │
│  │ CONFIG │  │                                                   │
│  ├────────┤  │                                                   │
│  │ 📋     │  │                                                   │
│  │ AUDIT  │  │                                                   │
│  ├────────┤  │                                                   │
│  │ 🎓     │  │                                                   │
│  │ GAPS   │  │                                                   │
│  └────────┘  │                                                   │
│              │                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

| Icon | Screen | Purpose |
|---|---|---|
| 💬 | **Dashboard** | Chat interface — see Ross's proposals, approve/reject, ask questions |
| ⚙️ | **Skills** | Manage Ross's capabilities — turn skills on/off, define new ones, configure the matrix box |
| 🔧 | **Config** | Global settings — thresholds, scan timing, auto-approve level |
| 📋 | **Audit** | Immutable action log — everything Ross has done |
| 🎓 | **Gaps** | Training gaps, credential watch, hiring signals |

### 4.2 Dashboard (Chat)

*Replaces the former "Admin Chat UI" section. Content unchanged from the chat specification in sections 4.1-4.5 of this document — the chat remains the primary decision surface.*

The Dashboard tab is the default landing page. It contains the three time-horizon sub-tabs (Today / This Period / Next Period), the chat message list, input bar, and sidebar widgets as previously specified.

See sections 4.2 — 4.5 for full tab specifications, component inventory, record panel, and sidebar widget definitions.

### 4.3 Skills Manager

The Skills Manager is where Ross's brain is defined. Each **skill** is a discrete capability: a named, configurable unit of work that Ross can execute.

**Skills list view:**

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚙️ SKILLS MANAGER                             [+ Add Skill]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Filter: [All Skills ▼]  Search: [....................]   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────┬───────────────────┬──────────┬────────┬────────┬──────┐ │
│  │    │ Skill             │ Purpose  │ Status │ Runs   │ Last │ │
│  ├────┼───────────────────┼──────────┼────────┼────────┼──────┤ │
│  │  1 │ Shift Scanner     │ Detect   │ 🟢 On  │ 30m    │ 2m   │ │
│  │    │                   │ unfilled │        │ cron   │ ago  │ │
│  │    │                   │ shifts   │        │        │      │ │
│  ├────┼───────────────────┼──────────┼────────┼────────┼──────┤ │
│  │  2 │ Worker Matching   │ Score &  │ 🟢 On  │ Per    │ 2m   │ │
│  │    │                   │ rank     │        │ scan   │ ago  │ │
│  │    │                   │ workers  │        │        │      │ │
│  ├────┼───────────────────┼──────────┼────────┼────────┼──────┤ │
│  │  3 │ Pathways Message  │ Send     │ 🟢 On  │ On     │ 1m   │ │
│  │    │                   │ Pathways │        │ assign │ ago  │ │
│  │    │                   │ chat     │        │        │      │ │
│  ├────┼───────────────────┼──────────┼────────┼────────┼──────┤ │
│  │  4 │ Gap Detector      │ Log &    │ 🟢 On  │ On     │ 2m   │ │
│  │    │                   │ escalate │        │ fail   │ ago  │ │
│  │    │                   │ no-match │        │        │      │ │
│  ├────┼───────────────────┼──────────┼────────┼────────┼──────┤ │
│  │  5 │ Pre-shift Confirm │ Send     │ 🟢 On  │ 6x/day │ 3h   │ │
│  │    │                   │ confirm  │        │ cron   │ ago  │ │
│  │    │                   │ request  │        │        │      │ │
│  ├────┼───────────────────┼──────────┼────────┼────────┼──────┤ │
│  │  6 │ Swap Handler      │ Detect & │ ⚪ Off │ Manual │ —    │ │
│  │    │                   │ propose  │        │        │      │ │
│  │    │                   │ swaps    │        │        │      │ │
│  ├────┼───────────────────┼──────────┼────────┼────────┼──────┤ │
│  │  7 │ Planner Briefing  │ Daily    │ ⚪ Off │ 4am    │ —    │ │
│  │    │                   │ forecast │        │ cron   │      │ │
│  │    │                   │ report   │        │        │      │ │
│  ├────┼───────────────────┼──────────┼────────┼────────┼──────┤ │
│  │  8 │ Credential Watch  │ Expiry   │ ⚪ Off │ Daily  │ —    │ │
│  │    │                   │ radar    │        │        │      │ │
│  ├────┼───────────────────┼──────────┼────────┼────────┼──────┤ │
│  │  9 │ Leave Replacer    │ Auto-    │ ⚪ Off │ On     │ —    │ │
│  │    │                   │ find     │        │ leave  │      │ │
│  │    │                   │ replace  │        │        │      │ │
│  └────┴───────────────────┴──────────┴────────┴────────┴──────┘ │
│                                                                  │
│  [Rows per page: 20]                                        1-9 │
└─────────────────────────────────────────────────────────────────┘
```

**Toggling a skill:** Click the status badge to cycle 🟢 On → 🟡 Paused → ⚪ Off. Changes take effect immediately — no deploy needed.

**Clicking a skill row:** Opens the skill detail page (see Section 5).

### 4.4 Config

Global settings that apply across all skills:

```
┌─────────────────────────────────────────────────────────────────┐
│  🔧 CONFIGURATION                             [Save Changes]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  SCAN & TIMING                                             │  │
│  │                                                             │  │
│  │  Emergency scan interval         [30]  minutes   ┌──────┐ │  │
│  │  Pre-shift confirm window        [14]  hours     │ Save │ │  │
│  │  Escalation threshold            [4]   hours     └──────┘ │  │
│  │  Planner briefing time           [04:00]                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  MATCHING                                                  │  │
│  │                                                             │  │
│  │  Auto-approve threshold         [90]  %                    │  │
│  │  Max candidates per proposal    [3]                        │  │
│  │  Max proactive offers per day   [3]   per worker           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  NOTIFICATIONS                                             │  │
│  │                                                             │  │
│  │  Notify on auto-assign         [🟢 On]                     │  │
│  │  Notify on gaps                [🟢 On]                     │  │
│  │  Daily briefing to Pathways     [⚪ Off]                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ⚠️ Changes take effect immediately — no restart required.      │
└─────────────────────────────────────────────────────────────────┘
```

### 4.5 Audit Log

All actions logged by Ross, searchable and filterable:

```
┌─────────────────────────────────────────────────────────────────┐
│  📋 AUDIT LOG                        [Export CSV]  [Filter ▼]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Timeframe: [Last 24h ▼]  Skill: [All ▼]  Action: [All]  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────┬──────────┬──────────────┬────────┬──────┬──────────┐ │
│  │ Time │ Skill    │ Action       │ Shift  │ Work │ Approved │ │
│  ├──────┼──────────┼──────────────┼────────┼──────┼──────────┤ │
│  │09:17 │ Worker   │ shift_       │ Ella W │ Emma │ Adam     │ │
│  │      │ Matching │ assigned     │        │ Smith│          │ │
│  ├──────┼──────────┼──────────────┼────────┼──────┼──────────┤ │
│  │09:17 │ Pathways │ message_sent │ Ella W │ Emma │ Auto     │ │
│  │      │ Msg      │              │        │      │          │ │
│  ├──────┼──────────┼──────────────┼────────┼──────┼──────────┤ │
│  │09:15 │ Shift    │ scan_run     │ —      │ —    │ —        │ │
│  │      │ Scanner  │              │        │      │          │ │
│  ├──────┼──────────┼──────────────┼────────┼──────┼──────────┤ │
│  │09:15 │ Gap      │ gap_logged   │ Gaby W │ —    │ —        │ │
│  │      │ Detector │              │        │      │          │ │
│  └──────┴──────────┴──────────────┴────────┴──────┴──────────┘ │
│                                                                  │
│  [< Prev]  Page 1 of 12  [Next >]               1,247 entries   │
│                                                                  │
│  🔗 Every entry is SHA256-chained to its predecessor —          │
│     tamper-evident. Click any row for full details.              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.6 Training Gaps

```
┌─────────────────────────────────────────────────────────────────┐
│  🎓 TRAINING GAPS                          [Resolved] [Unres.]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🔴 Diabetes Training         8 shifts blocked  [Request] │  │
│  │     Emma, Blake, Sam need this  │  💰 $4,800 revenue gap  │  │
│  │     Last raised: 3w ago — no training completed           │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🟡 Manual Handling Refresher   3 shifts blocked  [Request]│  │
│  │     Lucy Chen — expired 2mo ago                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  🟢 CPR Update                 14 workers due in 30d      │  │
│  │  [Bulk Remind]  — will send Pathways message to all 14   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  HIRING SIGNALS                                            │  │
│  │  • Sat PM Northern zone — 14 recurring vacancies           │  │
│  │  • Tue AM City zone — 6 recurring vacancies                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Skills Management — The Ross Brain

### 5.1 What is a Skill

A skill is the atomic unit of Ross's capability. Each skill defines:

| Field | Description | Example |
|---|---|---|
| **Name** | Short identifier | `Worker Matching` |
| **Purpose** | One-line description | `Score and rank eligible workers for a vacant shift` |
| **Status** | On / Paused / Off | 🟢 On |
| **Trigger** | What starts execution | `Per scan` / `Cron: */30 * * *` / `Manual only` |
| **DB/API Access** | Tables and endpoints the skill can read/write | `aberp_rostered_shift (r)`, `aberp_rostered_shiftstaff (w)` |
| **Prompt / Instructions** | Natural language instructions for how Ross should behave | "When matching, first filter by hard rules, then score..." |
| **Rules Matrix** | The configurable rules, weights, and thresholds that tune the skill's behaviour | Table of hard rules (on/off/toggle override) and soft rules (weight sliders) |
| **Response Templates** | How Ross formats the output when reporting results | "🏆 {name} — {score}%. {reason}" |
| **Error Behaviour** | What happens on failure | `Retry 2x then skip` / `Log and escalate` |
| **Dependencies** | What other skills this skill relies on | `Depends on: Shift Scanner` |

### 5.2 Skill Detail Screen

Clicking any skill in the Skills Manager opens its detail page:

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚙️ Skill: Worker Matching          [🟢 Active]  [Run Now]     │
│     Purpose: Score and rank eligible workers for a vacant shift │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 🔌 DATA ACCESS                                             │  │
│  │                                                             │  │
│  │  Read                           │ Write                     │
│  │  ───────────────────────────────┼──────────────────────────  │
│  │  ✓ aberp_rostered_shift         │ ✓ aberp_rostered_shift    │
│  │  ✓ aberp_credentialassignment   │   staff (on approve)      │
│  │  ✓ aberp_unavailability_leave   │ ✓ rostering_agent_propos- │
│  │  ✓ aberp_sr_needs_rules         │   als (write proposals)   │
│  │  ✓ aberp_rostered_shiftstaff    │                           │
│  │  ✓ c_bpartner                   │ [Edit Access]             │
│  │  ✓ hr_employee                  │                           │
│  │  ✓ aberp_employee_contract      │                           │
│  │  ✓ aberp_shift_type             │                           │
│  │  ✗ pathways_chat (use Pathways  │                           │
│  │    Message skill instead)       │                           │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 🧠 PROMPT / INSTRUCTIONS                      [Edit]      │  │
│  │                                                             │  │
│  │ When matching workers to a vacant shift:                   │  │
│  │ 1. Query all active workers for the shift's client         │  │
│  │ 2. Apply hard rules as filters (must pass all)             │  │
│  │ 3. Score remaining candidates using soft rules             │  │
│  │ 4. Sort by score descending, return top 3                  │  │
│  │ 5. If zero pass → trigger Gap Detector skill               │  │
│  │ 6. Report: best match + score + reason for each rule       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ⏱ TRIGGER                                                  │  │
│  │                                                             │  │
│  │  🔘 Cron: [Every scan (30m)]   ┌──────────────────────┐   │  │
│  │                               │ Edit Schedule        │   │  │
│  │  🔘 Manual only               └──────────────────────┘   │  │
│  │  🔘 On event: [Shift Scanner >> completes]                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 📊 RULES MATRIX                                            │  │
│  │                                                             │  │
│  │  HARD RULES (filter — all must pass)                        │  │
│  │  ┌────────────────────────────────────────────────────┐   │  │
│  │  │ Rule                    │ Status │ Override        │   │  │
│  │  ├─────────────────────────┼────────┼─────────────────┤   │  │
│  │  │ 🟢 Not on leave         │ Active │ —               │   │  │
│  │  │ 🟢 All credentials held │ Active │ —               │   │  │
│  │  │ 🟢 No time clash        │ Active │ —               │   │  │
│  │  │ 🟢 Gender preference    │ Active │ ⚡ Can override │   │  │
│  │  │ 🟢 Not excluded         │ Active │ —               │   │  │
│  │  └────────────────────────────────────────────────────┘   │  │
│  │                                                             │  │
│  │  SOFT RULES (scored — drag to reorder, click weight)       │  │
│  │  ┌────────────────────────────────────────────────────┐   │  │
│  │  │ Rule                    │ Weight │ Status          │   │  │
│  │  ├─────────────────────────┼────────┼─────────────────┤   │  │
│  │  │ ≡ Continuity of care    │ [25]   │ 🟢 Active       │   │  │
│  │  │ ≡ Location proximity    │ [20]   │ 🟢 Active       │   │  │
│  │  │ ≡ Availability pattern  │ [20]   │ 🟢 Active       │   │  │
│  │  │ ≡ Contract capacity     │ [15]   │ 🟢 Active       │   │  │
│  │  │ ≡ Transport match       │ [10]   │ 🟢 Active       │   │  │
│  │  │ ≡ Response history      │ [10]   │ ⚪ Off          │   │  │
│  │  └────────────────────────────────────────────────────┘   │  │
│  │                                                             │  │
│  │  Auto-approve threshold: [90] %  Max candidates: [3]       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 🗣️ RESPONSE TEMPLATES                         [Edit]     │  │
│  │                                                             │  │
│  │  Normal:   "🏆 {name} — {score}%. {reason}"                │  │
│  │  No match: "⚠️ No candidates. Blocked by {blocker}."       │  │
│  │  Error:    "❌ {skill} failed: {error}"                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ❗ ERROR BEHAVIOUR                            [Edit]      │  │
│  │                                                             │  │
│  │  DB failure:    Retry 2x → skip scan → log to audit        │  │
│  │  Empty result:  Trigger Gap Detector → continue scan       │  │
│  │  Timeout:       Log error → continue next shift            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 🔗 DEPENDENCIES                              [Edit]      │  │
│  │                                                             │  │
│  │  This skill depends on:                                     │  │
│  │  • Shift Scanner (must have scan results before running)    │  │
│  │                                                             │  │
│  │  Skills that depend on this:                                │  │
│  │  • Pathways Message (called after assignment)               │  │
│  │  • Gap Detector (called when no match found)                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 📜 VERSION HISTORY                                         │  │
│  │  [Current draft]  Last saved: 24 Jul 2026 09:30 by AS     │  │
│  │  [v1.2]  22 Jul 2026 — Adjusted continuity weight 20→25   │  │
│  │  [v1.1]  18 Jul 2026 — Off response_history rule          │  │
│  │  [v1.0]  15 Jul 2026 — Initial definition                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Adding a New Skill — The Matrix Box

When the user clicks [+ Add Skill], a blank skill definition form opens. It is the **same layout as the skill detail screen above** — just empty.

**Mandatory fields** (skill will not run without these):
1. Skill Name
2. Purpose (one line)
3. Data Access (which tables/endpoints)
4. Prompt / Instructions
5. Rules Matrix (at minimum: what success looks like)

**Optional fields**:
- Trigger (defaults to Manual)
- Response Templates (defaults to generic)
- Error Behaviour (defaults to Log Only)
- Dependencies (none by default)

### 5.4 Default Skills Inventory

These skills ship pre-configured with Ross. They can be toggled on/off, modified, or deleted.

| # | Skill | Purpose | Default Status | Trigger |
|---|---|---|---|---|
| 1 | **Shift Scanner** | Detect unfilled shifts in the current horizon | 🟢 On | Cron: */30 * * * * |
| 2 | **Worker Matching** | Score and rank candidates for a vacant shift | 🟢 On | On event: Shift Scanner |
| 3 | **Pathways Message** | Send Pathways chat message to a worker | 🟢 On | On event: Worker Matching |
| 4 | **Gap Detector** | Log no-match events, suggest training needs | 🟢 On | On event: Worker Matching |
| 5 | **Pre-shift Confirm** | Send confirmation request T-14h before shift | 🟢 On | Cron: 0 6,12,18 * * * |
| 6 | **Swap Handler** | Detect swap requests, propose matches | ⚪ Off | Manual |
| 7 | **Planner Briefing** | Daily forecast, fill rates, hiring signals | ⚪ Off | Cron: 0 4 * * * |
| 8 | **Credential Watch** | Expiry radar — workers with certs due soon | ⚪ Off | Cron: 0 5 * * * |
| 9 | **Leave Replacer** | Auto-find replacements when leave is submitted | ⚪ Off | On event: Leave approved |

### 5.5 Draft Mode

Every skill edit goes through a draft cycle:

1. **Edit skill** — changes are saved as a draft. The running skill continues with the previous version.
2. **Review draft** — view changes as a diff against the active version
3. **Publish** — the draft becomes the active skill. It takes effect on the next execution.
4. **Rollback** — revert to any previous version from the version history

This prevents breaking a running skill mid-scan.

### 5.6 Execution & Chaining

Skills are executed in dependency order. The system resolves the chain:

```
Shift Scanner (30m cron)
  → Worker Matching (per shift found)
    → Pathways Message (per match approved or auto-assigned)
    → Gap Detector (per shift with zero candidates)
```

If a skill in the chain is **Off**, downstream skills aren't affected — they just don't receive that event. If Worker Matching is Off, the scan still runs but no proposals are generated.

**Execution visibility:** Each skill run is logged to the audit log with a unique run ID, making it possible to trace: *"Scan #401 → found 3 vacant → ran Worker Matching for each → Gap Detector fired for shift 1000626"*

---

## 6. Backend API — Full Specification

### 6.1 General

- Base URL: `https://{domain}/ross-roster/api/v1` (proxied from `:3002`)
- Auth: `Authorization: Bearer {api_key}` header for all endpoints
- Content-Type: `application/json`
- All timestamps ISO 8601

### 6.2 Endpoints

#### `GET /health`
Returns service health and last scan info.

```json
{
  "status": "ok",
  "uptime": 123456,
  "version": "1.0.0",
  "lastScan": {
    "emergency": "2026-07-24T09:15:00Z",
    "planner": "2026-07-24T04:00:00Z"
  },
  "config": {
    "auto_approve_threshold": 90,
    "scan_interval_minutes": 30
  }
}
```

#### `GET /shifts/vacant`
Returns vacant shifts for a given time horizon.

**Query params:**
| Param | Type | Default | Options |
|---|---|---|---|
| `horizon` | string | `today` | `today`, `period`, `next` |
| `period_start` | ISO date | Computed | Override pay period start |
| `period_end` | ISO date | Computed | Override pay period end |
| `include_assigned` | boolean | false | Include shifts with partial staff |
| `limit` | int | 50 | Max results |

**Response:**
```json
{
  "shifts": [
    {
      "id": 1000626,
      "name": "Ella Williams",
      "documentNo": "1000552",
      "startTime": "2026-07-24T09:00:00",
      "endTime": "2026-07-24T15:00:00",
      "shiftType": "Service Delivery - Direct",
      "location": "42 Smith St, North Sydney",
      "requiredStaff": 1,
      "assignedStaff": 0,
      "receivers": [
        { "id": 100001, "name": "Ella Williams" }
      ],
      "requirements": {
        "credentials": ["Diabetes Training"],
        "gender": null,
        "transport": true
      },
      "status": "vacant",
      "hoursUntilShift": 2.5,
      "urgency": "critical"   // critical (<4h), high (<24h), normal
    }
  ],
  "meta": {
    "totalVacant": 3,
    "totalUrgent": 1,
    "filledRate": 0.93,
    "period": {
      "start": "2026-07-20",
      "end": "2026-08-02"
    }
  }
}
```

#### `GET /shifts/vacant/:shiftId/matches`
Run matching engine for one shift. Returns ranked candidates.

**Response:** See `MatchResult` in section 3.1.

#### `POST /assign`
Create a shift assignment. Writes to `aberp_rostered_shiftstaff` + audit log + Pathways chat.

**Request:**
```json
{
  "shiftId": 1000626,
  "workerId": 1000123,
  "approvedBy": "Adam Sawtell",
  "notes": "Good continuity match, worked with Ella 3x before",
  "isOverride": false,
  "overrideReason": null
}
```

**Response:**
```json
{
  "success": true,
  "assignmentId": 500123,
  "shiftId": 1000626,
  "workerId": 1000123,
  "pathwaysMessageSent": true,
  "auditLogId": 89001,
  "timestamp": "2026-07-24T09:17:05Z"
}
```

**Side effects (atomic):**
1. `INSERT INTO aberp_rostered_shiftstaff (aberp_rostered_shift_id, c_bpartner_staff_id, line, isactive, ...)`
2. `INSERT INTO rostering_agent_audit_log (...)`
3. `INSERT INTO pathways_chat_tables (message from "Rostering Bot" to worker)`

#### `POST /shifts/:shiftId/unassign`
Remove a worker from a shift (cancellation, swap, etc.).

**Request:**
```json
{
  "workerId": 1000123,
  "approvedBy": "Adam Sawtell",
  "reason": "Worker requested swap",
  "autoReassign": true
}
```

**If `autoReassign: true`:** Triggers an immediate matching engine run to find replacement.

#### `GET /proposals/pending`
Returns pending proposals awaiting human review.

**Response:**
```json
{
  "proposals": [
    {
      "id": 1,
      "shiftId": 1000626,
      "shiftName": "Ella Williams",
      "startTime": "2026-07-24T09:00:00",
      "workerId": 1000123,
      "workerName": "Emma Smith",
      "score": 92,
      "isAutoApproved": true,
      "proposedAt": "2026-07-24T09:15:00Z",
      "status": "pending"
    }
  ],
  "pendingCount": 3,
  "autoApprovedToday": 11
}
```

#### `POST /proposals/:id/approve`
Approve a pending proposal.

**Request:**
```json
{
  "approvedBy": "Adam Sawtell",
  "notes": "Good match"
}
```

**Response:** Same as `/assign`.

#### `POST /proposals/:id/reject`
Reject a pending proposal.

**Request:**
```json
{
  "rejectedBy": "Adam Sawtell",
  "reason": "Prefer different worker"
}
```

#### `GET /audit`
Query the audit log.

**Query params:** `limit`, `offset`, `agent_type`, `action`, `since`

#### `GET /gaps`
Query training gaps.

**Query params:** `resolved`, `escalation_level`, `credential_id`

#### `POST /gaps/:id/training-request`
Mark a gap as having a training request sent. Triggers Pathways notification.

**Request:**
```json
{
  "requestedBy": "Adam Sawtell",
  "notes": "Scheduling Diabetes training session for next week"
}
```

#### `POST /gaps/:id/resolve`
Mark a gap as resolved.

**Request:**
```json
{
  "resolvedBy": "Adam Sawtell",
  "resolutionNotes": "Worker completed Diabetes training"
}
```

#### `GET /worker/:workerId/profile`
Returns worker profile data for the record panel.

**Response:**
```json
{
  "workerId": 1000123,
  "name": "Emma Smith",
  "initials": "ES",
  "status": "available",
  "zone": "Northern",
  "contract": { "hoursPerWeek": 20, "usedThisPeriod": 18 },
  "transport": "Car",
  "credentials": [
    { "name": "Diabetes Training", "status": "valid", "expiryDate": "2027-03-15" },
    { "name": "First Aid", "status": "valid", "expiryDate": "2026-12-01" },
    { "name": "NDIS Screening", "status": "valid", "expiryDate": "2027-08-20" }
  ],
  "thisWeekShifts": [
    { "date": "2026-07-27", "client": "Ella Williams", "time": "9am-3pm", "status": "assigned" }
  ],
  "continuityScore": 92,
  "pastAssignments": [
    { "client": "Ella Williams", "count": 3 },
    { "client": "Oliver Williams", "count": 2 }
  ]
}
```

#### `POST /worker/run`
Manually trigger an emergency scan.

#### `GET /stats/period`
Return period-level statistics for the This Period tab.

**Response:**
```json
{
  "fillRate": 84,
  "totalShifts": 50,
  "filledShifts": 42,
  "vacantShifts": 8,
  "urgentShifts": 3,
  "dailyBreakdown": [
    { "date": "2026-07-27", "dayName": "Mon", "fillRate": 68, "urgent": 0 },
    { "date": "2026-07-28", "dayName": "Tue", "fillRate": 80, "urgent": 2 }
  ],
  "trainingGaps": [
    { "credential": "Diabetes Training", "blockedShifts": 8, "affectedWorkers": ["Emma", "Blake", "Sam"] }
  ],
  "credentialExpiry": { "within30Days": 14, "workers": ["Lucy Chen"] },
  "overUsedWorkers": 2,
  "underUsedWorkers": 5
}
```

#### `GET /stats/forecast`
Return next period forecast.

**Response:**
```json
{
  "projectedFillRate": 76,
  "knownLeave": 4,
  "knownVacancies": 14,
  "ifGapsResolvedFillRate": 88,
  "hiringSignals": [
    { "pattern": "Saturday PM Northern zone", "vacancies": 14, "recommendation": "Hire 2 casuals" }
  ]
}
```

---

## 7. Worker Experience — Agent Conversation Flows

### 7.1 Shift Assignment

```
Trigger: Human approves / Auto-approve (score >= threshold)
         ↓
Agent writes aberp_rostered_shiftstaff
         ↓
Agent sends Pathways chat:
  "Emma, you've been rostered for Ella Williams
   Tomorrow 9:00AM — 3:00PM
   42 Smith St, North Sydney · Door code: #1234
   Diabetes cert confirmed ✅

   Tap ✅ to confirm or ❌ if you can't make it."
         ↓
Worker taps ✅:
  Agent logs pre_shift_confirmed in audit
  Shift status updates to "confirmed"
  Worker sees in Schedule tab

Worker taps ❌:
  Agent logs pre_shift_cancelled
  Agent immediately runs re-match
  Agent sends: "No problem, Emma. I'll find a replacement."
  Agent finds replacement, notifies new worker
  Agent notifies admin: "1 auto-replacement for Ella Williams"
```

### 7.2 Pre-shift Check-in

```
Trigger: T-14h before shift (configurable)
         ↓
Agent sends Pathways:
  "Reminder: Ella Williams tomorrow 9am
   📍 42 Smith St, North Sydney
   🚪 Door code: #1234
   ⏰ Please arrive by 8:45am

   Tap ✅ I'm on my way  or  ❌ I can't make it"
         ↓
✅ → Agent logs confirmation
❌ → Same as cancellation flow above
No response by T-2h → Agent escalates to admin:
  "⚠️ Emma hasn't confirmed Ella Williams (9am). 
   No response in 12h. Action needed?"
```

### 7.3 Proactive Shift Offer

```
Trigger: Agent identifies a worker who is an excellent match
         for a vacant shift (score >= 85, not auto-assigned)
         ↓
Agent sends Pathways:
  "Hi Emma, a shift opened up:
   Benjamin James · Tomorrow 2:00PM — 6:00PM
   📍 8/100 Pacific Hwy, Chatswood
   You're a strong match (88%) ✅ Manual Handling ✅

   Tap ✅ to accept or see details"
         ↓
✅ → Agent writes assignment + confirmation
  "You're rostered! See you tomorrow."
❌ → "No problem. I'll offer it to someone else."
```

### 7.4 Swap Request

```
Trigger: Worker messages Pathways:
         "Can I swap my Wednesday with Thursday?"
         ↓
Agent identifies worker's current shifts on both days
         ↓
Agent checks eligibility of swap partner candidates
         ↓
Agent finds Blake Jones (eligible for Wednesday shift,
wants Thursday off — also eligible)
         ↓
Agent sends Pathways to both workers:
  To Emma: "Blake can take your Wednesday (Ella, 9am)
           and you'd take his Thursday (Oliver, 9am).
           Tap ✅ to approve this swap."
  To Blake: "Emma wants to swap Wednesday for Thursday.
             You'd take Wednesday (Ella, 9am) and
             she'd take Thursday (Oliver, 9am).
             Tap ✅ to approve."
         ↓
Both approve → Agent rewrites both assignments,
logs swap_approved in audit, notifies both workers

Either declines → Agent searches for alternatives
```

### 7.5 Leave → Auto-Replacement

```
Trigger: Worker submits leave via PWA → leave processed in iDempiere
         ↓
Agent detects: leave overlaps with rostered shifts
         ↓
Agent runs matching engine for each affected shift
         ↓
Agent auto-assigns replacement (if score >= threshold)
         ↓
Agent notifies original worker:
  "Your leave for Mon 27 has been processed.
   James Park has been assigned to your Ella Williams shift.
   No action needed from you. Enjoy your day off."
         ↓
Agent notifies new worker:
  "James, you've been assigned to Ella Williams
   Mon 27 · 9:00AM — 3:00PM
   42 Smith St, North Sydney
   Tap ✅ to confirm"
         ↓
If no replacement found → agent notifies admin:
  "⚠️ Leave replacement failed for Ella Williams (Mon 27).
   No eligible workers available. Manual intervention needed."
```

### 7.6 Post-Shift Follow-Up

```
Trigger: Shift end time passed (T+1h)
         ↓
Agent sends Pathways:
  "How was your shift with Ella Williams today?
   Tap to reply:
   [All good] [Had some issues] [Need to discuss]"
         ↓
"All good" → Agent logs, no action
"Had some issues" → Agent logs, notifies admin:
  "⚠️ Emma reported issues with Ella Williams shift today.
   Follow up with worker."
```

---

## 8. Matching Engine SQL — Reference Implementations

### 8.1 Get Vacant Shifts

```sql
SELECT 
    s.aberp_rostered_shift_id,
    s.name,
    s.documentno,
    s.startdate + COALESCE(s.starttime, s.startdate::timestamp) AS start_time,
    s.enddate + COALESCE(s.endtime, s.enddate::timestamp) AS end_time,
    st.name AS shift_type,
    s.aberp_masterlocation_id,
    ml.name AS location_name,
    s.aberp_no_of_staff,
    COALESCE(staff_counts.cnt, 0) AS assigned_staff_count,
    s.aberp_num_of_supportreceivers,
    COALESCE(s.aberp_transport_required, 'N') AS transport_required,
    s.r_status_id
FROM adempiere.aberp_rostered_shift s
LEFT JOIN adempiere.aberp_shift_type st ON st.aberp_shift_type_id = s.aberp_shift_type_id
LEFT JOIN adempiere.aberp_masterlocation ml ON ml.aberp_masterlocation_id = s.aberp_masterlocation_id
LEFT JOIN (
    SELECT aberp_rostered_shift_id, COUNT(*) AS cnt
    FROM adempiere.aberp_rostered_shiftstaff
    WHERE isactive = 'Y' AND COALESCE(aberp_declineshift, 'N') = 'N'
    GROUP BY aberp_rostered_shift_id
) staff_counts ON staff_counts.aberp_rostered_shift_id = s.aberp_rostered_shift_id
WHERE s.isactive = 'Y'
  AND COALESCE(s.iscancelled, 'N') = 'N'
  AND COALESCE(s.processed, 'N') = 'N'
  AND s.startdate >= :start_date
  AND s.startdate <= :end_date
  AND (s.aberp_no_of_staff IS NULL OR COALESCE(staff_counts.cnt, 0) < s.aberp_no_of_staff)
ORDER BY s.startdate ASC, s.starttime ASC;
```

### 8.2 Get Required Credentials for a Shift

```sql
SELECT DISTINCT
    rn.aberp_sr_needs_rules_id,
    rn.aberp_credentials_id,
    c.name AS credential_name,
    rn.aberp_needtype,
    rn.aberp_needsassociation,
    rn.aberp_gender_id,
    rn.c_bpartner_id AS sr_bpartner_id
FROM adempiere.aberp_sr_needs_rules rn
JOIN adempiere.aberp_credentials c ON c.aberp_credentials_id = rn.aberp_credentials_id
WHERE rn.isactive = 'Y'
  AND (
    -- Direct shift association
    (rn.aberp_needsassociation = 'RS' AND rn.aberp_rostered_shift_id = :shift_id)
    -- OR support receiver association (via shiftreceiver)
    OR (rn.aberp_needsassociation = 'SR' AND rn.c_bpartner_id IN (
        SELECT sr.c_bpartner_id 
        FROM adempiere.aberp_rostered_shiftreceiver sr
        WHERE sr.aberp_rostered_shift_id = :shift_id AND sr.isactive = 'Y'
    ))
    -- OR location association (via masterlocation)
    OR (rn.aberp_needsassociation = 'LOC' AND rn.aberp_support_location_id IN (
        SELECT l.aberp_support_location_id
        FROM adempiere.aberp_rostered_shift s
        JOIN adempiere.aberp_support_location l ON l.c_bpartner_location_id = s.aberp_masterlocation_id
        WHERE s.aberp_rostered_shift_id = :shift_id
    ))
  );
```

### 8.3 Get Eligible Workers (Hard Rules)

```sql
WITH shift_info AS (
    SELECT 
        s.aberp_rostered_shift_id,
        s.startdate,
        COALESCE(s.starttime, '00:00:00'::time) AS starttime,
        COALESCE(s.endtime, '23:59:59'::time) AS endtime,
        s.aberp_masterlocation_id,
        s.aberp_transport_required
    FROM adempiere.aberp_rostered_shift s
    WHERE s.aberp_rostered_shift_id = :shift_id
),
required_credentials AS (
    -- Same query as 7.2
),
potential_workers AS (
    SELECT DISTINCT 
        bp.c_bpartner_id AS worker_id,
        bp.name AS worker_name,
        bp.ad_user_id
    FROM adempiere.c_bpartner bp
    JOIN adempiere.aberp_credentialassignment ca ON ca.c_bpartner_staff_id = bp.c_bpartner_id
    JOIN adempiere.aberp_employee_contract ec ON ec.c_bpartner_staff_id = bp.c_bpartner_id
    WHERE bp.isactive = 'Y'
      AND ca.isactive = 'Y'
      AND ec.isactive = 'Y'
)
SELECT 
    pw.worker_id,
    pw.worker_name,
    -- Check each hard rule
    CASE WHEN NOT EXISTS (
        SELECT 1 FROM adempiere.aberp_unavailability_leave ul
        WHERE ul.c_bpartner_staff_id = pw.worker_id
          AND ul.startdate <= (SELECT startdate FROM shift_info)
          AND ul.enddate >= (SELECT startdate FROM shift_info)
          AND ul.isactive = 'Y' AND COALESCE(ul.processed,'N')='Y'
    ) THEN 'PASS' ELSE 'FAIL' END AS rule_leave,
    
    CASE WHEN NOT EXISTS (
        SELECT 1 FROM adempiere.aberp_rostered_shiftstaff ss
        JOIN adempiere.aberp_rostered_shift s2 ON s2.aberp_rostered_shift_id = ss.aberp_rostered_shift_id
        WHERE ss.c_bpartner_staff_id = pw.worker_id
          AND ss.isactive = 'Y'
          AND COALESCE(s2.iscancelled,'N') = 'N'
          AND s2.startdate = (SELECT startdate FROM shift_info)
          AND (s2.starttime, s2.endtime) OVERLAPS (
              (SELECT starttime FROM shift_info),
              (SELECT endtime FROM shift_info)
          )
    ) THEN 'PASS' ELSE 'FAIL' END AS rule_clash,
    
    CASE WHEN COALESCE((
        SELECT hr.hr_exclude FROM adempiere.hr_employee hr 
        WHERE hr.c_bpartner_id = pw.worker_id
    ), 'N') != 'Y' THEN 'PASS' ELSE 'FAIL' END AS rule_excluded
    
FROM potential_workers pw
WHERE ...
```

### 8.4 Pathways Chat Message Writer

```sql
-- Insert into the Pathways response log (maps to PWA Chat tab)
INSERT INTO adempiere.aberp_rosteredresponselog (
    ad_client_id,
    ad_org_id,
    aberp_rosteredresponselog_uu,
    created,
    createdby,
    isactive,
    updated,
    updatedby,
    aberp_user_contact_id,
    aberp_rosteredresponse,
    aberp_rostered_shift_id,
    issuperseded,
    isreviewed,
    aberp_acceptshiftrequest
) VALUES (
    1000002,                                                           -- AbilityERP ad_client_id
    0,
    gen_random_uuid()::varchar,
    NOW(),
    100,                                                               -- System user
    'Y',
    NOW(),
    100,
    :worker_ad_user_id,                                                -- Worker's AD_User ID
    'MSG',                                                             -- Message type
    :shift_id,
    'N',
    'Y',
    NULL
);

-- Also write to the requests chat table for threaded conversation
INSERT INTO adempiere.aberp_request_message (
    -- ... (structure depends on existing chat implementation)
);
```

---

## 9. Background Workers

### 9.1 Emergency Rosterer (`worker/emergency.ts`)

```
Schedule: Every 30 minutes via node-cron

On each tick:
  1. Query vacant shifts (next 48h, sorted by start time ASC)
  2. For each shift:
     a. Run matching engine
     b. If candidates found:
        - If best score >= auto_approve_threshold:
          → Auto-assign (write shiftstaff + audit + Pathways)
        - Else:
          → Write proposal to rostering_agent_proposals
     c. If no candidates:
        - Run hot failover (identify blocker, log gap)
        - If escalation_level = 'critical':
          → Send alert to admin Pathways chat
  3. Log scan completion to audit (action: 'scan_run')
  4. Emit WebSocket event (or SSE) to admin UI for refresh

On-demand trigger: POST /worker/run does the same immediately
```

### 9.2 Workforce Planner (`worker/planner.ts`)

```
Schedule: Daily at 4:00AM via node-cron

On each tick:
  1. Compute period-level fill rate (this period vs last period)
  2. Aggregate training gaps by credential
  3. Scan credential expiry (7/14/30 day windows)
  4. Detect hiring signals (recurring zone/time gaps)
  5. Detect over/under-utilisation
  6. Compute next-period forecast
  7. Write daily summary to audit (action: 'daily_plan')
  8. Send briefing to admin Pathways chat:
     "📊 Daily Planner Briefing
      Fill rate: 84% (3 vacant urgent)
      Training gaps: Diabetes blocks 8 shifts
      Credential expiry: 14 workers due in 30d
      Hiring signal: Sat PM Northern zone (14 vacancies)
      
      Recommendations:
      1. Schedule Diabetes training for Blake, Sam, Emma
      2. Approve 2 casuals for Sat PM Northern
      3. Bulk remind 5 workers on NDIS check renewal"
```

---

## 10. Build Phases & Exit Criteria

### 10.1 Phase 1: Foundation (Week 1-2)

| Session | Content | Lines of code (est.) | Exit criterion |
|---|---|---|---|
| 1a | Express skeleton, DB pool, config table, audit table, routes | ~500 | `GET /health` returns OK |
| 1b | Matching engine (hard rules SQL + soft scoring) | ~800 | Engine returns correct matches for any real shift |
| 1c | Emergency Rosterer cron + hot failover + gap logging | ~400 | Agent runs unattended, logs to audit + gaps |
| 1d | Pathways chat writer | ~200 | Agent can send Pathways messages to workers |

**Phase 1 exit:** Agent scans shifts, finds matches, logs everything. No UI yet. Can verify via DB queries.

### 10.2 Phase 2: Admin UI (Week 3-4)

| 2a | Amplify app + tabbed layout + chat bubble components | ~800 | Chat messages visible in browser |
|---|---|---|---|
| 2b | Approve/Reject/Alternates + proposal table reads | ~400 | End-to-end: approve → DB write → Pathways msg |
| 2c | No-match cards + hot failover display + escalation | ~300 | Gap items visible in UI |
| 2d | Sidebar widgets (Today's shifts, Stats, Activity) | ~400 | All sidebar data populated |

**Phase 2 exit:** Admin can see proposals, approve/reject, see gaps. Full chat flow works.

### 10.3 Phase 3: Value Features (Week 5-6)

| 3a | Auto-pilot threshold + bulk approve + summary | ~300 | Safe matches auto-assign, human sees only exceptions |
|---|---|---|---|
| 3b | Pre-shift confirmation timer + worker chat flow | ~400 | Workers receive confirm requests, responses handled |
| 3c | Swap management + Pathways detection | ~500 | Swap requests detected, proposed, executed |
| 3d | Record panel (shift + worker detail via slide-in) | ~400 | Click any name → full details |
| 3e | Coverage heatmap | ~300 | Visual heatmap in sidebar |

**Phase 3 exit:** All features operational. Admin handles only exceptions.

### 10.4 Phase 4: Planner & Reports (Week 7-8)

| 4a | Workforce Planner reports in This Period tab | ~500 | Daily briefing, fill rates, gap aggregation |
|---|---|---|---|
| 4b | Training gaps tab + Request Training button | ~300 | Gaps visible, training requests trigger Pathways |
| 4c | Credential watch + bulk remind | ~200 | Expiry radar visible, bulk remind sends Pathways |
| 4d | Next Period forecast tab | ~300 | Forecast data visible |
| 4e | Audit log tab + export | ~200 | Full audit trail viewable and exportable |

**Phase 4 exit:** Both agents fully operational. All tabs functional.

---

## 11. Environment & Deployment

### 11.1 EC2 Setup (54.206.8.250)

```bash
# Application directory
sudo mkdir -p /opt/ross-roster
sudo chown ubuntu:ubuntu /opt/ross-roster

# Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 for process management
sudo npm install -g pm2

# Environment file
cat > /opt/ross-roster/.env << 'EOF'
PORT=3002
NODE_ENV=production
DB_HOST=localhost
DB_PORT=5432
DB_NAME=idempiere
DB_USER=adempiere
DB_PASSWORD=flamingo
DB_SCHEMA=adempiere
ROSTER_BOT_API_KEY=<generate-uuid>
AUTO_APPROVE_THRESHOLD=90
SCAN_INTERVAL_MINUTES=30
EOF

# PM2 config
pm2 start /opt/ross-roster/dist/index.js --name ross-roster
pm2 save
pm2 startup
```

### 11.2 Nginx Reverse Proxy

```nginx
# /etc/nginx/sites-available/ross-roster
location /ross-roster/ {
    proxy_pass http://localhost:3002/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 11.3 Amplify Setup

- New Amplify app (separate from the worker PWA)
- Connected to new GitHub repo (e.g. `ability-erp-ross-roster`)
- Build settings: `npx next build && npx next export`
- Environment variables:
  - `NEXT_PUBLIC_API_URL`: `https://{domain}/ross-roster/api/v1`
  - `API_KEY`: matches `ROSTER_BOT_API_KEY` on EC2

### 11.4 Database Migration

New tables (`rostering_agent_config`, `rostering_agent_audit_log`, `rostering_agent_gaps`, `rostering_agent_proposals`) will be created via a migration script executed against the iDempiere database. These tables do not require AD (Application Dictionary) registration because they are internal to the agent service, not iDempiere UI windows.

---

## 12. Appendices

### 12.1 Terms & Acronyms

| Term | Meaning |
|---|---|
| PWA | Progressive Web App — the existing worker app (AbilityERP) |
| Pathways | In-app chat system used for worker↔rostering communication |
| SR | Support Receiver (NDIS participant) |
| RS | Rostered Shift |
| LOC | Location |
| REQ | Worker Requested the shift |
| DEC | Worker Declined the shift |

### 12.2 Related SAW Tickets

| Ticket | Feature | Relationship |
|---|---|---|
| SAW039 | Support Locations | Agent attaches access codes/rooms/alerts to assignments |
| SAW037 | Fewer Taps: home=Schedule | Agent populates Schedule directly |
| SAW038 | Client Shift Essentials | Agent can attach shift briefing data |

### 12.3 Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Agent assigns wrong worker | Low | High | Human-in-loop for all assignments; auto-approve only above 90% score |
| Pathways chat flooding workers | Medium | Medium | Rate-limit: max 3 proactive offers per worker per day |
| DB connection pool exhaustion | Low | High | Pool max 10 connections; monitor via health endpoint |
| Duplicate assignments (race condition) | Low | High | DB-level unique constraint on (shift_id, worker_id) for active assignments |
| Audit log growth | High | Low | Monthly partitioning on `rostering_agent_audit_log`; 5 year retention |
