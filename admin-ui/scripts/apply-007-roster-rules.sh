#!/usr/bin/env bash
# SAW049 â€” apply roster rules migration on EC2 Postgres
set -euo pipefail

DB_NAME="${DB_NAME:-idempiere}"
SCHEMA="${SCHEMA:-adempiere}"
SQL_FILE="${1:-}"

if [[ -z "${SQL_FILE}" || ! -f "${SQL_FILE}" ]]; then
  echo "Usage: $0 /path/to/007_roster_rules.sql"
  exit 1
fi

echo "=== applying ${SQL_FILE} to ${DB_NAME} ==="
sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "${SQL_FILE}"

echo "=== grant ross_agent on new table ==="
sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<SQL
GRANT SELECT, INSERT, UPDATE, DELETE ON ${SCHEMA}.rostering_agent_rules TO ross_agent;
SQL

echo "=== verify ==="
sudo -u postgres psql -d "${DB_NAME}" -c \
  "SELECT id, rule_type, enabled, enforcement FROM ${SCHEMA}.rostering_agent_rules ORDER BY priority;"
