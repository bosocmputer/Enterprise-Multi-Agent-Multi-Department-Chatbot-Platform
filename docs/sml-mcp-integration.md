# SML MCP Integration

## Purpose

The chatbot uses SML MCP as the source of truth for product search, stock balance, and product price.

MVP integration is read-only and uses HTTP `/call` instead of full MCP JSON-RPC because `/call` is simpler, faster to debug, and enough for the first chatbot service.

## Expected Base URL

SML team confirmed the reachable MCP endpoint:

```text
http://192.168.2.248:3515
```

Runtime must read this from environment:

```text
SML_MCP_BASE_URL
```

Do not hardcode the base URL in source code.

## Connectivity Status

Last local and deploy-server check:

- Host `192.168.2.248` responds to ping.
- Port `3515` accepts TCP connections from both the development machine and deploy server `192.168.2.109`.
- `GET /health` returns `200` and a tool list.
- `GET /tools` with `mcp-access-mode: sales` returns schemas.
- `POST /call` read-only tools work.
- Port `3002` did not accept connections during the earlier check.
- Ports `3000` and `8080` were open but served other applications.

Before production answers, confirm with SML/business users:

- whether it is production or sandbox
- role required for read-only tools
- expected response shapes for real product data
- correct tenant/product dataset for the auto parts store

## Allowed Tools For MVP

| Tool | Use | Required arguments |
| --- | --- | --- |
| `search_product` | Find candidate products from keyword. | `keyword` |
| `get_stock_balance` | Read stock balance for a product. | `code` |
| `get_product_price` | Read price for a product. | `code` |

Blocked tools:

- `create_sale_reserve`
- customer lookup
- supplier lookup
- account outstanding
- incoming goods
- sales analytics
- any create/update/write tool

## Role Header

Every call requires:

```text
mcp-access-mode: <role>
```

Use the least-privileged role that can call all three MVP tools.

Open decision:

- Tool table says `search_product`, `get_stock_balance`, and `get_product_price` are `general+`.
- Role table says `general` is price-only.
- Confirm with SML whether `general` can call all three. If not, use `sales` and keep local allowlist read-only.

## Direct REST Call Shape

```http
POST /call
Content-Type: application/json
mcp-access-mode: sales

{
  "name": "search_product",
  "arguments": {
    "keyword": "ผ้าเบรค vigo"
  }
}
```

The service must construct the tool name from a local enum/allowlist, not from raw user text or LLM output.

Stock and price call shape:

```http
POST /call
Content-Type: application/json
mcp-access-mode: sales

{
  "name": "get_stock_balance",
  "arguments": {
    "code": "PAINT-01424"
  }
}
```

```http
POST /call
Content-Type: application/json
mcp-access-mode: sales

{
  "name": "get_product_price",
  "arguments": {
    "code": "PAINT-01424",
    "price_type": "auto",
    "limit": 5
  }
}
```

## Response Shape

Vendor docs show:

```json
{
  "content": [
    {
      "type": "text",
      "text": "[{\"item_code\":\"A001\",\"name\":\"น้ำตาลทราย\",\"unit\":\"ถุง\"}]"
    }
  ]
}
```

Important contract:

- `content[0].text` is a JSON string.
- Parse it once as JSON.
- Validate the parsed result with a Zod schema before use.
- Treat malformed or unexpected payloads as SML integration errors.

Observed `search_product` result shape:

```json
{
  "keyword": "น้ำมัน",
  "total_found": 58,
  "returned": 3,
  "summary": "แสดง 3 จาก 58 รายการที่พบ",
  "products": [
    {
      "code": "PAINT-01424",
      "name": "Beger น้ำมันสน 100 เมตร (Premium)"
    }
  ]
}
```

Observed stock and price results use `code`, `stocks`, `products`, and nested `prices`. Schemas should accept only fields the bot needs and ignore extra fields.

## Client Responsibilities

The chatbot SML client must:

- enforce read-only allowlist
- set hard request timeout
- attach role header
- parse `content[0].text`
- validate tool-specific response schema
- normalize field names if SML varies them
- return typed domain objects to the lookup orchestrator
- redact request/response details in logs
- record tool latency and outcome metrics

## Timeout And Retry

Recommended initial budgets:

| Operation | Timeout | Retry in request path |
| --- | ---: | ---: |
| `search_product` | 1200ms | 0-1 |
| `get_stock_balance` | 1200ms | 0-1 |
| `get_product_price` | 1200ms | 0-1 |

Global user-facing fallback should be sent within 3000ms.

Do not retry indefinitely. Retrying SML during an outage can make the outage worse.

## Circuit Breaker

Open a short-lived circuit when SML repeatedly times out or returns server errors.

Initial behavior:

- fail fast for new requests
- return safe fallback
- keep `/health` alive but `/ready` degraded
- emit alert metric/log
- automatically half-open after a cool-down

## Cache Rules

Cache SML results in Redis with separate TTLs:

- product search: 5-30 minutes
- price: 1-10 minutes after business approval
- stock: 15-60 seconds after business approval

Do not cache errors as successful results. Negative/no-match caching may be allowed for a very short TTL, such as 30-60 seconds, to reduce repeated typo traffic.

## Smoke Test Plan

Current smoke result:

- `/health` works on `http://192.168.2.248:3515`.
- `/tools` works with role `sales`.
- `/mcp` requires `Accept: application/json, text/event-stream`.
- `search_product("ผ้าเบรค")`, `search_product("หัวเทียน")`, and `search_product("โช๊ค")` returned no products.
- `search_product("น้ำมัน")` returned products.
- `get_stock_balance({ code: "PAINT-01424" })` returned warehouse stock.
- `get_product_price({ code: "PAINT-01424", price_type: "auto" })` returned barcode price.

Repeat smoke after SML confirms the correct auto-parts tenant/data:

1. `GET /health`
2. `GET /tools` with selected role
3. `POST /call` `search_product` with a safe known keyword
4. Pick one returned product code
5. `POST /call` `get_stock_balance`
6. `POST /call` `get_product_price`
7. Confirm schema fields and latency

Do not call `create_sale_reserve` during read-only smoke tests.
