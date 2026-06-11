# Tech Stack

## MVP Choices

| Area | Choice | Repo | Why |
| --- | --- | --- | --- |
| Runtime | Node.js LTS + TypeScript | - | Strong ecosystem for chat webhooks, Redis, and API clients. |
| HTTP server | Fastify | `https://github.com/fastify/fastify` | Fast, low overhead, good TypeScript support, plugin model. |
| Telegram | Direct Telegram Bot API adapter | `https://core.telegram.org/bots/api` | Keeps MVP dependency-light; enough for webhook verification, group gate, and `sendMessage`. |
| LINE | LINE Bot SDK for Node.js | `https://github.com/line/line-bot-sdk-nodejs` | Official SDK for Messaging API and signature handling patterns. |
| SML integration | Custom client over `/call` | SML internal endpoint | Keeps scope small and read-only. |
| Cache/session/dedup | Redis | - | Low-latency cache, locks, rate limits, session context. |
| Business Profile / Domain Profile v2 | JSON/Zod schema first, database/profile service later | - | Keeps tenant entities, actions, connector mappings, vocabulary, examples, aliases, and reply style out of source code. |
| Background jobs | BullMQ | `https://github.com/taskforcesh/bullmq` | Redis-backed jobs for slow/background work only. |
| Runtime schemas | Zod | `https://github.com/colinhacks/zod` | Validate env, channel payloads, SML parsed responses, and internal job payloads. |
| Env validation | envalid or Zod-based env module | `https://github.com/af/envalid` | Fail fast when required config is missing. |
| Logging | Pino | `https://github.com/pinojs/pino` | Structured JSON logs with redaction and high throughput. |
| Tracing/metrics | OpenTelemetry JS | `https://github.com/open-telemetry/opentelemetry-js` | Standard traces/metrics across webhook, cache, SML, and replies. |
| Circuit breaker | opossum or small local wrapper | `https://github.com/nodeshift/opossum` | Fail fast around SML if repeated failures occur. |
| Thai query evaluation | PyThaiNLP core package | `https://pythainlp.org/docs/5.3.4/` | Offline analysis of reviewed Thai no-match/unsupported examples; not installed in the app runtime image. |

## Optional Later

| Area | Option | Repo | Use when |
| --- | --- | --- | --- |
| LLM observability | Langfuse | `https://github.com/langfuse/langfuse` | Optional LLM parser is introduced and needs trace/eval visibility. |
| LLM regression tests | promptfoo | `https://github.com/promptfoo/promptfoo` | Prompts/parsers need CI checks for ambiguity and injection cases. |
| LLM security scanner | garak | `https://github.com/NVIDIA/garak` | Pre-production red-team pass for LLM-powered flows. |
| Document ingest | MarkItDown | `https://github.com/microsoft/markitdown` | Product manuals or PDFs become part of knowledge retrieval. |
| MCP protocol SDK | MCP TypeScript SDK | `https://github.com/modelcontextprotocol/typescript-sdk` | The service needs full MCP client/server protocol behavior beyond SML `/call`. |
| Telegram framework | grammY or Telegraf | `https://github.com/grammyjs/grammY`, `https://github.com/telegraf/telegraf` | Telegram workflows outgrow the direct adapter. |
| External policy engine | OPA or Cerbos | `https://github.com/open-policy-agent/opa`, `https://github.com/cerbos/cerbos` | Authorization becomes multi-role/multi-tenant enough to outgrow a local allowlist. |

## Explicit Non-Choices For MVP

- Do not use generic database MCP servers in production. The bot should not have arbitrary SQL/database access.
- Do not use Bun as the production runtime until Node.js implementation is stable and there is a measured reason.
- Do not use an agent memory framework for store chat memory; Redis last-entity context is enough.
- Do not put BullMQ in the hot path for every lookup.
- Do not call an LLM for exact ID or clear fast-path questions.
- Do not add PyThaiNLP or any Python tokenizer to the production hot path until an offline eval proves a measurable search-quality gain.
- Do not hardcode tenant product/category names, brand aliases, or business-specific examples in source code.

## Selection Notes

Telegram MVP uses a small direct adapter hidden behind `channels/telegram`. If workflows grow, replace it with grammY or Telegraf inside that boundary without changing the lookup core.
