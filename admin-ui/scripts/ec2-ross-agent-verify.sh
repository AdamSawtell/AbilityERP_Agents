#!/usr/bin/env bash
set -euo pipefail
PASS="${1:?password required}"

sudo -u postgres psql -c "ALTER ROLE ross_agent INHERIT;"
sudo -u postgres psql -c '\du ross_agent'

echo "=== hba marker ==="
sudo grep -A3 'SAW048-ross-agent' /etc/postgresql/12/main/pg_hba.conf || true

echo "=== ssl local require ==="
PGPASSWORD="${PASS}" psql "sslmode=require host=127.0.0.1 port=5432 dbname=idempiere user=ross_agent" -tAc \
  "SELECT current_user || ' ok rows=' || count(*)::text FROM adempiere.rostering_agent_config;"

echo "=== cannot create table (expect fail) ==="
set +e
PGPASSWORD="${PASS}" psql "sslmode=require host=127.0.0.1 port=5432 dbname=idempiere user=ross_agent" -c \
  "CREATE TABLE adempiere.ross_agent_should_fail (id int);" 2>&1 | tail -3
set -e

echo "=== metadata ==="
TOKEN="$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600' || true)"
if [[ -n "${TOKEN}" ]]; then
  echo "security-groups: $(curl -s -H "X-aws-ec2-metadata-token: ${TOKEN}" http://169.254.169.254/latest/meta-data/security-groups)"
  MAC="$(curl -s -H "X-aws-ec2-metadata-token: ${TOKEN}" http://169.254.169.254/latest/meta-data/network/interfaces/macs/ | head -1)"
  echo "mac: ${MAC}"
  echo "sg-ids: $(curl -s -H "X-aws-ec2-metadata-token: ${TOKEN}" "http://169.254.169.254/latest/meta-data/network/interfaces/macs/${MAC}security-group-ids")"
  echo "subnet: $(curl -s -H "X-aws-ec2-metadata-token: ${TOKEN}" "http://169.254.169.254/latest/meta-data/network/interfaces/macs/${MAC}subnet-id")"
  echo "vpc: $(curl -s -H "X-aws-ec2-metadata-token: ${TOKEN}" "http://169.254.169.254/latest/meta-data/network/interfaces/macs/${MAC}vpc-id")"
fi
command -v aws >/dev/null && aws --version || echo "aws cli: not installed"
echo VERIFY_OK
