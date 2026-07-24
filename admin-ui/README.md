# Ross Admin UI (SAW043)

Next.js control centre for Ross. Runs on **EC2 `54.206.8.250:3003`** and proxies to `ross-roster` on `:3002` (API key stays server-side).

**Contract:** [docs/PHASE-2-CONTRACT.md](../docs/PHASE-2-CONTRACT.md) · product [docs/ROSS-SCOPE.md](../docs/ROSS-SCOPE.md) §4 / §10.2

## Local / EC2

```bash
cp .env.example .env
# ROSS_API_URL=http://127.0.0.1:3002
# ROSS_API_KEY=<from /opt/ross-roster/.env>
npm install
npm run dev    # :3003
# or
npm run build && npm start
```

Deploy to this host: `bash scripts/deploy-ec2.sh` → `/opt/ross-admin`, pm2 `ross-admin`.

## Screens

- **Dashboard** — horizon tabs (Today / This Period / Next Period), command bar (`help`, `scan`, `status`, `vacant`, `gaps`), proposal cards with Approve/Reject/Alternates, gap cards, rail widgets
- **Gaps** — unresolved no-match events
- **Config** — scan interval, thresholds (writes `rostering_agent_config`)
- **Audit** — recent Ross actions
