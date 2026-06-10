# ADR: Read-Only Inventory Lookup Chatbot With Telegram-First Pilot

## Status

Accepted.

## Context

The first real use case is for store staff to ask stock and price questions in chat. The pilot started with auto-parts/construction-demo data, but the platform must remain reusable across business domains.

The SML team provided MCP documentation with read tools for product search, stock balance, and price, plus a write endpoint for sale reservation. The current MVP should not use write endpoints.

Performance matters. Common stock/price questions should not depend on LLM latency or background queue delay.

## Options

- Multi-agent, multi-department platform from the original blueprint: powerful, but too broad and slower to implement for the immediate parts lookup need.
- Agent-first LLM flow for every message: flexible, but slower, more expensive, and higher risk for hallucinated stock/price facts.
- Read-only fast lookup service with optional LLM parser: focused, safer, and faster for the current customer use case.

## Decision

Build a read-only inventory lookup chatbot:

- Telegram first for pilot testing.
- LINE after core lookup flow is stable.
- Fastify + TypeScript service.
- Redis for cache, dedup, rate limit, and short session context.
- SML MCP HTTP `/call` for read-only tools.
- BullMQ only for slow/background jobs.
- Optional LLM parser only for ambiguous messages.
- No `create_sale_reserve` or write SML tools in MVP.

## Scale And Failure Modes

- If SML is slow, direct hot-path lookups can exceed chat expectations. Use timeouts, short cache TTLs, and safe fallback.
- If group chats are noisy, the bot can spam or overload SML. Use mention/command gates and rate limits.
- If SML search quality is weak, no-match/multi-match rates rise. Add aliases/indexing before relying on LLM.
- If Redis is down, dedup/cache/session/rate-limit degrade. Decide whether to continue direct read-only lookups or mark readiness degraded.
- If stock cache TTL is too long, staff may see stale inventory. Keep stock TTL short and business-approved.

## Hidden Costs

- Telegram and LINE have different webhook and group semantics.
- SML response format wraps JSON inside `content[0].text`, which requires careful parsing and schema validation.
- Product names and common store phrases may need alias work.
- Tenant vocabulary must live in Business Profile or catalog-derived alias/index data, not source code.
- Observability is mandatory because user complaints will likely be "it was slow" or "it found the wrong item."

## Consequences

- Positive: fast first release, smaller blast radius, easier SML testing, safer read-only behavior.
- Negative: future write workflows will need a separate approval/audit/reconciliation design.
- Implemented follow-up: Redis-backed cache/dedup/rate limit and isolated pilot deploy on `192.168.2.109:3060`.
- Implemented follow-up: Business Profile v1 file/schema boundary for `construction-demo`.
- Remaining follow-up: confirm SML role/tenant, harden alias/search quality with real staff terms, and add optional LLM parser behind a feature flag.

## Regret Check

If the product later needs reservations, order creation, or department-level permissions, this architecture must grow a formal workflow engine, approval model, and write audit trail. That is acceptable because the MVP intentionally optimizes for fast and safe lookup first.
