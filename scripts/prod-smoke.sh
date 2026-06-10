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

printf "prod smoke ok\n"
