#!/usr/bin/env bash
set -euo pipefail

sudo mkdir -p /opt/ross-admin
sudo chown ubuntu:ubuntu /opt/ross-admin

rm -rf /tmp/AbilityERP_Agents
git clone --depth 1 https://github.com/AdamSawtell/AbilityERP_Agents.git /tmp/AbilityERP_Agents
rsync -a --delete --exclude node_modules --exclude .next --exclude .env /tmp/AbilityERP_Agents/admin-ui/ /opt/ross-admin/
rm -rf /tmp/AbilityERP_Agents

cd /opt/ross-admin

if [ ! -f .env ]; then
  # shellcheck disable=SC1091
  source /opt/ross-roster/.env
  cat > .env <<EOF
PORT=3003
ROSS_API_URL=http://127.0.0.1:3002
ROSS_API_KEY=$ROSTER_BOT_API_KEY
REVIEWER_NAME=Adam Sawtell
EOF
  echo "Created admin .env from ross-roster API key"
else
  echo "Keeping existing admin .env"
fi

npm ci
npm run build
pm2 delete ross-admin >/dev/null 2>&1 || true
# standalone output
pm2 start npm --name ross-admin --cwd /opt/ross-admin -- start
pm2 save
sleep 3
curl -s -o /dev/null -w "admin_http:%{http_code}\n" http://127.0.0.1:3003/
curl -s http://127.0.0.1:3003/api/health
echo
pm2 list | grep ross || true
