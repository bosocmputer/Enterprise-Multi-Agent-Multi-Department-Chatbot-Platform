# Architecture

## System Overview

- Product boundary: read-only chat interface for staff to retrieve source-backed lookup facts across multiple business domains. The first production pilot is SML inventory stock/price.
- Main components: Fastify lookup service, Telegram polling/webhook adapter, LINE adapter, normalized message router, tenant Business Profile, query understanding layer, lookup orchestrator, Redis cache/session/dedup, SML MCP client, response formatter, audit logger, and offline Thai query evaluation tooling.
- External systems: Telegram Bot API, LINE Messaging API, SML MCP HTTP server, Redis, optional LLM provider.
- Data stores: Redis for idempotency locks, rate limits, short-lived lookup cache, and last-entity session context.
- Queue: BullMQ is reserved for slow/background work; it is not part of the default fast lookup path.

## Component Map

| Component | Responsibility | Planned files |
| --- | --- | --- |
| Server | Start Fastify, register routes, health/readiness, optional Telegram polling, graceful shutdown. | `src/server.ts`, `src/app.ts` |
| Telegram adapter | Poll or receive Telegram updates, verify webhook secret when enabled, normalize updates, enforce group mention/command rules, apply short follow-up context, send replies. | `src/channels/telegramAdapter.ts`, `src/channels/telegramPollingWorker.ts` |
| LINE adapter | Verify LINE signature from raw body, normalize events, enforce mention/prefix rules, apply short follow-up context, send replies. | `src/channels/lineAdapter.ts` |
| Business Profile | Tenant-specific Domain Profile v2 entities/actions/connectors, phrases, examples, aliases, locale, data-source labels, and reply style. Must be data/config, not hardcoded source. | `src/config/businessProfile.ts`, `profiles/*.json` |
| Query understanding | Classify tenant action/entity/query using context, Business Profile, alias/index expansion, and optional LLM when needed. | `src/core/queryParser.ts`, `src/core/queryUnderstanding.ts`, `src/core/llmParser.ts` |
| Lookup orchestrator | Resolve entity candidates, call cache/SML adapter, parallelize inventory stock and price, choose fallback behavior. | `src/core/lookupOrchestrator.ts`, `src/core/entityAdapter.ts` |
| SML client | Call `/call`, enforce read-only tool allowlist, parse `content[0].text`, validate schemas. | `src/integrations/smlClient.ts` |
| Cache/session | Redis cache, dedup, rate limit, readiness, multiple-match candidates, and last-entity context. | `src/services/cacheService.ts`, `src/services/redisStateService.ts` |
| Audit/logging/metrics | Structured lookup logs, hashed chat/user IDs, Prometheus-style counters/histograms without secrets or raw sensitive payloads. | `src/core/lookupTelemetry.ts`, `src/observability/*` |
| Thai query evaluation | Offline PyThaiNLP analysis of reviewed/redacted no-match and unsupported examples to propose aliases, context guards, and regression fixtures. It is not imported by runtime code. | `tools/thai-query-eval/*` |
| Slow jobs | Background retries, cache warming, alias/index refresh, optional LLM parsing. | `src/queues/*` |

## Runtime Boundary

The bot service owns:

- chat channel validation and response delivery
- message normalization
- tenant Business Profile loading and validation
- domain-neutral query understanding
- cache and session behavior
- connector read-only tool allowlist
- user-facing fallback text
- audit and metrics

SML owns:

- inventory master data for the current connector
- stock balance truth
- price truth
- SML-side role enforcement
- ERP/business calculations

## Default Data Flow

1. Input: Telegram polling fetches updates, or Telegram/LINE sends a webhook event.
2. Verification: webhook adapters validate provider secret/signature when webhook mode is enabled.
3. Dedup: Redis prevents duplicate replies for the same event/message.
4. Group gate: groups require mention, reply-to-bot, command, or configured prefix.
5. Context: Telegram/LINE can map `1`, a bare entity ID, or intent-only follow-up to the previous short-lived Redis context.
6. Profile: resolve the tenant Business Profile from channel/config.
7. Normalize: channel-specific payload becomes a common message model.
8. Understand: query understanding extracts action, entity type, and query/ID from context, Business Profile, aliases, deterministic rules, or optional LLM. In assist mode, Telegram can show a one-time user status while the slow-path parser runs.
9. Lookup: orchestrator checks tenant/entity/action-scoped Redis cache, then calls SML read-only tools on cache miss.
10. Format: formatter builds a concise reply with entity ID/label and inventory stock/price/freshness for the current adapter.
11. Reply: adapter sends to the originating chat.
12. Audit: logs outcome, latency, parser source, cache status, and SML tool usage.

See `data-flow.md` for sequence-level flows.

## Fast Path

Fast path must not use LLM or BullMQ.

