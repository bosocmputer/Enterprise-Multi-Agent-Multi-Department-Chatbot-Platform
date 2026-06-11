# Testing

## Required Gates

Current required gate for the production-ready demo:

```bash
npm test
npm run build
curl -fsS http://localhost:<port>/health
curl -fsS -H "Authorization: Bearer <token>" http://localhost:<port>/ready
BASE_URL=http://localhost:<port> INTERNAL_API_TOKEN=<token> bash scripts/prod-smoke.sh
```

## Unit Tests

| Area | Required cases |
| --- | --- |
| Business Profile | schema validation, missing profile, disabled intent, tenant examples, alias expansion, invalid profile rollback behavior. |
| Query parser/understanding | stock, price, stock+price, search-only, unsupported text, Thai/English variants from Business Profile, product code, barcode-like input, context-only follow-up. |
| LLM slow-path parser | LiteLLM request shape, JSON-only parser output, malformed JSON, wrong enum, empty keyword/searchTerms, low confidence, timeout, truncated completion, shadow mode no user-facing change, assist status/footer/failure copy. |
| Thai query evaluation | PyThaiNLP tokenization fixture, custom dictionary from Business Profile aliases/examples, sensitive-key rejection, context-required phrase suggestions. |
| Group gate | Telegram mention, reply-to-bot, command, prefix, no mention; LINE mention component and no mention. |
| Dedup | duplicate webhook event sends at most one reply. |
| SML client | allowed tool call, blocked write tool, timeout, malformed JSON, missing `content[0].text`, schema mismatch. |
| Cache | hit/miss, TTL choice, no error cached as success, short negative cache. |
| Formatter | no match, multi match, success with stock only, success with price only, timeout fallback. |
| Redaction | logs do not include tokens, raw secrets, or large raw SML payloads. |

Latest local run on 2026-06-11:

- `npm test`: 15 files, 80 tests passed.
- `npm run build`: passed.

## Integration Tests

Use mocked channel and mocked SML first:

- Telegram private chat stock+price lookup.
- Telegram group without mention is ignored.
- Telegram group `/stock` command returns lookup.
- SML search returns no candidates.
- SML search returns multiple candidates.
- SML search returns one candidate and stock/price succeed.
- SML stock succeeds and price times out.
- Redis unavailable behavior follows architecture decision.

Current covered cases:

- Redis JSON cache set/get/TTL, dedup claim, rate-limit window, readiness ping.
- Telegram polling private message sends reply.
- Telegram group command sends reply.
- Telegram group without command/mention is ignored.
- Duplicate Telegram update is claimed once and does not send a duplicate reply.
- Telegram numeric selection after a multiple-match reply uses short Redis context.
- Invalid/expired numeric selection returns a safe clarification.
- LINE signature verification accepts valid HMAC and rejects invalid signatures.
- LINE private and group-prefix messages send replies; group chatter is ignored.
- Production internal endpoints require bearer auth.
- Exact-code price-only lookup enriches the display name when SML search returns it.
- `/metrics` exposes lookup counters/histograms after internal smoke.
- SML timeout/failure/circuit-open path returns a safe fallback through orchestrator tests.
- Alert dedup prevents repeated ops-chat messages for the same alert key.
- Business Profile v1 validates `profiles/construction-demo.json` and drives parser phrases, aliases, help examples, and fallback hints.
- LiteLLM parser validates JSON output, rejects hallucinated intent enums, rejects low confidence/empty keyword/empty search terms/timeouts/truncated completions, and records parser metrics.
- Telegram assist status sends at most one typing/status message for slow-path assist and does not send one for clear fast-path lookups.
- LINE assist status starts loading animation only for one-on-one slow-path assist.
- `/internal/parse` requires internal bearer auth and returns parser output without calling SML.
- Offline Thai query evaluation fixture exists for `มีปูนตราช้างเหลือไหม`, `ปูนตราช้าง`, `เอาแบบถูกสุดมีไหม`, `ตัวนี้ราคาเท่าไหร่`, `น้ำมัน ราคา`, and `PAINT-01424 ราคา`.
- Context guard replies with clarification for vague references such as `ตัวนี้ราคาเท่าไหร่` when no product context exists.
- Context guard resolves `ตัวนี้ราคาเท่าไหร่` against the last product when safe.
- Selection constraints such as `เอาแบบถูกสุดมีไหม` do not trigger SML search without enough context.
- Known bare Business Profile terms such as `ปูนตราช้าง` become search lookups instead of generic help.

