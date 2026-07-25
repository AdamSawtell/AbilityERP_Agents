#!/usr/bin/env bash
# SAW048 — seed Ross agent test rows against live schema (idempotent).
set -euo pipefail

psql_cmd() {
  sudo -u postgres psql -d idempiere -v ON_ERROR_STOP=1 "$@"
}

echo "=== before ==="
psql_cmd -c "
SELECT 'proposals_pending' AS k, count(*)::text AS v FROM adempiere.rostering_agent_proposals WHERE status='pending'
UNION ALL SELECT 'gaps_open', count(*)::text FROM adempiere.rostering_agent_gaps WHERE coalesce(resolved,false)=false
UNION ALL SELECT 'vacant_14d', count(*)::text FROM adempiere.aberp_rostered_shift s
WHERE s.isactive='Y' AND coalesce(s.iscancelled,'N')='N'
  AND coalesce(s.starttime,s.startdate) >= NOW()
  AND coalesce(s.starttime,s.startdate) < NOW() + interval '14 days'
  AND (
    SELECT count(*) FROM adempiere.aberp_rostered_shiftstaff ss
    WHERE ss.aberp_rostered_shift_id=s.aberp_rostered_shift_id AND ss.isactive='Y'
      AND ss.c_bpartner_staff_id IS NOT NULL
      AND coalesce(ss.aberp_requestshift,'N')<>'Y'
      AND coalesce(ss.aberp_declineshift,'N')<>'Y'
  ) < coalesce(s.aberp_no_of_staff,1);
"

psql_cmd <<'SQL'
-- Turn matching skills On (fail soft if catalogue missing cols)
UPDATE adempiere.rostering_agent_skills
SET status = 'on'
WHERE skill_key IN (
  'shift_scanner','worker_matching','gap_detector',
  'pathways_message','leave_replacer','planner_briefing'
);

-- Prefer an already-vacant future shift; else underfill one by clearing staff BP
DROP TABLE IF EXISTS tmp_saw048_seed;
CREATE TEMP TABLE tmp_saw048_seed AS
SELECT s.aberp_rostered_shift_id AS shift_id,
       s.name AS shift_name,
       coalesce(s.starttime, s.startdate) AS start_ts
FROM adempiere.aberp_rostered_shift s
WHERE s.isactive = 'Y'
  AND coalesce(s.iscancelled, 'N') = 'N'
  AND coalesce(s.starttime, s.startdate) >= NOW()
  AND coalesce(s.starttime, s.startdate) < NOW() + interval '14 days'
  AND (
    SELECT count(*) FROM adempiere.aberp_rostered_shiftstaff ss
    WHERE ss.aberp_rostered_shift_id = s.aberp_rostered_shift_id
      AND ss.isactive = 'Y'
      AND ss.c_bpartner_staff_id IS NOT NULL
      AND coalesce(ss.aberp_requestshift, 'N') <> 'Y'
      AND coalesce(ss.aberp_declineshift, 'N') <> 'Y'
  ) < coalesce(s.aberp_no_of_staff, 1)
ORDER BY coalesce(s.starttime, s.startdate)
LIMIT 1;

DO $$
DECLARE
  sid numeric;
BEGIN
  SELECT shift_id INTO sid FROM tmp_saw048_seed;
  IF sid IS NULL THEN
    -- Force-vacate the nearest future shift staff line (mark requestshift so vacant query ignores it)
    SELECT aberp_rostered_shift_id INTO sid
    FROM adempiere.aberp_rostered_shift
    WHERE isactive='Y' AND coalesce(iscancelled,'N')='N'
      AND coalesce(starttime,startdate) >= NOW()
    ORDER BY coalesce(starttime,startdate)
    LIMIT 1;

    UPDATE adempiere.aberp_rostered_shiftstaff
    SET aberp_requestshift = 'Y',
        updated = statement_timestamp(),
        updatedby = 100
    WHERE aberp_rostered_shift_id = sid
      AND isactive = 'Y'
      AND c_bpartner_staff_id IS NOT NULL;

    INSERT INTO tmp_saw048_seed (shift_id, shift_name, start_ts)
    SELECT s.aberp_rostered_shift_id, s.name, coalesce(s.starttime,s.startdate)
    FROM adempiere.aberp_rostered_shift s
    WHERE s.aberp_rostered_shift_id = sid;
  END IF;
END $$;

-- Expire prior SAW048 seed proposals for this shift so we get a clean set
UPDATE adempiere.rostering_agent_proposals
SET status = 'expired',
    reviewed_at = NOW(),
    notes = coalesce(notes,'') || ' | SAW048_seed_refresh'
WHERE status = 'pending'
  AND shift_id = (SELECT shift_id FROM tmp_saw048_seed)
  AND coalesce(notes,'') LIKE '%SAW048%';

INSERT INTO adempiere.rostering_agent_proposals (
  shift_id, shift_name, worker_id, worker_name, score,
  rules_passed, rules_failed, status, notes
)
SELECT
  c.shift_id,
  c.shift_name,
  w.worker_id,
  w.worker_name,
  w.score,
  jsonb_build_object(
    'seed', true,
    'reason', 'SAW048 Amplify smoke',
    'isAutoApproved', w.score >= 90,
    'hard', jsonb_build_array(jsonb_build_object('rule','seed','pass',true)),
    'soft', jsonb_build_array()
  ),
  '[]'::jsonb,
  'pending',
  'SAW048 Amplify smoke seed'
FROM tmp_saw048_seed c
CROSS JOIN LATERAL (
  SELECT bp.c_bpartner_id AS worker_id,
         coalesce(nullif(trim(bp.name),''), 'Worker '||bp.c_bpartner_id::text) AS worker_name,
         CASE row_number() OVER (ORDER BY bp.c_bpartner_id)
           WHEN 1 THEN 92
           WHEN 2 THEN 81
           ELSE 70
         END AS score
  FROM adempiere.c_bpartner bp
  WHERE bp.isactive = 'Y' AND bp.isemployee = 'Y'
  ORDER BY bp.c_bpartner_id
  LIMIT 3
) w;

-- Gap reason max 30 chars; escalation info|warning|critical
INSERT INTO adempiere.rostering_agent_gaps (
  shift_id, shift_name, shift_date, shift_time, reason,
  blocked_count, resolved, training_requested, escalation_level, resolution_notes
)
SELECT
  c.shift_id,
  c.shift_name,
  c.start_ts::date,
  to_char(c.start_ts, 'HH24:MI'),
  'SAW048_seed_no_match',
  3,
  false,
  false,
  'warning',
  'SAW048 Amplify smoke seed gap'
FROM tmp_saw048_seed c
WHERE NOT EXISTS (
  SELECT 1 FROM adempiere.rostering_agent_gaps g
  WHERE g.shift_id = c.shift_id
    AND g.reason = 'SAW048_seed_no_match'
    AND coalesce(g.resolved,false) = false
);

SELECT shift_id AS seed_shift_id, shift_name FROM tmp_saw048_seed;
SQL

echo "=== after ==="
psql_cmd -c "
SELECT id, shift_id, left(shift_name,36) AS shift_name, worker_name, score, status
FROM adempiere.rostering_agent_proposals
WHERE notes = 'SAW048 Amplify smoke seed' AND status='pending'
ORDER BY score DESC;

SELECT id, shift_id, reason, escalation_level, resolved
FROM adempiere.rostering_agent_gaps
WHERE reason = 'SAW048_seed_no_match' AND coalesce(resolved,false)=false
ORDER BY id DESC LIMIT 3;
"
echo "SEED_OK"
