# Blueprint: Domain-Agnostic Lookup Chatbot Platform

Last updated: 2026-06-11

## 1. Product Definition

Build a speed-first internal chatbot that lets staff ask tenant-approved lookup questions from chat across different business domains.

The platform must not hardcode business-specific product keywords, brands, categories, aliases, or examples in source code. Each tenant/business supplies a Business Profile with Domain Profile v2 that describes entities, actions, vocabulary, examples, aliases, and connector/source settings.

The first production shape is a read-only lookup service:

- Staff can ask from Telegram private chat, Telegram groups, LINE 1-1 chats, and LINE groups.
- For the first inventory pilot, the bot answers stock and price using SML MCP read-only tools.
- The bot is optimized for fast deterministic lookup before AI, using tenant-configured intent phrases and examples.
- AI/LLM parsing is optional and used only for ambiguous messages.
- Thai tokenization/segmentation tools such as PyThaiNLP are developer evaluation tools first; they help improve aliases, context guards, and tests without joining the runtime hot path.
- Write actions such as sale reservation creation are out of scope until explicitly approved.

## 2. Goals

- Answer common tenant lookup questions quickly and consistently.
- Make Telegram the easiest pilot/test channel before LINE rollout.
- Keep SML as the source of truth and avoid duplicated business rules.
- Support new business domains by changing tenant Business Profile data, not chatbot source code.
- Prevent accidental replies in noisy groups with mention/command gates.
- Avoid hallucinated source facts.
- Provide auditability for who asked what and which SML data was used.

## 3. Non-Goals For MVP

- No `create_sale_reserve` or other write endpoint.
- No admin UI.
- No multi-department RBAC unless later business scope needs it.
- No generic SQL or direct database access from the bot.
- No full source master sync unless the source-system search is not good enough.
- No LLM call for every request.
- No hardcoded tenant product/category terms, brand aliases, or business-specific keyword lists in source code.
- No long-term customer conversation memory.

## 4. Primary Use Cases

### 4.1 Availability And Price

User asks, using a phrase natural to that tenant:

```text
<entity keyword> <tenant action phrase>
```

System behavior:

1. Normalize channel payload into a common internal message.
2. Load the tenant Business Profile.
3. Detect action/entity/query from configured action phrases, context, or optional LLM parse.
4. Extract and normalize entity query or exact ID.
5. Search through tenant/entity/action-scoped cache or the connector adapter.
6. If exactly one confident entity is found, fetch allowed source facts for that action.
7. Reply with entity ID, label, source facts, and freshness.

### 4.2 Exact Entity ID Lookup

User asks:

```text
A001 ราคา
```

System behavior:

1. Recognize likely entity ID.
2. Skip broad search when the code is exact.
3. Fetch price, optionally stock if requested.
4. Reply with concise result.

### 4.3 Ambiguous Entity

User asks:

```text
ตัวท็อปมีไหม
```

System behavior:

1. Use last session context if available.
2. If context is insufficient, ask a disambiguation question.
3. If LLM parser is enabled, use it only to produce structured action/entity/query/search terms, never final facts.

### 4.4 Group Chat

System behavior:

- Telegram group: respond only when the bot is mentioned, the message replies to the bot, or a supported command is used.
- LINE group: respond only when the LINE mention component indicates the bot was mentioned or a configured prefix is used.
- Private chats: respond to supported lookup questions directly.

### 4.5 Domain-Specific Wording Without Hardcoding

User asks:

```text
<brand or local nickname>
```

System behavior:

1. Use recent session context to infer whether the user is still asking stock, price, or search.
2. Use tenant Business Profile aliases and examples to normalize wording.
3. If deterministic config cannot parse the message, optional LLM parser may emit structured JSON with `action`, `entityType`, `query`, `searchTerms`, and `confidence`.
4. Search SML with normalized terms and aliases.
5. If the connector returns no or many candidates, ask the user to clarify. Do not fabricate a matching entity.

## 5. Architecture

```text
Telegram Webhook     LINE Webhook
       |                  |
       +-------> Fastify Webhook Service
                         |
                  Channel Adapters
        verify -> dedup -> normalize -> group gate
                         |
                    Query Router
                         |
             Business Profile + Session Context
                         |
               Query Understanding Layer
        deterministic config parser / alias index
                    |                         |
              clear intent                ambiguous
                    |                         |
                    |                 Optional LLM Parser
                    |                         |
                    +-------> Lookup Orchestrator
                                  |
                            Redis Cache
                           hit / miss
                                  |
                             SML MCP Client
                                  |
          action connector -> read-only source tools
                                  |
                           Response Formatter
                                  |
                         Telegram / LINE Reply
                                  |
                              Audit Log
```

## 6. Hot Path Contract

The default lookup path must not enqueue jobs and must not call LLM.

Hot path:

```text
webhook -> verify -> normalize -> load business profile -> deterministic parse -> cache/SML -> reply
```

Use BullMQ only when a task is intentionally slow or asynchronous:

- SML timeout retry after the user already received a fallback.
- Entity alias/index refresh from tenant catalog or external profile source.
- Offline Thai query evaluation from reviewed/redacted no-match and unsupported examples.
- Cache warming.
- Audit export.
- Optional LLM parsing that may exceed chat response budget.

