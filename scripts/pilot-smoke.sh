#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3060}"
EXACT_QUERY="${EXACT_QUERY:-PAINT-01424 มีไหม ราคาเท่าไร}"
KEYWORD_QUERY="${KEYWORD_QUERY:-น้ำมัน ราคา}"
AUTH_HEADER=()
if [[ -n "${INTERNAL_API_TOKEN:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${INTERNAL_API_TOKEN}")
fi

json_post() {
  local text="$1"
  curl -fsS \
    -X POST "$BASE_URL/internal/lookup" \
    "${AUTH_HEADER[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"$text\"}"
}

require_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf "smoke failed: %s did not contain %q\n" "$label" "$needle" >&2
    printf "%s\n" "$haystack" >&2
    exit 1
  fi
}

printf "smoke: %s\n" "$BASE_URL"

health="$(curl -fsS "$BASE_URL/health")"
require_contains "$health" '"status":"ok"' "health"

ready="$(curl -fsS "${AUTH_HEADER[@]}" "$BASE_URL/ready")"
require_contains "$ready" '"status":"ok"' "ready"
require_contains "$ready" '"sml":"ok"' "ready"

exact="$(json_post "$EXACT_QUERY")"
require_contains "$exact" '"status":"success"' "exact lookup"
require_contains "$exact" "PAINT-01424" "exact lookup"

keyword="$(json_post "$KEYWORD_QUERY")"
require_contains "$keyword" '"status":"multiple_matches"' "keyword lookup"
require_contains "$keyword" "PAINT-" "keyword lookup"

metrics="$(curl -fsS "${AUTH_HEADER[@]}" "$BASE_URL/metrics")"
require_contains "$metrics" "parts_lookup_requests_total" "metrics"
require_contains "$metrics" "parts_lookup_duration_ms" "metrics"

printf "smoke ok\n"
