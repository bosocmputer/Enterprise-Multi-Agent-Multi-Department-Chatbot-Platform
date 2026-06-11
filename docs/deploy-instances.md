# Deploy Instances

Do not store real passwords, tokens, or private keys here.

## Environments

| Environment | URL | Deploy path | Branch | Notes |
| --- | --- | --- | --- | --- |
| local | `http://localhost:3060` | `/Users/nontawatwongnuk/dev_bos/Enterprise Multi-Agent & Multi-Department Chatbot Platform` | main | use local `.env` only; do not commit secrets |
| pilot | `http://192.168.2.109:3060` | `/home/bosscatdog/parts-lookup-chatbot` | main | isolated Docker Compose; Telegram polling enabled with token stored only in server `.env` |
| production | not assigned | not assigned | main | deploy target not selected |

## Planned Services

| Service | Purpose |
| --- | --- |
| parts-lookup-api | Fastify lookup service with health/ready, internal smoke endpoint, Telegram polling/webhook adapters, and SML read-only lookup. |
| parts-lookup-redis | Dedicated Redis container for dedup, cache, and rate limits. |
| parts-lookup-tunnel | Optional Cloudflare Tunnel profile for dedicated public LINE webhook ingress. |
| worker | Optional BullMQ worker for slow/background jobs. |
| otel-collector | Optional telemetry collector. |

## Runtime Config

Expected environment variables after implementation:

```text
NODE_ENV
PORT
PUBLIC_BASE_URL
INTERNAL_API_TOKEN
BUSINESS_PROFILE_PATH
REDIS_URL
SML_MCP_BASE_URL
SML_MCP_ACCESS_MODE
SML_DATASET_LABEL
SML_TENANT_STATUS
SML_CIRCUIT_FAILURE_THRESHOLD
SML_CIRCUIT_OPEN_SECONDS
SML_MAX_CONCURRENT_CALLS
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_ENABLED
TELEGRAM_POLLING_ENABLED
TELEGRAM_WEBHOOK_ENABLED
TELEGRAM_CONTEXT_TTL_SECONDS
TELEGRAM_POLLING_INTERVAL_MS
TELEGRAM_POLLING_TIMEOUT_SECONDS
TELEGRAM_DEDUP_TTL_SECONDS
METRICS_ENABLED
LINE_ENABLED
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
LINE_GROUP_PREFIXES
LLM_PARSER_ENABLED
LLM_PARSER_MODE
LLM_PROVIDER
LITELLM_BASE_URL
LITELLM_API_KEY
LITELLM_MODEL
OPENAI_API_KEY
OPENAI_BASE_URL
LLM_PARSER_TIMEOUT_MS
LLM_MIN_CONFIDENCE
LLM_MAX_CONCURRENT_CALLS
LLM_ASSIST_QUEUE_WAIT_MS
LOG_LEVEL
ALERTS_ENABLED
ALERT_TELEGRAM_BOT_TOKEN
OPS_TELEGRAM_CHAT_ID
ALERT_DEDUP_TTL_SECONDS
RATE_LIMIT_PER_MINUTE
STOCK_CACHE_TTL_SECONDS
PRICE_CACHE_TTL_SECONDS
PRODUCT_SEARCH_CACHE_TTL_SECONDS
SML_REQUEST_TIMEOUT_MS
CLOUDFLARE_TUNNEL_TOKEN
CLOUDFLARE_TUNNEL_HOSTNAME
```

Optional:

```text
ANTHROPIC_API_KEY
LANGFUSE_PUBLIC_KEY
LANGFUSE_SECRET_KEY
OTEL_EXPORTER_OTLP_ENDPOINT
```

## Commands

```bash
# install
npm install

# test
npm test

# build
npm run build

# health check
curl -fsS http://localhost:<port>/health

# readiness check
curl -fsS -H "Authorization: Bearer <token>" http://localhost:<port>/ready

# metrics check
curl -fsS -H "Authorization: Bearer <token>" http://localhost:<port>/metrics

# run isolated local/server compose stack
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 parts-lookup-api

# full pilot smoke
BASE_URL=http://localhost:<port> bash scripts/pilot-smoke.sh

# production smoke
BASE_URL=http://localhost:<port> INTERNAL_API_TOKEN=<token> bash scripts/prod-smoke.sh

# recommended pilot deploy from local after commit + push
RUN_SMOKE=1 bash scripts/deploy-server-git.sh

# enable Telegram dev alerts after the alert bot receives /start
bash scripts/bootstrap-telegram-alerts.sh

# smoke lookup
curl -fsS -X POST http://localhost:<port>/internal/lookup \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"text":"PAINT-01424 มีไหม ราคาเท่าไร"}'

# smoke LLM parser when enabled
curl -fsS -X POST http://localhost:<port>/internal/parse \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"text":"มีปูนตราช้างเหลือไหม"}'
```

## Release Checklist

