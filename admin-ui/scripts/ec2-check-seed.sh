#!/usr/bin/env bash
set -euo pipefail
sudo -u postgres psql -d idempiere -c \
  "SELECT id, shift_id, worker_name, score, status, substring(notes from 1 for 40) AS notes
   FROM adempiere.rostering_agent_proposals
   WHERE shift_id = 1000627
   ORDER BY id DESC LIMIT 10;"