## 6.1 Business Profile / Domain Profile Contract

Business Profile is tenant-specific data loaded from env/config, database, or a profile service. It is not hardcoded in TypeScript source.

Minimum shape:

```json
{
  "tenantId": "customer-a",
  "businessType": "retail",
  "locale": "th-TH",
  "domain": {
    "version": 2,
    "defaultEntityType": "inventory_item",
    "entities": [{ "type": "inventory_item", "label": "สินค้า" }],
    "actions": [
      {
        "id": "availability",
        "legacyIntent": "stock",
        "entityTypes": ["inventory_item"],
        "phrases": ["มีไหม", "เหลือไหม"],
        "commandAliases": ["stock"]
      },
      {
        "id": "price",
        "legacyIntent": "price",
        "entityTypes": ["inventory_item"],
        "phrases": ["ราคา", "เท่าไร"],
        "commandAliases": ["price"]
      }
    ],
    "connectors": [
      {
        "id": "sml-inventory-readonly",
        "source": "sml",
        "readOnly": true,
        "entityTypes": ["inventory_item"],
        "allowedTools": ["search_product", "get_stock_balance", "get_product_price"],
        "actionToolMap": {
          "search": "search_product",
          "availability": "get_stock_balance",
          "price": "get_product_price"
        }
      }
    ]
  },
  "enabledIntents": ["search_product", "stock", "price", "stock_price"],
  "intentPhrases": {
    "stock": ["มีไหม", "เหลือไหม"],
    "price": ["ราคา", "เท่าไร"],
    "search_product": ["หา", "ค้นหา"]
  },
  "examples": [
    { "text": "<domain example>", "intent": "stock", "keyword": "<normalized keyword>" }
  ],
  "aliases": [
    { "from": "<local nickname>", "to": ["<catalog term>", "<brand term>"] }
  ],
  "sml": {
    "datasetLabel": "customer-a",
    "tenantStatus": "demo"
  }
}
```

Rules:

- Source code may define generic intent schemas and safety constraints only.
- Entity names, brands, local nicknames, and business-specific examples belong in Business Profile or an alias/catalog index.
- LLM prompts must be generated from the profile and must return schema-validated JSON only.
- Runtime core works with generic `entity`, `action`, `source`, `context`, and `disambiguation` metadata; inventory fields are compatibility surfaces of the current SML adapter.
- If the profile is missing or invalid, production startup must fail fast or disable the affected tenant.

## 7. SML MCP Read-Only Contract

Use SML HTTP `/call` first because it is simpler and easier to debug than full MCP JSON-RPC for this service.

Read-only tools for MVP:

- `search_product`
- `get_stock_balance`
- `get_product_price`

Out of scope:

- `create_sale_reserve`
- analytics tools
- customer account outstanding
- supplier/purchase tools
- any tool that creates, updates, reserves, or mutates ERP data

The SML response shape wraps JSON in `content[0].text`; the client must parse it as JSON and validate the parsed payload with schemas before use.

## 8. Latency Budget

Targets are measured from webhook receipt to reply send attempt.

| Path | Target |
| --- | ---: |
| Health endpoint | p95 < 50ms |
| Telegram exact code with cache | p95 < 300ms |
| Exact code with SML call | p95 < 1.0s |
| Keyword search + stock + price | p95 < 1.5s |
| Ambiguous query with LLM parser | p95 < 3.0s |
| SML timeout fallback | reply within 3.0s |

Implementation choices:

- Parallelize stock and price calls after the inventory entity is resolved.
- Use short TTL cache for stock/price.
- Use longer TTL cache for entity search and aliases.
- Set hard timeouts on all outbound SML, Telegram, LINE, Redis, and LLM calls.

## 9. Cache Strategy

Redis keys are implementation contracts, not user-visible API.

| Data | Example key | TTL | Notes |
| --- | --- | ---: | --- |
| Webhook dedup | `dedup:{channel}:{eventId}` | 5-15m | Prevent duplicate replies. |
| Entity search | `lookup:{tenantId}:entity:{entityType}:search:{normalizedQuery}` | 5-30m | Safe to cache longer than volatile facts. |
| Tenant profile | `profile:{tenantId}` | 5-30m | Config/profile cache; invalidate on profile update. |
| Alias/search index | `alias:{tenantId}:{normalizedKeyword}` | 5-60m | Optional expansion from profile/catalog, not hardcoded code. |
| LLM parse result | `llm:parse:{tenantId}:{messageHash}` | 5-30m | Optional structured parse cache; never cache final source facts. |
| Price/action fact | `lookup:{tenantId}:entity:{entityType}:action:{action}:price:{entityId}` | 1-10m | Tune with SML/business rules. |
| Availability/action fact | `lookup:{tenantId}:entity:{entityType}:action:{action}:stock:{entityId}` | 15-60s | Keep short to avoid stale values. |
| Last query context | `session:{channel}:{chatId}:{userId}:lastEntity` | 15-60m | Used for follow-up questions. |
| Rate limit | `rl:{channel}:{chatId}:{userId}` | 1m | Protect SML and bot. |

