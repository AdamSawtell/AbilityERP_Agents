#!/usr/bin/env bash
set -euo pipefail
sudo -u postgres psql -d idempiere -c '\dn'
sudo -u postgres psql -d idempiere -tAc "SELECT nspname FROM pg_namespace ORDER BY 1;"
echo '--- env ---'
if [[ -f /opt/ross-roster/.env ]]; then
  sudo grep -E '^(DB_|PG)' /opt/ross-roster/.env | sed 's/PASSWORD=.*/PASSWORD=***/'
fi
echo '--- sample tables ---'
sudo -u postgres psql -d idempiere -tAc "SELECT schemaname||'.'||tablename FROM pg_tables WHERE tablename ILIKE '%roster%' OR tablename ILIKE '%agent%' LIMIT 30;"