Optional local Thai query evaluation gate:

```bash
python3 -m venv .cache/pythai-eval
. .cache/pythai-eval/bin/activate
python -m pip install -r tools/thai-query-eval/requirements.txt
python tools/thai-query-eval/thai_query_eval.py \
  --profile profiles/construction-demo.json \
  --input tools/thai-query-eval/fixtures/construction-demo.jsonl \
  --output /tmp/thai-query-eval.json
```

When SML endpoint is reachable, run read-only smoke only:

1. `GET /health`
2. `GET /tools`
3. `search_product`
4. `get_stock_balance`
5. `get_product_price`

Never call `create_sale_reserve` in standard smoke tests.

## Acceptance Scenarios

- Happy path: Telegram private message asks stock and price, bot replies with product code/name/unit/stock/price.
- Domain-neutral profile: adding a new tenant Business Profile changes examples/aliases without source-code edits.
- LINE private: verified LINE webhook asks price and gets a reply.
- LINE group: normal chatter is ignored; @mention stock query gets a reply.
- No match: bot asks for product code/model/brand, not a fabricated answer.
- Multiple match: bot asks user to choose among current-page candidates and supports `เพิ่ม` for the next page when more candidates exist.
- Numeric follow-up: after multiple match, replying `1` chooses candidate 1 with the previous stock/price intent.
- Intent follow-up: after a successful product lookup, replying `ราคา` or `สต็อก` uses the last product context.
- Context follow-up: after asking about a product class, replying only a brand/model phrase inherits the previous stock/search intent if confidence is high.
- Duplicate event: same webhook event is processed once.
- SML timeout: user receives safe fallback within 3 seconds.
- SML malformed response: bot logs schema error and does not expose raw payload.
- Blocked write tool: `create_sale_reserve` cannot be called from chatbot lookup flow.
- Rate limit: noisy user/group is throttled without affecting other chats.

## Performance Tests

Initial targets:

- exact cached lookup p95 < 300ms
- exact SML lookup p95 < 1.0s
- keyword search + stock + price p95 < 1.5s
- timeout fallback under 3.0s

Test with:

- repeated exact product code
- repeated common keyword
- repeated common keyword with Business Profile and alias cache enabled
- 20 concurrent Telegram-style requests
- SML slow response simulation
- Redis cache disabled

## Manual QA

- Telegram private flow: ask by product code, ask by keyword, ask follow-up question.
- Telegram group flow: no mention ignored; command/mention works.
- LINE private flow: raw-body signature validation works.
- LINE group flow: mention gate works.
- SML endpoint: confirm production vs sandbox before any real-data checks.
- LLM parser: when enabled, `POST /internal/parse` for `มีปูนตราช้างเหลือไหม` should return `intent=stock` and `keyword=ปูนตราช้าง`; Telegram replies should remain unchanged in shadow mode.
- Thai query eval: verify PyThaiNLP output suggests existing Business Profile aliases for `ปูนตราช้าง` and context-required candidates for vague phrases without adding Python to Docker runtime.
- Logs: confirm request IDs, cache status, SML latency, and no secret leakage.

Latest server smoke on `192.168.2.109:3060`:

- Telegram `getMe`: passed for bot username `employee_assistant_248_bot`.
- Telegram webhook cleanup: `deleteWebhook` with pending update cleanup passed before polling was enabled.
- `GET /health`: passed.
- Unauthenticated production `GET /ready`: returned `401`.
- Authenticated `GET /ready`: currently degraded with `sml: unavailable` and `redis: ok` because `192.168.2.248:3515` is not accepting TCP connections.
- `GET /metrics`: must expose `parts_lookup_requests_total` and `parts_lookup_sml_tool_duration_ms`.
- Authenticated `POST /internal/lookup` while SML is down: returned safe fallback, not fabricated stock/price.
- Full SML data smoke with `PAINT-01424` and `น้ำมัน ราคา` must be re-run when SML MCP is back.

## Release Gate

Before pilot:

- Tests/build pass.
- SML read-only smoke passes.
- `create_sale_reserve` and write tools are absent from chatbot allowlist.
- Channel secrets are loaded from secrets/env, not docs/source.
- Rollback path documented.
- Alerts for SML, Redis, and reply failures are configured or consciously deferred for pilot.