- Worktree clean before deploy.
- Current commit pushed to `origin/main`.
- Tests/build passed.
- Required env vars/secrets present in target environment.
- Telegram polling smoke passed before pilot traffic.
- Telegram bot username recorded; token remains only in untracked `.env`.
- Alert bot chat initialized by sending `/start` to the alert bot before enabling `ALERTS_ENABLED=true`.
- LINE webhook signature smoke passed before LINE rollout.
- SML read-only smoke passed.
- No write SML tool in allowlist.
- Redis connectivity verified.
- `/metrics` exposes lookup, Telegram, and SML tool metrics without secrets.
- If LLM parser is enabled, `/metrics` exposes parser attempt, assist-start, and latency metrics without raw prompts or secrets.
- `/ready`, `/metrics`, and `/internal/lookup` reject unauthenticated production requests.
- `SML_TENANT_STATUS=real` is explicit after `192.168.2.248:3515` real SML data smoke passes.
- Cache TTLs reviewed with business users.
- Timeout/circuit breaker config reviewed.
- Logs redact secrets.
- Dev alerts use `ALERT_TELEGRAM_BOT_TOKEN` when set, falling back to `TELEGRAM_BOT_TOKEN` only for small pilot setups.
- Health/readiness endpoints verified.
- Rollback path known.

## LLM Parser Pilot Config

The parser is optional and must never answer stock or price facts. It only emits structured lookup JSON that the app validates before using.

Recommended pilot assist config:

```text
LLM_PARSER_ENABLED=true
LLM_PARSER_MODE=assist
LLM_PROVIDER=litellm
LITELLM_BASE_URL=http://192.168.2.248:4000
LITELLM_MODEL=openrouter/openrouter/free
LLM_PARSER_TIMEOUT_MS=6000
LLM_MIN_CONFIDENCE=0.75
LLM_MAX_CONCURRENT_CALLS=2
LLM_ASSIST_QUEUE_WAIT_MS=5000
ASSIST_USER_STATUS_ENABLED=true
ASSIST_USER_STATUS_SHOW_MODEL=true
ASSIST_STATUS_MIN_DELAY_MS=800
ASSIST_RESULT_FOOTER_ENABLED=true
```

Store the key only in server `.env` as `LITELLM_API_KEY` or `OPENAI_API_KEY`. The current LiteLLM Swagger requires the `x-litellm-api-key` header; do not commit the key. In assist mode the LLM may only provide structured intent/search terms; SML remains the source of truth for stock and price. Telegram may show the LiteLLM model/status on slow-path messages, while LINE uses loading animation only for one-on-one chats. Roll back by changing `LLM_PARSER_MODE=shadow` or `off` and recreating the app container.

## Git-Based Pilot Deploy

The pilot server should deploy from Git, not rsync, so every running build maps to a commit.

Default target:

```text
host: 192.168.2.109
path: /home/bosscatdog/parts-lookup-chatbot
branch: main
compose service: parts-lookup-api
```

Local release command:

```bash
npm test
npm run build
git status --short
git add .
git commit -m "Implement parts lookup pilot"
git push origin main
RUN_SMOKE=1 bash scripts/deploy-server-git.sh
```

The deploy script checks that the local worktree is clean and that local `HEAD` has already been pushed to the configured deploy branch. On first run it converts an existing non-Git rsync folder into a timestamped backup, clones the repository, preserves the existing server `.env`, rebuilds the app container, and runs `scripts/prod-smoke.sh` when `RUN_SMOKE=1`.

Useful overrides:

```bash
DEPLOY_HOST=192.168.2.109 \
DEPLOY_USER=bosscatdog \
DEPLOY_PATH=/home/bosscatdog/parts-lookup-chatbot \
DEPLOY_BRANCH=main \
RUN_SMOKE=1 \
bash scripts/deploy-server-git.sh
```

When password-based SSH is still used during pilot setup, keep the password out of shell history by supplying it through the environment and overriding the SSH command:

```bash
SSHPASS='<password>' SSH_CMD='sshpass -e ssh' RUN_SMOKE=1 bash scripts/deploy-server-git.sh
```

## Rollback Path

1. Disable Telegram polling in server `.env` by setting `TELEGRAM_ENABLED=false` and `TELEGRAM_POLLING_ENABLED=false`, then restart with `docker compose up -d`.
2. For full pilot stop, run `docker compose down` from `/home/bosscatdog/parts-lookup-chatbot`.
3. If reverting code, checkout the previous known-good commit on the server and rebuild:

   ```bash
   cd /home/bosscatdog/parts-lookup-chatbot
   git checkout <previous-good-sha>
   GIT_SHA="$(git rev-parse --short=12 HEAD)" docker compose up --build -d --force-recreate parts-lookup-api
   ```

4. Verify `/health` and `/ready`.
5. Run one read-only internal lookup smoke if SML is healthy.
6. Re-enable Telegram polling only after the smoke passes.

For LINE rollout, disable or reroute the LINE webhook in LINE Developers first, then restart the service with `LINE_ENABLED=false` if app-level rollback is needed.

No database migrations are planned for MVP. Redis stores only ephemeral bot-owned data.

## Pilot Deploy Notes

- Compose project name: `parts-lookup`.
- Container names: `parts-lookup-api`, `parts-lookup-redis`.
- Network name: `parts-lookup-net`.
- Redis volume name: `parts-lookup-redis-data`.
- App port: `3060`.
- Tunnel is opt-in via `docker compose --profile tunnel up -d`.
- Do not add nginx, cloudflared, or shared Redis dependencies for this pilot phase.
