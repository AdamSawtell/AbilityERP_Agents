import json
import os
import subprocess
import urllib.request
import uuid


def psql(sql: str) -> str:
    env = os.environ.copy()
    out = subprocess.check_output(
        [
            "psql",
            "-h",
            "127.0.0.1",
            "-U",
            env["DB_USER"],
            "-d",
            env["DB_NAME"],
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
            "-t",
            "-A",
            "-X",
            "-c",
            sql,
        ],
        env=env,
        text=True,
    )
    lines = [ln for ln in out.splitlines() if ln.strip() and not ln.startswith("Time:")]
    return "\n".join(lines).strip()


def main() -> None:
    row = psql(
        "SELECT ad_client_id||','||ad_org_id||','||aberp_unavailability_type_id"
        "||','||c_bpartner_staff_id||','||aberp_user_contact_id "
        "FROM adempiere.aberp_unavailability_leave "
        "WHERE aberp_unavailability_leave_id=1000012"
    )
    client, org, typ, worker, user = row.split(",")
    new_id = psql(
        "SELECT COALESCE(MAX(aberp_unavailability_leave_id),0)+1 "
        "FROM adempiere.aberp_unavailability_leave"
    )
    uu = str(uuid.uuid4())
    psql(
        f"""INSERT INTO adempiere.aberp_unavailability_leave (
  aberp_unavailability_leave_id, ad_client_id, ad_org_id, aberp_unavailability_leave_uu,
  created, createdby, updated, updatedby, isactive,
  c_bpartner_staff_id, aberp_user_contact_id, startdate, enddate,
  aberp_approverstatus, processed, note, aberp_unavailability_type_id
) VALUES (
  {new_id}, {client}, {org}, '{uu}',
  NOW(), 100, NOW(), 100, 'Y',
  {worker}, {user},
  TIMESTAMP '2026-07-25 00:00:00', TIMESTAMP '2026-07-25 23:59:00',
  'AP', 'N', 'SAW047 smoke leave', {typ}
)"""
    )
    print("LEAVE_ID", new_id)

    key = None
    for path in ("/opt/ross-admin/.env", "/opt/ross-roster/.env"):
        for line in open(path, encoding="utf-8"):
            if line.startswith("ROSS_API_KEY=") or line.startswith("ROSTER_BOT_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
        if key:
            break

    def call(method: str, path: str, body=None):
        req = urllib.request.Request(
            f"http://127.0.0.1:3002{path}",
            data=(json.dumps(body).encode() if body is not None else None),
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method=method,
        )
        with urllib.request.urlopen(req) as resp:
            return json.load(resp)

    print("PENDING", json.dumps(call("GET", "/api/v1/leave/pending")))
    print("RUN", json.dumps(call("POST", "/api/v1/leave/run", {})))
    leave = call("GET", "/api/v1/leave?limit=3")
    print(
        "REPL",
        [
            (
                r.get("status"),
                r.get("original_worker_name"),
                r.get("replacement_worker_name"),
                r.get("score"),
            )
            for r in leave.get("replacements", [])
        ],
    )
    print(
        "STAFF",
        psql(
            "SELECT COALESCE(c_bpartner_staff_id::text,'NULL')||','||"
            "COALESCE(aberp_declineshift,'NULL') "
            "FROM adempiere.aberp_rostered_shiftstaff "
            "WHERE aberp_rostered_shiftstaff_id=1000669"
        ),
    )
    print(
        "PROPOSALS",
        psql(
            "SELECT count(*)::text FROM adempiere.rostering_agent_proposals "
            "WHERE shift_id=1000627 AND status='pending'"
        ),
    )


if __name__ == "__main__":
    main()
