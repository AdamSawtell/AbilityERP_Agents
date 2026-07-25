-- SAW055 — Schema-qualify ShiftStaff sync triggers for non-adempiere DB roles
-- (e.g. ross_agent search_path = "$user", public). Bare `ad_user` / `aberp_rostered_shift`
-- fail at runtime: relation "ad_user" does not exist.
-- Safe / idempotent CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION adempiere.aberp_shiftstaff_sync_bp_from_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO adempiere, public
AS $$
DECLARE
  v_bp NUMERIC;
BEGIN
  IF NEW.aberp_user_contact_id IS NOT NULL AND NEW.aberp_user_contact_id > 0 THEN
    IF TG_OP = 'INSERT'
       OR NEW.aberp_user_contact_id IS DISTINCT FROM OLD.aberp_user_contact_id
       OR COALESCE(NEW.c_bpartner_staff_id, 0) <= 0 THEN
      SELECT u.c_bpartner_id INTO v_bp
      FROM adempiere.ad_user u
      WHERE u.ad_user_id = NEW.aberp_user_contact_id;
      IF v_bp IS NOT NULL AND v_bp > 0 THEN
        NEW.c_bpartner_staff_id := v_bp;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION adempiere.aberp_shiftstaff_sync_org_from_shift()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO adempiere, public
AS $$
DECLARE
  v_org NUMERIC;
BEGIN
  IF COALESCE(NEW.ad_org_id, 0) > 0 THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.aberp_rostered_shift_id, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  SELECT s.ad_org_id INTO v_org
  FROM adempiere.aberp_rostered_shift s
  WHERE s.aberp_rostered_shift_id = NEW.aberp_rostered_shift_id;
  IF COALESCE(v_org, 0) > 0 THEN
    NEW.ad_org_id := v_org;
  END IF;
  RETURN NEW;
END;
$$;
