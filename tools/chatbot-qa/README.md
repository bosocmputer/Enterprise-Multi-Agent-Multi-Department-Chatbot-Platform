# Chatbot QA Readiness

Use these fixtures and the readiness gate before inviting staff into the Telegram pilot.

The fixtures are reviewed QA examples. They may contain sample business queries, but they must not contain real Telegram tokens, chat IDs, user IDs, webhook secrets, raw provider payloads, or customer exports.

## Run Against A Server

```bash
BASE_URL=http://127.0.0.1:3060 \
INTERNAL_API_TOKEN=... \
npm run qa:readiness -- --summary-only
```

Run the slower LiteLLM path explicitly:

```bash
BASE_URL=http://127.0.0.1:3060 \
INTERNAL_API_TOKEN=... \
npm run qa:readiness -- --include-llm
```

Inside the production container, use the built JavaScript entrypoint:

```bash
docker exec parts-lookup-api node dist/tools/readinessGate.js --summary-only
```

Useful tuning env:

- `QA_CONCURRENCY_LEVELS=5,20,50`
- `QA_FAST_PATH_P95_MS=2000`
- `QA_INCLUDE_LLM=true`
- `QA_OUTPUT_PATH=/tmp/parts-lookup-readiness.json`
- `QA_SUMMARY_ONLY=true`

## Acceptance

- Scenario pass rate >= 95%
- Out-of-scope avoided rate = 100%
- Fast-path p95 <= configured threshold
- SML dependency error rate <= configured threshold
- LiteLLM assist can be slow, but it must not leak provider errors or block deterministic fast paths.
