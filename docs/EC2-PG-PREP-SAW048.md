# SAW048 — EC2 Postgres prep (done)

Status: **complete** on `54.206.8.250` (2026-07-25).

## Done

| Item | Result |
|------|--------|
| Role `ross_agent` | Created; NOSUPERUSER / NOCREATEDB / NOCREATEROLE |
| DB | `idempiere`, schema `adempiere` |
| Grants | CONNECT + USAGE; SELECT/INSERT/UPDATE on tables; USAGE/SELECT on sequences |
| DDL check | `CREATE TABLE` as `ross_agent` denied |
| SSL | `SHOW ssl` = on; `sslmode=require` login OK |
| `pg_hba.conf` | Marker `# SAW048-ross-agent-amplify` + `hostssl … 0.0.0.0/0 md5` (tighten later) |
| Reload | `pg_ctlcluster 12 main reload` |

Scripts (idempotent): `admin-ui/scripts/ec2-ross-agent-prep.sh`, `ec2-ross-agent-verify.sh`.

## Still needed (Amplify agent / AWS console)

1. **Security group** inbound TCP **5432** for Amplify outbound IPs  
   - SG name: `AbilityERP Development Security Group`  
   - Metadata id: `sg-0ee0cefcc80998823` (confirm in console — may be different AWS account than local CLI)  
   - VPC `vpc-093603f908654f4a8`
2. After Amplify NAT known: replace `0.0.0.0/0` in `pg_hba` with those CIDRs
3. Put `DB_PASSWORD` only in Amplify env (see gitignored Hermes handoff)

## Amplify next step

Point Hermes at **`docs/AMPLIFY-HERMES-HANDOFF.md`** (local, gitignored, includes secrets + full deploy brief).
