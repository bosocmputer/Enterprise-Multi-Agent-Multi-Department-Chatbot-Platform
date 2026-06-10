# Operations

## Health And Readiness

Expose at least:

| Endpoint | Purpose | Should check |
| --- | --- | --- |
| `/health` | Process is alive. | Fastify process responds. |
| `/ready` | Service can safely receive traffic. | Redis reachable, SML circuit not open, config loaded. |
| `/metrics` | Metrics scrape endpoint if using Prometheus/OpenTelemetry collector. | Request/cache/SML/channel metrics. |

`/health` should stay up during dependency outages. `/ready` should degrade when Redis or SML is unavailable.

## Key Metrics

| Metric | Why it matters |
| --- | --- |
| `parts_lookup_requests_total{channel,status,intent,cache_hit}` | Traffic by channel and outcome. |
| `parts_lookup_channel_updates_total{channel,outcome,reason}` | Telegram/LINE event handling, ignored chatter, duplicates, rate limits. |
| `parts_lookup_telegram_updates_total{outcome,reason}` | Group gate, duplicate, rate-limit, and handled update behavior. |
| `parts_lookup_duration_ms{channel,status,intent,cache_hit}` | End-to-end lookup performance. |
| `cache_hit_ratio{kind}` | Cache effectiveness. |
| `parts_lookup_sml_tool_duration_ms{tool,outcome}` | SML dependency health. |
| `parts_lookup_sml_tool_calls_total{tool,outcome}` | SML integration failures and volume. |
| `reply_errors_total{channel}` | Channel delivery issues. |
| `dedup_hits_total{channel}` | Duplicate webhook events. |
| `rate_limited_total{channel}` | Abuse or noisy group behavior. |
| `no_match_total` | Search quality issue indicator. |
| `multi_match_total` | Ambiguity/search quality issue indicator. |

## Suggested Alerts

Initial alert thresholds should be tuned after pilot traffic.

Telegram dev alerts are sent with `ALERT_TELEGRAM_BOT_TOKEN` when configured. Use a separate alert bot from the staff-facing Telegram bot for production-like demos, and have the dev/ops account send `/start` to that bot before setting `OPS_TELEGRAM_CHAT_ID` and `ALERTS_ENABLED=true`.

On the deploy host, after `/start`, run:

```bash
cd /home/bosscatdog/parts-lookup-chatbot
bash scripts/bootstrap-telegram-alerts.sh
```

The script reads the alert bot token from `.env`, finds the latest Telegram chat from `getUpdates`, enables alerts in `.env`, restarts the API service, and sends a test alert.

| Alert | Initial threshold |
| --- | --- |
| SML unavailable | lookup returns SML dependency fallback or circuit open; dedup by channel/reason. |
| SML latency high | p95 SML latency > 2 seconds for 5 minutes. |
| Lookup latency high | p95 lookup latency > 3 seconds for 5 minutes. |
| Reply failures | channel reply error rate > 5% for 5 minutes. |
| Redis unavailable | any sustained Redis connection failure > 1 minute. |
| No-match spike | no-match rate doubles baseline for 15 minutes. |

## Runbook: SML Port Not Reachable

Symptoms:

- `/ready` degraded
- SML connection refused or timeout
- lookup fallback replies increase

Checks:

1. Confirm host reachable from bot host.
2. Confirm SML MCP process is running.
3. Confirm service binds to reachable interface, not only localhost.
4. Confirm firewall allows bot host to port.
5. Confirm `SML_MCP_BASE_URL` is correct.
6. Confirm whether endpoint is production or sandbox.

User behavior:

- Reply with safe fallback.
- Send a deduped dev alert when lookup returns an SML dependency error and Telegram alerts are enabled.
- Do not invent stock or price.
- Do not retry aggressively.

## Runbook: Redis Unavailable

Impact:

- dedup may be unavailable
- cache disabled
- group/private session context disabled
- rate limits may be unavailable

Behavior:

- If traffic is low and SML is healthy, direct read-only lookup may continue.
- If duplicate reply risk is unacceptable, make `/ready` degraded and stop accepting webhook traffic.
- Alert ops.

## Runbook: Telegram Or LINE Reply Failure

Checks:

- token/secret rotated?
- webhook URL changed?
- channel API rate limit?
- payload format invalid?
- network outage?

Behavior:

- Log reply failure with redacted payload.
- Do not retry indefinitely.
- Do not enqueue repeated replies without idempotency key.

## Runbook: Product Search Quality Poor

Symptoms:

- high no-match rate
- high multi-match rate
- staff reports common names do not find products

Actions:

1. Collect redacted examples.
2. Add tenant-specific aliases/examples to Business Profile or catalog-derived alias/index data, not source code.
3. Consider local product alias/index cache if SML search cannot handle common terms directly.
4. Re-test with known item codes and common store phrases from the tenant profile.
5. Only add optional LLM parser after profile/context/alias parsing is insufficient.

## Credential Rotation

Rotatable secrets:

- Alert Telegram bot token
- Telegram bot token and webhook secret
- LINE channel secret and access token
- SML role/auth config if provided
- Redis URL/password
- LLM provider keys if enabled

Rotation rule:

- Deploy new secret.
- Smoke test webhook and one read-only lookup.
- Remove old secret.
- Confirm logs do not contain token values.

## Rollback

Rollback should be image/config based:

1. Disable webhook at channel provider or route traffic away.
2. Revert app image/config.
3. Clear only bot-owned ephemeral Redis keys if necessary.
4. Do not delete SML data.
5. Smoke test `/health`, `/ready`, Telegram lookup, and SML read-only lookup.

For the pilot server, code deploys are Git-based:

```bash
cd /home/bosscatdog/parts-lookup-chatbot
git log --oneline -5
git checkout <previous-good-sha>
GIT_SHA="$(git rev-parse --short=12 HEAD)" docker compose up --build -d --force-recreate parts-lookup-api
BASE_URL=http://127.0.0.1:3060 INTERNAL_API_TOKEN=<token> bash scripts/prod-smoke.sh
```

The `/health` payload includes `gitSha` so operators can confirm which commit is running.

## Production Demo Smoke Command

Run this after deploy or config changes:

```bash
BASE_URL=http://127.0.0.1:3060 INTERNAL_API_TOKEN=<token> bash scripts/prod-smoke.sh
```

On the pilot server, run it from `/home/bosscatdog/parts-lookup-chatbot`.
