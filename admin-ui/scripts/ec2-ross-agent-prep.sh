#!/usr/bin/env bash
# SAW048 — EC2 Postgres prep for Amplify (ross_agent user).
set -euo pipefail

DB_NAME="${DB_NAME:-idempiere}"
DB_USER="${DB_USER:-ross_agent}"
SCHEMA="${SCHEMA:-adempiere}"

if [[ -z "${ROSS_AGENT_PASSWORD:-}" ]]; then
  ROSS_AGENT_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
  GENERATED=1
else
  GENERATED=0
fi

echo "=== PG version / ssl ==="
sudo -u postgres psql -d "${DB_NAME}" -tAc "SHOW server_version;"
sudo -u postgres psql -d "${DB_NAME}" -tAc "SHOW ssl;"

if ! sudo -u postgres psql -d "${DB_NAME}" -tAc "SELECT 1 FROM pg_namespace WHERE nspname='${SCHEMA}'" | grep -q 1; then
  DETECTED="$(sudo -u postgres psql -d "${DB_NAME}" -tAc "SELECT schemaname FROM pg_tables WHERE tablename='aberp_rostered_shift' LIMIT 1;")"
  if [[ -n "${DETECTED}" ]]; then
    SCHEMA="${DETECTED}"
    echo "=== using detected schema: ${SCHEMA} ==="
  else
    echo "ERROR: schema ${SCHEMA} not found and could not detect aberp_rostered_shift"
    sudo -u postgres psql -d "${DB_NAME}" -c '\dn'
    exit 1
  fi
fi

HBA="$(sudo -u postgres psql -d "${DB_NAME}" -tAc 'SHOW hba_file;')"
echo "=== hba_file: ${HBA} ==="

echo "=== ensure role ${DB_USER} ==="
EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")"
if [[ "${EXISTS}" == "1" ]]; then
  echo "Role exists — setting password"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${ROSS_AGENT_PASSWORD}';"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE USER ${DB_USER} WITH LOGIN PASSWORD '${ROSS_AGENT_PASSWORD}';"
fi

sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE ${DB_USER} NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT LOGIN;
GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_USER};
GRANT USAGE ON SCHEMA ${SCHEMA} TO ${DB_USER};
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${DB_USER};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${SCHEMA} TO ${DB_USER};
SQL

for OWNER in adempiere idempiere postgres; do
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${OWNER}'" | grep -q 1; then
    sudo -u postgres psql -d "${DB_NAME}" -c "ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA ${SCHEMA} GRANT SELECT, INSERT, UPDATE ON TABLES TO ${DB_USER};" || true
    sudo -u postgres psql -d "${DB_NAME}" -c "ALTER DEFAULT PRIVILEGES FOR ROLE ${OWNER} IN SCHEMA ${SCHEMA} GRANT USAGE, SELECT ON SEQUENCES TO ${DB_USER};" || true
  fi
done

echo "=== role attrs ==="
sudo -u postgres psql -c "\du ${DB_USER}"

echo "=== smoke as ${DB_USER} (local) ==="
PGPASSWORD="${ROSS_AGENT_PASSWORD}" psql -h 127.0.0.1 -p 5432 -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -tAc \
  "SELECT current_user || '@' || current_database(); SELECT count(*) FROM information_schema.tables WHERE table_schema='${SCHEMA}';"

MARKER="# SAW048-ross-agent-amplify"
if ! sudo grep -qF "${MARKER}" "${HBA}"; then
  echo "=== appending pg_hba hostssl rule (md5) ==="
  sudo cp "${HBA}" "${HBA}.bak.saw048.$(date +%Y%m%d%H%M%S)"
  {
    echo ""
    echo "${MARKER}"
    echo "# Amplify -> EC2 PG. Tighten ADDRESS to Amplify NAT CIDRs after first deploy."
    echo "hostssl ${DB_NAME} ${DB_USER} 0.0.0.0/0 md5"
    echo "hostssl ${DB_NAME} ${DB_USER} ::/0 md5"
  } | sudo tee -a "${HBA}" >/dev/null
  sudo pg_ctlcluster 12 main reload || sudo systemctl reload postgresql
else
  echo "=== pg_hba SAW048 marker already present — skipping append ==="
fi

PUBIP="$(curl -s --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 || true)"
PRIVIP="$(hostname -I | awk '{print $1}')"
echo ""
echo "===== SAW048 EC2 PREP COMPLETE ====="
echo "SCHEMA=${SCHEMA}"
echo "DB_HOST=${PUBIP:-54.206.8.250}"
echo "DB_PORT=5432"
echo "DB_NAME=${DB_NAME}"
echo "DB_USER=${DB_USER}"
echo "DB_PASSWORD=${ROSS_AGENT_PASSWORD}"
echo "DB_SSL=true"
echo "PRIVATE_IP=${PRIVIP}"
echo "NOTE: Open SG inbound TCP 5432 from Amplify outbound IPs; tighten pg_hba after NAT known."
