# Data Flow

## 1. Fast Stock/Price Lookup

Use this path for clear product code or keyword queries that the tenant Business Profile can parse deterministically.

```mermaid
sequenceDiagram
  participant User
  participant Channel as LINE/Telegram
  participant Adapter as Channel Adapter
  participant Profile as Business Profile
  participant Router as Query Router
  participant Cache as Redis Cache
  participant SML as SML MCP /call
  participant Reply as Reply Formatter
  participant Audit as Audit Logger

  User->>Channel: "<product keyword> มีไหม ราคาเท่าไร"
  Channel->>Adapter: Webhook event
  Adapter->>Adapter: Verify, dedup, group gate, normalize
  Adapter->>Router: NormalizedMessage
  Router->>Profile: Load tenant intent phrases/aliases
  Profile-->>Router: Business Profile
  Router->>Router: Deterministic parse intent=stock_price, keyword
  Router->>Cache: Get product/search/stock/price cache
  alt cache hit
    Cache-->>Router: Cached result
  else cache miss
    Router->>SML: search_product(keyword)
    SML-->>Router: Product candidates
    Router->>SML: get_stock_balance(code)
    Router->>SML: get_product_price(code)
    SML-->>Router: Stock + price
    Router->>Cache: Store result with TTL
  end
  Router->>Reply: Build channel-specific reply
  Reply->>Channel: Send reply
  Router->>Audit: outcome, latency, cache, SML tools
```

Rules:

- Do not call LLM on this path.
- Do not enqueue BullMQ job on this path.
- Do not hardcode business-specific product names, brands, or aliases in source code.
- Intent phrases and examples come from Business Profile.
- Fetch stock and price concurrently after product resolution.
- Validate every SML parsed response before formatting.

## 2. Ambiguous Follow-Up

Use this path when the user depends on previous context.

```mermaid
sequenceDiagram
  participant User
  participant Adapter
  participant Session as Redis Session
  participant Profile as Business Profile
  participant Parser as Parser/Optional LLM
  participant Lookup as Lookup Orchestrator

  User->>Adapter: "แล้วตัวท็อปล่ะ"
  Adapter->>Session: Load last product/search context
  Adapter->>Profile: Load tenant profile/examples/aliases
  alt context sufficient
    Session-->>Parser: Prior product/search context
    Profile-->>Parser: Tenant vocabulary
    Parser->>Lookup: Structured query
  else context missing
    Parser-->>Adapter: Ask clarification
  end
```

Rules:

- LLM may only emit structured parse output such as intent, keyword, constraints, and confidence.
- LLM output must not select arbitrary SML tool names.
- LLM prompt context must be generated from Business Profile data, not source-coded tenant keywords.
- If confidence is low, ask a clarification question instead of guessing.

## 3. No Match

```text
search_product(keyword) returns []
-> if LLM assist is enabled, parse once for safer searchTerms
-> retry search_product with validated assist terms only
-> reply: "ไม่พบสินค้า ลองส่งรหัสสินค้า รุ่น ยี่ห้อ หรือคำค้นเพิ่ม"
-> do not call stock/price
-> audit outcome=no_match
```

Assist rules:

- Send at most one assist status per incoming user message.
- Do not run assist for exact code or clear deterministic queries that already return SML candidates.
- Reject assist output on timeout, malformed JSON, invalid schema, low confidence, empty keyword/search terms, or truncated provider completion.
- Never use LLM output as stock, price, or product truth; SML remains the only source for facts.

## 4. Multiple Matches

```text
search_product(keyword) returns many candidates
-> collect a bounded candidate set
-> show 5 candidates at a time
-> reply with product code/name/unit choices
-> store candidates plus current page in short session context
-> next user reply can choose by page-relative number/code or ask for "เพิ่ม"
```

The bot must not choose a product when confidence is insufficient.

## 5. SML Timeout

```mermaid
sequenceDiagram
  participant Lookup
  participant SML
  participant Reply
  participant Queue as BullMQ optional
  participant Audit

  Lookup->>SML: Call read-only tool with timeout
  SML--xLookup: Timeout
  Lookup->>Reply: Safe fallback within 3s
  Lookup->>Audit: outcome=sml_timeout
  opt retry later if useful
    Lookup->>Queue: enqueue slow retry/cache warm
  end
```

Rules:

- User-facing reply must not expose raw SML error details.
- Retry must be bounded.
- Do not spam the channel with late replies unless the user experience explicitly supports it.

## 6. Channel Group Gate

Telegram group accepts a message only if one is true:

- bot is mentioned
- message replies to the bot
- supported command is used, such as `/stock`, `/price`, `/find`
- configured prefix is used

LINE group accepts a message only if one is true:

- LINE mention component marks `isSelf: true`
- configured prefix is used

Private chats do not require mention.

## 7. Audit Event Shape

Minimum event fields:

```json
{
  "requestId": "req_...",
  "channel": "telegram",
  "tenantId": "tenant-a",
  "businessType": "retail",
  "chatType": "group",
  "chatIdHash": "hash",
  "userIdHash": "hash",
  "messageId": "message id",
  "intent": "stock_price",
  "productKeyword": "<normalized keyword>",
  "parserSource": "deterministic",
  "parserConfidence": 0.98,
  "productCode": "A001",
  "cacheHit": false,
  "smlTools": ["search_product", "get_stock_balance", "get_product_price"],
  "latencyMs": 842,
  "outcome": "success"
}
```

Do not log channel tokens, SML credentials, raw phone numbers, raw customer exports, or large raw SML payloads.