```text
poll/webhook -> verify/gate -> normalize -> business profile -> deterministic parse -> cache/SML -> reply
```

Use it for:

- exact entity ID
- barcode-like input
- clear action questions from configured tenant phrases
- cached recent entity search
- numeric selection from recent multiple-match context

## Slow Path

Slow path may use BullMQ or optional LLM parsing.

Use it for:

- ambiguous follow-up questions that do not match short deterministic context
- SML timeout retry after fallback
- cache warming
- entity alias/index refresh from tenant profile or catalog data
- non-urgent observability export
- optional LiteLLM assist parse for ambiguous language or deterministic no-match that cannot be resolved by context/config
- offline PyThaiNLP evaluation of reviewed Thai examples for alias/context/test improvements

## Domain Profile Contract

Business Profile is the platform boundary that keeps the bot domain-neutral.

It should contain:

- `tenantId`, `businessType`, `locale`
- `domain.version=2`
- `domain.entities`, such as inventory item, customer, document, or job
- `domain.actions`, such as search, availability, price, balance, or status
- `domain.connectors`, mapping actions to read-only tools/APIs
- backward-compatible enabled intents such as `search_product`, `stock`, `price`, `stock_price` for the current inventory adapter
- action phrase sets and user-facing examples
- alias rules or links to a catalog-derived alias/index
- SML dataset/tenant labels and readiness status
- reply examples/style for help text and clarification

Rules:

- Product names, brands, local nicknames, and business examples must not be hardcoded in source.
- Source code may define generic intent schemas, parser contracts, and safety rules.
- LLM prompts must be generated from Business Profile Domain Profile data and must return schema-validated JSON: `action`, `entityType`, `query`, `searchTerms`, and `confidence`.
- The lookup orchestrator only receives structured queries; it does not parse raw chat text directly.
- In `shadow` mode, LLM parser output is logged/measured but does not change the user-facing reply.
- In `assist` mode, LLM parser output may be used only when deterministic parsing is unsupported or a deterministic lookup returns no match, and local validation/confidence checks pass.
- User-facing assist status/footer copy is configured in Business Profile reply style; it may reveal provider/model, but must still state that the source system is the truth. Raw provider outcomes remain in logs/metrics, not normal user replies.
- PyThaiNLP is a developer evaluation tool for lexical Thai segmentation and alias discovery; it must not become a source of lookup facts and must not run in the default request path.

## Failure Boundaries

| Failure | Behavior |
| --- | --- |
| Invalid Telegram/LINE verification | Reject; do not process or reply. |
| Duplicate event | Acknowledge/ignore; do not send duplicate reply. |
| Group message without gate | Ignore silently. |
| Parser cannot find intent | Reply with profile-driven unsupported/help-lite copy; do not invent lookup facts. |
| Friendly non-lookup text | Greeting, thanks, acknowledgement, help-style, sticker-only, or emoji-only messages return profile-driven friendly copy and do not call LLM/SML. |
| LLM parser invalid/timeout | Treat as unsupported or no-match; if configured, show safe assist failure copy without raw provider outcomes, raw prompt, raw provider payload, token, or source facts. Keep true outcomes in logs/metrics. |
| No entity found | Ask for clearer ID, model, descriptor, or keyword. |
| Multiple entities found | Present current-page choices and ask the user to choose. If the local candidate buffer is exhausted while the source reports more matches, ask the user to refine the query. |
| SML timeout/unavailable | Fail closed with safe fallback; never invent source facts. |
| SML malformed response | Log schema error, return safe fallback. |
| Redis unavailable | Continue with direct SML for low traffic if safe; disable cache-dependent follow-up context; alert. |
| Channel reply failure | Log and expose metric; do not retry indefinitely in request path. |
| Unauthenticated internal endpoint | Return `401`; `/health` remains public. |

## Performance Principles

- Exact ID path should skip broad search when safe.
- Stock and price calls should run concurrently after inventory entity resolution.
- Cache entity search longer than volatile source facts.
- Keep stock TTL short to reduce stale answers.
- Enforce timeout budgets at the SML client boundary.
- Use circuit breaker around SML to avoid piling traffic onto a failing dependency.
- Rate-limit by channel/chat/user to protect SML and channel APIs.

## Security Principles

- No write SML tools in MVP allowlist.
- No direct database or generic SQL MCP access.
- No arbitrary tool execution from user text or LLM output.
- Raw chat text can suggest a query, but structured parser/tool schemas decide what is called.
- No hardcoded business-specific vocabulary, product names, or brand aliases in source code.
- Business Profile changes must be validated and rollbackable like config changes.
- Redact secrets and sensitive identifiers in logs.
- Use hashed chat/user IDs in analytics logs unless operational debugging requires controlled access to raw IDs.
