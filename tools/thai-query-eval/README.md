# Thai Query Evaluation

Offline PyThaiNLP tooling for improving Thai lookup quality without adding Python to the production Node.js runtime.

Use this when no-match or unsupported messages increase and you need to convert reviewed staff examples into Business Profile aliases, context guards, and regression fixtures. Do not feed raw Telegram/LINE logs directly into this tool; export only reviewed/redacted records with no chat IDs, user IDs, tokens, or secrets.

## Setup

```bash
python3 -m venv .cache/pythai-eval
. .cache/pythai-eval/bin/activate
python -m pip install -r tools/thai-query-eval/requirements.txt
```

The requirement intentionally uses core `pythainlp` instead of `pythainlp[compact]` or `full`. The default evaluation engine is `newmm-safe`, so we do not need optional ICU-backed dependencies for this first pass. This tooling is not copied into the app Docker runtime.

## Run

```bash
PYTHAINLP_DATA=.cache/pythainlp-data \
python tools/thai-query-eval/thai_query_eval.py \
  --profile profiles/construction-demo.json \
  --input tools/thai-query-eval/fixtures/construction-demo.jsonl \
  --output /tmp/thai-query-eval.json
```

Add `--include-text` only when the input file is already reviewed and safe to echo in output artifacts.

## Input Shape

JSONL is preferred:

```json
{"id":"thai-001","text":"มีปูนตราช้างเหลือไหม","expectedIntent":"stock","outcome":"no_match","source":"reviewed_manual_fixture"}
```

Allowed metadata fields are intentionally narrow. The script rejects records with sensitive keys such as chat IDs, user IDs, auth headers, tokens, secrets, passwords, or provider payloads.

## Output Use

- `suggestions.contextRequiredPhrases`: generic follow-up phrases that should require Redis context before lookup.
- `suggestions.aliases`: existing Business Profile aliases that matched poor-quality examples.
- `suggestions.noMatchTokenGroups`: frequent tokens to review for catalog aliases or SML search tuning.
- `suggestions.regressionFixtures`: stable examples to port into parser/context tests.

PyThaiNLP helps with lexical Thai analysis. LiteLLM remains the semantic slow-path parser in `shadow` mode, and SML remains the only source of stock/price facts.
