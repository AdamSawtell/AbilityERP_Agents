import os
import urllib.error
import urllib.request


def handler(event, context):
    path = (event or {}).get("path") or "/api/v1/worker/run"
    base = os.environ["BASE_URL"].rstrip("/")
    secret = os.environ["CRON_SECRET"]
    url = f"{base}{path}"
    req = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={
            "x-ross-cron": secret,
            "Content-Type": "application/json",
            "User-Agent": "ross-cron-invoke/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=110) as resp:
            body = resp.read().decode("utf-8", errors="replace")[:2000]
            return {"ok": True, "status": resp.status, "path": path, "body": body}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:2000]
        # Overlapping scan is acceptable.
        if e.code == 409:
            return {"ok": True, "status": 409, "path": path, "body": body}
        raise RuntimeError(f"HTTP {e.code} {path}: {body}") from e
