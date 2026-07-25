#!/usr/bin/env bash
set -euo pipefail
sudo -u postgres psql -d idempiere -c "\d adempiere.rostering_agent_proposals"
sudo -u postgres psql -d idempiere -c "\d adempiere.rostering_agent_gaps"
sudo -u postgres psql -d idempiere -c "\d adempiere.aberp_rostered_shiftstaff" | head -80
sudo -u postgres psql -d idempiere -tAc "
SELECT column_name FROM information_schema.columns
WHERE table_schema='adempiere' AND table_name='aberp_rostered_shiftstaff'
  AND column_name ILIKE '%vacant%' OR (table_schema='adempiere' AND table_name='aberp_rostered_shiftstaff' AND column_name ILIKE '%request%')
ORDER BY 1;
"
sudo -u postgres psql -d idempiere -tAc "
SELECT s.aberp_rostered_shift_id, left(s.name,40), coalesce(s.starttime,s.startdate),
       s.aberp_no_of_staff,
       (SELECT count(*) FROM adempiere.aberp_rostered_shiftstaff ss
        WHERE ss.aberp_rostered_shift_id=s.aberp_rostered_shift_id AND ss.isactive='Y'
          AND ss.c_bpartner_staff_id IS NOT NULL
          AND coalesce(ss.aberp_requestshift,'N')<>'Y'
          AND coalesce(ss.aberp_declineshift,'N')<>'Y') AS assigned
FROM adempiere.aberp_rostered_shift s
WHERE s.isactive='Y' AND coalesce(s.iscancelled,'N')='N'
  AND coalesce(s.starttime,s.startdate) >= NOW()
  AND coalesce(s.starttime,s.startdate) < NOW() + interval '14 days'
ORDER BY 3 LIMIT 8;
"
