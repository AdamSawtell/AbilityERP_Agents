# Ross Admin UI (SAW043)

Next.js control centre for Ross. Runs on **EC2 `54.206.8.250:3003`** and proxies to `ross-roster` on `:3002` (API key stays server-side).

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

## Screens

- **Dashboard** — pending proposals as chat cards, Approve/Reject, Run scan
- **Gaps** — unresolved no-match events
- **Audit** — recent Ross actions
