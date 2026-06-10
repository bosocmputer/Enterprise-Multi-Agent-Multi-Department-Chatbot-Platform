#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${INTERNAL_API_TOKEN:-}" ]]; then
  printf "INTERNAL_API_TOKEN is required for prod smoke\n" >&2
  exit 1
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:3060}" INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN" bash scripts/pilot-smoke.sh

unauth_code="$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/ready")"
if [[ "$unauth_code" != "401" ]]; then
  printf "smoke failed: /ready without token returned %s, expected 401\n" "$unauth_code" >&2
  exit 1
fi

health="$(curl -fsS "$BASE_URL/health")"
if [[ "$health" != *'"tenantStatus"'* || "$health" != *'"version"'* ]]; then
  printf "smoke failed: health missing tenantStatus/version\n%s\n" "$health" >&2
  exit 1
fi

llm_enabled="${LLM_PARSER_ENABLED:-false}"
llm_mode="${LLM_PARSER_MODE:-off}"
llm_key="${LITELLM_API_KEY:-${OPENAI_API_KEY:-}}"
if [[ "$llm_key" != "" && ( "$llm_enabled" == "true" || "$llm_mode" != "off" ) ]]; then
  parse_status=0
  parse="$(curl -fsS \
    -X POST "$BASE_URL/internal/parse" \
    -H "Authorization: Bearer ${INTERNAL_API_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"text":"มีปูนตราช้างเหลือไหม"}')" || parse_status=$?
  if [[ "$parse_status" != "0" || "$parse" != *'"status":"parsed"'* || "$parse" != *'"intent":"stock"'* || "$parse" != *'"keyword":"ปูนตราช้าง"'* ]]; then
    if [[ "$llm_mode" == "assist" ]]; then
      printf "smoke failed: internal parse did not return stock/ปูนตราช้าง\n%s\n" "$parse" >&2
      exit 1
    fi
    printf "smoke warning: optional LLM parser did not return stock/ปูนตราช้าง in %s mode\n%s\n" "$llm_mode" "$parse" >&2
  fi
fi

printf "prod smoke ok\n"
