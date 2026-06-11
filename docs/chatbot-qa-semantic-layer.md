# Chatbot QA Semantic Layer

This project-owned semantic layer defines how to evaluate the lookup chatbot before Telegram staff rollout. It uses app metrics, server logs, QA fixtures, and smoke/readiness outputs as source material. It does not require a warehouse or BI connector.

## Source Of Truth

| Source | Use | Caveat |
| --- | --- | --- |
| `/metrics` | Runtime counters, latency histograms, parser path, outcome labels. | Process-local unless scraped externally. |
| Server logs | Hashed request traces, optional QA trace, dependency errors, LLM outcomes, alert context. | Raw text/replies only when QA trace flags are enabled for staff pilot; never use raw chat IDs, user IDs, tokens, payloads, or chain-of-thought. |
| QA fixtures | Reviewed scenario expectations and transcript examples. | Construction examples are fixture data, not runtime core vocabulary. |
| Smoke/readiness reports | Release gate evidence for scenario pass rate and load behavior. | Treat as point-in-time evidence. |

## Taxonomy

| Field | Values | Meaning |
| --- | --- | --- |
| `conversation_scope` | `lookup_like`, `coaching`, `friendly`, `help`, `out_of_scope_current_info`, `out_of_scope_general` | What kind of conversation the bot classified before lookup. |
| `parser_path` | `deterministic`, `llm_assist`, `none` | Which parser path was used. `none` means no product lookup parser was needed. |
| `reply_policy` | `lookup`, `coaching`, `help`, `friendly`, `refuse_redirect` | Why the bot chose that reply shape. |
| `source` | `sml`, `none`, `unknown` | Whether a source connector was used. Out-of-scope should be `none`. |
| `status` | `success`, `multiple_matches`, `needs_refinement`, `no_match`, `capability_gap`, `unsupported`, `dependency_error` | Lookup result outcome. |
| `result_quality` | `accepted`, `needs_refinement`, `warn`, `not_checked` | Search-quality guard outcome after source results are returned. |
| `batch_items` | integer | Number of newline-separated questions in a bounded batch message. |
| `batch_outcome` | `completed`, `mixed`, `too_many`, `too_long`, or joined item outcomes | Batch handling result for channel-level review. |

## KPIs

| KPI | Definition | Pilot Target |
| --- | --- | --- |
| Scenario pass rate | Passed QA turns / executed QA turns. | `>= 95%` |
| Out-of-scope avoided rate | Out-of-scope turns with `source=none` and `parser_path=none` / all out-of-scope turns. | `100%` |
| Fast-path p95 | p95 latency for exact-id and deterministic context follow-up turns. | `<= 500ms` warm cache, `<= 2000ms` when SML is touched |
| LLM assist p95/max | p95/max latency for `parser_path=llm_assist`. | Informational during pilot; must show user status and avoid backlog |
| SML dependency error rate | `dependency_error` lookups / lookup attempts. | `0%` for release gate unless SML maintenance is known |
| Capability-gap volume | `capability_gap` turns by capability id. | Informational; use top gaps to request new read-only MCP tools |
| Duplicate reply rate | Duplicate handled update replies / handled updates. | `0%` |
| Rate-limit safety | Over-limit traffic is ignored or safely replied without SML overload. | No app crash, no duplicate replies |
| Batch safety | Multi-line batches are bounded, processed sequentially, and do not save ambiguous selection context. | No wrong-context numeric selection after batch |
| Result-quality guard | Broad weak matches become `needs_refinement` instead of showing misleading candidates. | No obviously unrelated candidates shown to staff |

## Release Gate

Run the readiness gate before adding non-dev Telegram users:

```bash
BASE_URL=http://127.0.0.1:3060 \
INTERNAL_API_TOKEN=... \
npm run qa:readiness -- --summary-only
```

Run the slower model path when preparing to invite staff:

```bash
BASE_URL=http://127.0.0.1:3060 \
INTERNAL_API_TOKEN=... \
npm run qa:readiness -- --include-llm --summary-only
```

The readiness report is safe to share when `includeText=false` because it emits text hashes and omits raw QA text/reply text by default.

## Review Loop

1. Add reviewed, redacted tester turns to `tools/chatbot-qa/fixtures/human-qa-transcript.sample.jsonl` or a copied local fixture.
2. Convert stable expectations into `tools/chatbot-qa/fixtures/human-qa-scenarios.json`.
3. Run `npm test`, `npm run build`, and `npm run qa:readiness`.
4. Review failed turns by category: parser, context, SML dependency, out-of-scope, or UX copy.
5. Review `needs_refinement` turns separately: if the guard is too strict, adjust Business Profile aliases/index data first; use `RESULT_QUALITY_MODE=warn` only as a rollback.
6. Only move a tenant-specific phrase into a Business Profile or fixture, never into runtime core source.
