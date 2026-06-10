# Domain-Agnostic Inventory Lookup Chatbot Platform

Speed-first read-only chatbot for staff to ask product stock and price questions from LINE or Telegram across different business domains.

The current product focus is not a multi-department agent platform. The practical MVP is a fast lookup service with chat channels as input, SML MCP as the source of truth, Redis as an accelerator, tenant Business Profiles for vocabulary/aliases/examples, and optional LLM parsing only when a message is ambiguous.

## Current State

This repo now contains the production-ready demo runtime: Fastify lookup API, SML MCP read-only client, Redis-backed cache/dedup/rate limit/context state, Telegram polling/webhook adapter, LINE webhook adapter, production metrics, alerts, Business Profile config, tests, and isolated Docker Compose deployment. The next architecture step is adding an optional LLM slow-path for ambiguous messages while keeping SML as the only source of stock/price facts.

Pilot service:

- Local: `http://localhost:3060`
- Server: `http://192.168.2.109:3060`
- Server path: `/home/bosscatdog/parts-lookup-chatbot`
- Data source: SML MCP `http://192.168.2.248:3515` using construction-demo data until the real customer tenant is ready.
- Business Profile: `profiles/construction-demo.json`

Telegram polling is enabled on the pilot server. LINE is implemented behind env flags and requires LINE credentials plus public tunnel config. Dev alerts can use a separate Telegram alert bot via `ALERT_TELEGRAM_BOT_TOKEN`. Keep all tokens only in server `.env`; never commit or paste them into docs.

## Commands

```bash
npm install
npm test
npm run build
docker compose up --build -d
curl -fsS http://localhost:3060/health
curl -fsS -H "Authorization: Bearer $INTERNAL_API_TOKEN" http://localhost:3060/ready
BASE_URL=http://localhost:3060 INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN" bash scripts/prod-smoke.sh

# pilot server deploy after commit + push
RUN_SMOKE=1 bash scripts/deploy-server-git.sh
```

## Start Here

- Codex entry point: `AGENTS.md`
- Blueprint: `blueprint Enterprise Multi-Agent & Multi-Department Chatbot Platform.md`
- Docs index: `docs/README.md`
- Current state: `docs/current-state.md`
- Architecture: `docs/architecture.md`
- Data flow: `docs/data-flow.md`
- SML MCP integration: `docs/sml-mcp-integration.md`

## Local Context Map

```bash
bash scripts/graphify-update.sh
bash scripts/graphify-query.sh "main architecture"
bash scripts/graphify-preflight.sh
```

`graphify-out/` is local-only and must remain untracked.
