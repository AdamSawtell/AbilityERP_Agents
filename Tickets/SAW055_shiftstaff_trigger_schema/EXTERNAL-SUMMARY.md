## Done
Fixed ShiftStaff assign triggers so non-adempiere DB users (Ross agent) can accept worker REQ responses without SQL errors.

## Changed
PostgreSQL functions `aberp_shiftstaff_sync_bp_from_contact` and `aberp_shiftstaff_sync_org_from_shift` now use schema-qualified table names and a fixed `search_path`.

## Impact
Ross **Accept & assign** (and any other assign path that stamps `aberp_user_contact_id` on ShiftStaff) works when connecting as `ross_agent`. iDempiere WebUI behaviour unchanged.

## Test
1. Open Ross Responses with an open REQ that has vacant slots.
2. Click **Accept & assign** — expect success, worker on shift, log IsReviewed=Y.
3. Confirm no `relation "ad_user" does not exist` error.

## Admin access
N/A — no new windows/processes.
