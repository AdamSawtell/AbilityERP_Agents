# SAW055 — Deploy

## Staging / AbilityERP EC2 (54.206.8.250)

```bash
sudo -u postgres psql -d idempiere -v ON_ERROR_STOP=1 \
  -f /path/to/001_qualify_shiftstaff_triggers.sql
```

Or pipe from repo:

```bash
scp Tickets/SAW055_shiftstaff_trigger_schema/sql/001_qualify_shiftstaff_triggers.sql ubuntu@54.206.8.250:/tmp/
ssh ubuntu@54.206.8.250 'sudo -u postgres psql -d idempiere -v ON_ERROR_STOP=1 -f /tmp/001_qualify_shiftstaff_triggers.sql'
```

## Verify

```sql
SELECT proname, prosecdef, proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'adempiere'
  AND p.proname IN (
    'aberp_shiftstaff_sync_bp_from_contact',
    'aberp_shiftstaff_sync_org_from_shift'
  );
```

As `ross_agent`: Accept a REQ with open slots from Ross Responses UI (or Amplify POST same-origin).

## Production

Same SQL after staging review. No JAR / AD window changes. No Admin access grant required.
