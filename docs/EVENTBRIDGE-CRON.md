# SAW054 — EventBridge cron → Amplify

> **Status:** live  
> **Region:** `ap-southeast-2`  
> **Amplify:** `https://main.d17ivsmdf92nf8.amplifyapp.com`

After EC2 PM2 Ross stop, scheduled work must hit Amplify. There is no in-process `node-cron` on Hosting.

## Architecture

```
EventBridge Scheduler
  ross-emergency-scan   rate(30 minutes)
  ross-leave-cycle      rate(1 hour)
  ross-planner-daily    cron(0 2 * * ? *) Australia/Adelaide
        │
        ▼
Lambda ross-cron-invoke
  POST {BASE_URL}{path}
  header x-ross-cron: CRON_SECRET
        │
        ▼
Amplify /api/v1/{worker|leave|planner}/run
```

| Schedule | Path |
|----------|------|
| `ross-emergency-scan` | `/api/v1/worker/run` |
| `ross-leave-cycle` | `/api/v1/leave/run` |
| `ross-planner-daily` | `/api/v1/planner/run` |

Secrets live in Lambda env (`BASE_URL`, `CRON_SECRET`), not in schedule input.

## IAM

| Role | Trust | Purpose |
|------|-------|---------|
| `RossCronLambdaRole` | `lambda.amazonaws.com` | Run invoker (+ basic logs) |
| `RossSchedulerInvokeRole` | `scheduler.amazonaws.com` | `lambda:InvokeFunction` on `ross-cron-invoke` |

## Ops

```bash
# list
aws scheduler list-schedules --region ap-southeast-2

# manual fire (same as schedule input)
aws lambda invoke --function-name ross-cron-invoke --region ap-southeast-2 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"path":"/api/v1/worker/run"}' out.json && cat out.json

# recreate / update from repo
pwsh admin-ui/scripts/aws/upsert-ross-cron.ps1
```

Local wrappers (optional): `admin-ui/scripts/run-*.ts` with `BASE_URL` + `CRON_SECRET`.
