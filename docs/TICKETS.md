# AbilityERP Agents — ticket index

Canonical SAW### registry: [AbilityERP Mobile APP `docs/TICKETS.md`](https://github.com/AdamSawtell/AbilityERP_Mobile_APP/blob/main/docs/TICKETS.md).

| ID | Slug | Kind | Description | Status | Repo home |
|----|------|------|-------------|--------|-----------|
| SAW042 | `ross_roster_phase1` | app | Ross Phase 1 foundation (Express :3002) | done | [#1](https://github.com/AdamSawtell/AbilityERP_Agents/issues/1) · [`ross-roster/`](../ross-roster/) |
| SAW043 | `ross_admin_ui` | app | Ross admin UI Phase 2 (Next.js :3003) | done | [#2](https://github.com/AdamSawtell/AbilityERP_Agents/issues/2) · [`admin-ui/`](../admin-ui/) · [PHASE-2-CONTRACT](./PHASE-2-CONTRACT.md) |
| SAW044 | `ross_phase3` | app | Ross Phase 3 value features (auto-pilot first; no Entra) | done | [#3](https://github.com/AdamSawtell/AbilityERP_Agents/issues/3) · [PHASE-3-CONTRACT](./PHASE-3-CONTRACT.md) |
| SAW045 | `ross_phase4` | app | Ross Phase 4 planner & reports (4a–4e; no Entra) | done | [#4](https://github.com/AdamSawtell/AbilityERP_Agents/issues/4) · [PHASE-4-CONTRACT](./PHASE-4-CONTRACT.md) |
| SAW046 | `ross_skills_manager` | app | Ross Phase 5 Skills Manager (toggle + runtime gating; no Entra) | done | [#5](https://github.com/AdamSawtell/AbilityERP_Agents/issues/5) · [PHASE-5-CONTRACT](./PHASE-5-CONTRACT.md) |
| SAW047 | `ross_leave_replacer` | app | Ross Phase 6 Leave Replacer (vacate + match; no Entra) | done | [#6](https://github.com/AdamSawtell/AbilityERP_Agents/issues/6) · [PHASE-6-CONTRACT](./PHASE-6-CONTRACT.md) |
| SAW048 | `ross_amplify_migrate` | app | Ross → Amplify: Next.js API + lib from Express; remote PG; EventBridge cron scripts | done | [#7](https://github.com/AdamSawtell/AbilityERP_Agents/issues/7) · [MIGRATE-TO-AMPLIFY](./MIGRATE-TO-AMPLIFY.md) · [PHASE-7-CONTRACT](./PHASE-7-CONTRACT.md) · EC2 PM2 `ross-*` stopped 2026-07-26 (Amplify primary) |
| SAW049 | `roster_rules_framework` | app | Configurable roster matching rules (AbilityAPP AB-0046 pattern): DB + API + Rules UI + matcher wiring | done | [#8](https://github.com/AdamSawtell/AbilityERP_Agents/issues/8) · `admin-ui/lib/engine/rosterRules.ts` · migration `007_roster_rules.sql` |
| SAW050 | `proposal_card_ux` | app | Proposal cards: readable when/where/client + human match reasons | done | [#9](https://github.com/AdamSawtell/AbilityERP_Agents/issues/9) · `admin-ui/components/DashboardClient.tsx` |
| SAW051 | `erp_shift_deeplink` | app | Hyperlink proposals/shift panel to iDempiere Shift (Rostered) via Zoom URL | done | [#10](https://github.com/AdamSawtell/AbilityERP_Agents/issues/10) · `admin-ui/lib/idempiere/zoom.ts` |
| SAW052 | `response_log_queue` | app | Review AbilityERP REQ/DEC via IsResponseLogReviewRequired + IsReviewed; Responses UI + scan cycle | done | [#11](https://github.com/AdamSawtell/AbilityERP_Agents/issues/11) · `admin-ui/lib/services/responseReviews.ts` |
| SAW053 | `bugbot_hardening` | app | Gate BFF mutations; ROSTER_BOT_API_KEY alias; fix vacant horizon today/period/next | done | [#12](https://github.com/AdamSawtell/AbilityERP_Agents/issues/12) · `admin-ui/middleware.ts` |
| SAW054 | `eventbridge_cron` | app | EventBridge Scheduler → Lambda → Amplify cron POSTs (worker/leave/planner) after EC2 PM2 cutover | done | [#13](https://github.com/AdamSawtell/AbilityERP_Agents/issues/13) · [EVENTBRIDGE-CRON](./EVENTBRIDGE-CRON.md) · `admin-ui/scripts/aws/` |
| SAW055 | `shiftstaff_trigger_schema` | both | Qualify ShiftStaff sync triggers so `ross_agent` Accept & assign works (bare `ad_user` broke) | done | [#14](https://github.com/AdamSawtell/AbilityERP_Agents/issues/14) · [Tickets/SAW055…](../Tickets/SAW055_shiftstaff_trigger_schema/) |
| SAW056 | `bff_actor_defaults` | app | Default REVIEWER_NAME/admin-ui on Confirms/Gaps/Swaps/Credentials/Config BFF mutations (fix invalid_body) | in-progress | [#15](https://github.com/AdamSawtell/AbilityERP_Agents/issues/15) · `admin-ui/lib/actor.ts` |
