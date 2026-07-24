#!/usr/bin/env bash
set -euo pipefail

sudo mkdir -p /opt/ross-roster
sudo chown ubuntu:ubuntu /opt/ross-roster

rm -rf /tmp/AbilityERP_Agents
git clone --depth 1 https://github.com/AdamSawtell/AbilityERP_Agents.git /tmp/AbilityERP_Agents
rsync -a --delete --exclude node_modules --exclude dist --exclude .env /tmp/AbilityERP_Agents/ross-roster/ /opt/ross-roster/
rm -rf /tmp/AbilityERP_Agents

cd /opt/ross-roster

if [ ! -f .env ]; then
  API_KEY=$(uuidgen)
  cat > .env <<EOF
PORT=3002
NODE_ENV=production
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=idempiere
DB_USER=adempiere
DB_PASSWORD=flamingo
DB_SCHEMA=adempiere
DB_POOL_MAX=10
ROSTER_BOT_API_KEY=$API_KEY
CORS_ORIGINS=
AUTO_APPROVE_THRESHOLD=90
SCAN_INTERVAL_MINUTES=30
PRE_SHIFT_CONFIRM_HOURS=14
ESCALATION_HOURS_BEFORE_SHIFT=4
EOF
  echo "Created .env with new API key"
else
  echo "Keeping existing .env"
fi

npm ci
npm run build
npm run migrate
pm2 delete ross-roster >/dev/null 2>&1 || true
pm2 start dist/index.js --name ross-roster --cwd /opt/ross-roster
pm2 save
sleep 2

echo "=== HEALTH ==="
curl -s http://127.0.0.1:3002/health
echo
# shellcheck disable=SC1091
source .env
echo "=== VACANT ==="
curl -s -H "Authorization: Bearer $ROSTER_BOT_API_KEY" "http://127.0.0.1:3002/api/v1/shifts/vacant?horizon=period&limit=5"
echo
FIRST=$(curl -s -H "Authorization: Bearer $ROSTER_BOT_API_KEY" "http://127.0.0.1:3002/api/v1/shifts/vacant?horizon=period&limit=1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['shifts'][0]['id'] if d.get('shifts') else '')")
echo "FIRST=$FIRST"
if [ -n "$FIRST" ]; then
  echo "=== MATCHES ==="
  curl -s -H "Authorization: Bearer $ROSTER_BOT_API_KEY" "http://127.0.0.1:3002/api/v1/shifts/vacant/$FIRST/matches"
  echo
fi
pm2 list | grep ross || true
