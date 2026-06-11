# Current State

Last updated: 2026-06-11

## Latest Handoff

- Current production/dev state: LINE + Telegram production-ready demo runtime is implemented locally and deployable as an isolated Docker Compose project on `192.168.2.109`.
- Product scope was revised from a broad multi-department agent platform to a speed-first read-only inventory lookup chatbot that must stay reusable across business domains.
- Primary channels: LINE for staff operations, Telegram for pilot/debug/ops.
- Primary data source: SML MCP HTTP `/call` read-only tools.
- Current branch/release: local `main`; pilot service running on server port `3060`.

## Runtime Snapshot

- Local path: `/Users/nontawatwongnuk/dev_bos/Enterprise Multi-Agent & Multi-Department Chatbot Platform`
- Server/deploy path: `/home/bosscatdog/parts-lookup-chatbot`
- Pilot URL: `http://192.168.2.109:3060`
- Local service port: `3060` by default.
- Implemented app services: Fastify lookup service, SML read-only client, Domain Profile v2 normalization and validation, generic entity/action contracts, SML inventory adapter, deterministic parser, small-talk/non-lookup/out-of-scope guard, context guard for vague Thai follow-ups, optional LiteLLM slow-path parser with assist-mode status UX and concurrency/queue guard, response formatter, Redis-backed cache/dedup/rate limit/context state, Telegram polling worker, LINE webhook adapter, optional Telegram webhook route behind env flags, Prometheus-style `/metrics`, Telegram ops alerts.
- Implemented developer tooling: offline PyThaiNLP Thai query evaluation under `tools/thai-query-eval/` for reviewed/redacted no-match and unsupported examples, plus Chatbot QA readiness fixtures/gate under `tools/chatbot-qa/` and `src/tools/readinessGate.ts`.
- Deploy services: `parts-lookup-api` and dedicated `parts-lookup-redis` in Docker Compose project/network/volume names prefixed with `parts-lookup`.
- Implemented profile services: Business Profile file loader with backward-compatible v1 normalization into Domain Profile v2. `profiles/construction-demo.json` explicitly declares `inventory_item` actions/connectors for real SML construction-materials data at `192.168.2.248:3515`; `profiles/auto-parts-mock.json` is a non-production fixture proving the core can run another domain without source edits.
- Deferred app services: database/profile-service backed Business Profile store, optional BullMQ worker, external metrics collector, real customer SML tenant cutover.
- External dependency: SML MCP server confirmed at `http://192.168.2.248:3515`.
- Optional LLM dependency: LiteLLM Swagger/API confirmed at `http://192.168.2.248:4000`; model list currently exposes `openrouter/openrouter/free`.

## SML Connectivity Check

Last checked from this workstation and deploy server `192.168.2.109`:

- `192.168.2.248` is reachable on LAN by ping.
- `192.168.2.248:3515` accepts TCP connections and returns `200` from `/health`.
- `GET /tools` with `mcp-access-mode: sales` returns tool schemas.
- `POST /call` `search_product` works.
- `POST /call` `get_stock_balance` works with argument `code`.
- `POST /call` `get_product_price` works with argument `code`.
- Latest deploy check on 2026-06-10 found `192.168.2.248:3515` temporarily not accepting TCP connections; app deploy/auth/metrics passed, but full SML smoke is blocked until SML MCP is back.
- `192.168.2.248:3002` did not accept TCP connections during the earlier check.
- `192.168.2.248:3000` is a Next.js MIS app, not SML MCP.
- `192.168.2.248:8080` is Apache Tomcat and does not expose `/mcp`, `/tools`, `/call`, or `/health`.
- Test searches for auto parts terms such as `ผ้าเบรค`, `หัวเทียน`, and `โช๊ค` returned no products; broader terms such as `น้ำมัน` and `ยาง` returned sample/product-master data that appears construction/paint-related. Confirm tenant/data source with SML or business users.

## Active Work

- Goal: build a read-only generic lookup chatbot where staff can ask tenant-approved questions in Telegram and LINE without hardcoding business-specific vocabulary in source code.
- In progress: Telegram real-bot pilot is enabled; LINE code is ready but disabled until credentials and dedicated tunnel are configured. Core runtime now uses generic `entity`, `action`, `source`, `context`, and `disambiguation` metadata while keeping the inventory behavior compatible.
- Blocked: auto-parts customer data is not connected yet; current real SML data at `192.168.2.248:3515` is construction-materials data.
- Next safest implementation step: run the Chatbot QA readiness gate with and without LiteLLM assist, then invite dev/internal Telegram testers before expanding to staff.

## Known Gaps

- Application code: pilot runtime exists under `src/`.
- Testing: latest release candidate should pass Vitest, `npm run build`, prod smoke, and the Chatbot QA readiness gate before expanding Telegram pilot traffic.
- Server smoke: latest app deploy passed `GET /health`, unauthenticated internal endpoint rejection, authenticated `/metrics`, Redis readiness, and safe SML fallback; authenticated `/ready` is currently degraded because SML MCP is unavailable.
- Telegram pilot bot username: `employee_assistant_248_bot`.
- SML: least-privileged role, correct tenant/product dataset, timeout behavior, and search quality need verification.
- Security: SML tool allowlist is read-only; LINE/Telegram/internal/tunnel secrets must stay in untracked `.env`; production internal endpoints require bearer auth.
- Performance: cache TTLs, SML timeout budgets, Business Profile lookup, tenant/entity/action cache key cardinality, and exact/fuzzy lookup strategy need validation with real queries.
- UX: no-match, paged multi-match, refine prompt when source has more results than the local buffer, invalid/expired numeric selection, numeric selection after multi-match, exact-code display name enrichment, timeout, profile-driven greeting/help/thanks/ack/out-of-scope messages, small-talk/non-lookup guard, no SML/LLM calls for out-of-scope external/general questions, LiteLLM assist status/footer/friendly failure copy, duplicate update, private message, group mention/prefix, and group no-mention behavior are implemented/tested.
