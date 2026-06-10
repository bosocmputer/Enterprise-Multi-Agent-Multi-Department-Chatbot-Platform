#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
SERVICE="${SERVICE:-parts-lookup-api}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [[ -z "${ALERT_TELEGRAM_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}" ]]; then
  echo "Set ALERT_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN in $ENV_FILE first." >&2
  exit 1
fi

bot_info="$(
  docker compose run --rm --no-deps "$SERVICE" node --input-type=module <<'NODE'
const token = process.env.ALERT_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const api = (method) => `https://api.telegram.org/bot${token}/${method}`;
const call = async (method) => {
  const response = await fetch(api(method), { method: "POST" });
  const json = await response.json();
  if (!json.ok) throw new Error(`${method} failed: ${json.description ?? response.status}`);
  return json.result;
};
const me = await call("getMe");
const updates = await call("getUpdates");
const update = updates
  .slice()
  .reverse()
  .find((item) => item.message?.chat?.id);
console.log(
  JSON.stringify({
    username: me.username,
    firstName: me.first_name,
    chatId: update?.message?.chat?.id ? String(update.message.chat.id) : ""
  })
);
NODE
)"

bot_username="$(printf "%s" "$bot_info" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
chat_id="$(printf "%s" "$bot_info" | sed -n 's/.*"chatId":"\([^"]*\)".*/\1/p')"

if [[ -z "$chat_id" ]]; then
  echo "No Telegram chat found yet. Send /start to @$bot_username, then run this script again." >&2
  exit 2
fi

upsert_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  {
    grep -v "^${key}=" "$ENV_FILE" || true
    printf "%s=%s\n" "$key" "$value"
  } > "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

upsert_env "OPS_TELEGRAM_CHAT_ID" "$chat_id"
upsert_env "ALERTS_ENABLED" "true"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

docker compose up -d --force-recreate "$SERVICE" >/dev/null

container_alerts_enabled="$(
  docker compose exec -T "$SERVICE" sh -lc 'printf "%s" "${ALERTS_ENABLED:-}"'
)"
if [[ "$container_alerts_enabled" != "true" ]]; then
  echo "Container did not start with ALERTS_ENABLED=true." >&2
  exit 1
fi

docker compose run --rm --no-deps "$SERVICE" node --input-type=module <<'NODE'
const token = process.env.ALERT_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.OPS_TELEGRAM_CHAT_ID;
const text = "[parts-lookup] Telegram dev alerts enabled.";
const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: chatId, text })
});
const json = await response.json();
if (!json.ok) throw new Error(json.description ?? `sendMessage failed: ${response.status}`);
console.log("alert_test=sent");
NODE
