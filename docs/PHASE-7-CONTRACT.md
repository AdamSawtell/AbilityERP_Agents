# SAW048 — Ross Phase 7 Contract (AI Chat Tooling)

> **Status:** In progress · AbilityERP_Agents  
> **Ticket:** SAW048_ross_ai_chat  
> **Kind:** app  
> **Provider:** OpenAI (tool calling)

---

## Freeze decisions

| Topic | Decision |
|---|---|
| **LLM** | OpenAI Chat Completions + tools. Key: `OPENAI_API_KEY` on Ross EC2 `.env` only. |
| **Model** | Default `gpt-4o-mini` (`OPENAI_MODEL` override). |
| **Matching / assign rules** | Stay in TypeScript. LLM may call tools; may not invent assignments without `approve_proposal` / scan auto-assign. |
| **Chat UI** | Dashboard command bar → `POST /api/v1/agent/chat`. Shortcuts (help/scan/…) kept when AI offline. |
| **Hosting** | EC2 `:3002` + `:3003`. Amplify still deferred. |
| **Auth** | Still Bearer API key for Ross; no Entra. |

---

## Exit

1. `POST /api/v1/agent/chat` with natural language returns a Ross reply  
2. Tools execute: status, scan, vacant, gaps, proposals, approve/reject/bulk, leave cycle, forecast  
3. Dashboard chat uses AI when key present  
4. Without key → clear error + command fallback  
5. Tool use audited (`agent_chat`)

---

## Env (EC2 `/opt/ross-roster/.env`)

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini   # optional
# ROSS_SYSTEM_PROMPT=...   # optional override
```

## Deploy

```bash
bash /opt/ross-roster/scripts/deploy-ec2.sh
bash /opt/ross-admin/scripts/deploy-ec2.sh
# Dashboard chat at http://54.206.8.250:3003/
```