Replies that use cached stock should include a short freshness indicator when helpful.

## 10. User Error Handling

The bot must prefer clarification over guessing.

Required states:

- No entity found: ask for clearer ID, model, descriptor, or keyword.
- Multiple entities found: show top 3-5 choices with entity IDs and labels.
- Missing intent: show short examples from that tenant's Business Profile.
- Unsupported message type: ignore or give a concise supported-format reply depending on channel.
- SML timeout: say the stock/price system is slow and ask the user to retry.
- SML unavailable: fail closed; do not invent stock or price.
- Group without mention/command: ignore silently.

## 11. Security And Safety

- Verify Telegram secret token or webhook path secret.
- Verify LINE signature using the raw request body.
- Store all channel tokens and SML endpoint config in environment/secret manager only.
- Redact tokens, phone numbers, and raw sensitive SML payloads from logs.
- Do not pass raw chat messages directly into SML tools without structured parsing.
- Do not allow arbitrary tool names from the LLM or user text.
- Do not hardcode business-specific product/category keywords, brand aliases, or tenant examples in source code.
- Do not feed raw channel logs into Thai query evaluation; use reviewed/redacted examples without chat IDs, user IDs, tokens, secrets, or raw provider payloads.
- Validate LLM parse output with a strict JSON schema and confidence threshold.
- Maintain an explicit allowlist of SML tools.
- Use least-privileged `mcp-access-mode`; confirm whether `general` can call all three read-only tools, otherwise use `sales`.
- Do not expose internal SML errors verbatim to users.

## 12. Observability

Every request should have a correlation ID that follows:

```text
webhook request -> normalized message -> cache lookup -> SML calls -> reply attempt -> audit event
```

Log fields:

- `requestId`
- `channel`
- `chatType`
- `chatIdHash`
- `userIdHash`
- `messageId`
- `intent`
- `action`
- `entityType`
- `tenantId`
- `businessType`
- `queryHash`
- `parserSource`
- `parserConfidence`
- `entityId`
- `cacheHit`
- `smlTool`
- `smlLatencyMs`
- `replyLatencyMs`
- `outcome`
- `errorCode`

Metrics:

- webhook request count by channel
- ignored group message count
- parser outcome count
- parser source count: deterministic, context, alias, LLM
- LLM parse latency, timeout, low-confidence count when enabled
- cache hit ratio
- SML latency and error rate by tool
- reply latency and error rate by channel
- dedup/rate-limit count
- no-match and multi-match rate

## 13. Tech Stack

MVP:

- Node.js LTS
- TypeScript
- Fastify
- Telegram: direct Bot API adapter for MVP; grammY or Telegraf optional later
- LINE: official LINE Bot SDK
- Redis
- BullMQ for slow/background jobs
- Zod for payload/tool response schemas
- Pino for structured logs
- OpenTelemetry for traces and metrics

Optional after MVP:

- Langfuse for LLM observability and prompt traces
- promptfoo for prompt/eval regression tests
- MarkItDown for manual/document ingestion if product manuals become part of the scope
- MCP TypeScript SDK if the service later needs full MCP client/server protocol behavior

## 14. Release Gates

Before production pilot:

- Unit tests pass.
- Build passes.
- Telegram webhook smoke passes.
- SML health/read-only smoke passes.
- LINE signature test passes before LINE rollout.
- No write SML tool is configured in the allowlist.
- Redis unavailable test returns safe fallback.
- SML timeout test returns safe fallback under 3 seconds.
- Duplicate webhook test sends at most one reply.
- Group no-mention test sends no reply.
- Multiple-match test asks the user to choose.

## 15. Open Decisions

- SML MCP base URL is currently `http://192.168.2.248:3515`; confirm whether this points to the correct production/sandbox tenant for the target customer.
- Confirm which `mcp-access-mode` is least privileged for `search_product`, `get_stock_balance`, and `get_product_price`.
- Confirm why common target-tenant terms returned no products during smoke testing before treating search quality as production-ready.
- Confirm acceptable stock cache TTL from business users.
- Confirm whether price can be cached and for how long.
- Decide the first Business Profile storage source: env file, JSON config, database table, or profile service.
- Decide how tenant profile updates are validated and rolled back.
- Decide whether entity alias search requires local indexing after testing source-system search quality.

## 16. Suggested Implementation Order

1. Build TypeScript/Fastify skeleton with `/health`.
2. Implement config validation and secret placeholders.
3. Implement SML client with schemas and read-only allowlist.
4. Add Business Profile schema, validation, and tenant-safe defaults.
5. Move deterministic intent phrases/examples out of source and into Business Profile.
6. Implement Telegram private chat lookup.
7. Add Redis cache/dedup/rate limit.
8. Add Telegram group mention/command gate.
9. Add LINE webhook signature and group mention support.
10. Add optional session context for follow-up questions.
11. Add optional alias/index expansion from Business Profile or catalog source.
12. Add optional LLM parser only for ambiguous query tests.
13. Add BullMQ background jobs only where real slow-path need exists.
