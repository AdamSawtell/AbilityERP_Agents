# SAW055 — ShiftStaff trigger schema qualify

**Kind:** both (ERP DB trigger + Ross Accept path)  
**Status:** done (applied EC2 2026-07-26)

## Problem

Ross `Accept & assign` failed with `relation "ad_user" does not exist` because trigger `aberp_shiftstaff_sync_bp_from_contact` used bare `ad_user`, and `ross_agent` has `search_path = "$user", public`.

## Fix

`CREATE OR REPLACE` both ShiftStaff sync functions with `adempiere.` qualifiers + `SET search_path TO adempiere, public`.

## Apply

See [DEPLOY.md](./DEPLOY.md).
