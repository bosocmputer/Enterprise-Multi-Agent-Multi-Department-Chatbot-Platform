#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-192.168.2.109}"
DEPLOY_USER="${DEPLOY_USER:-bosscatdog}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/bosscatdog/parts-lookup-chatbot}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
REPO_URL="${REPO_URL:-$(git config --get remote.origin.url)}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-parts-lookup-api}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3060}"
RUN_SMOKE="${RUN_SMOKE:-1}"
SSH_CMD="${SSH_CMD:-ssh}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=no}"

if [[ -z "$REPO_URL" ]]; then
  printf "REPO_URL or git remote origin is required\n" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  printf "worktree is not clean; commit and push before deploying\n" >&2
  git status --short >&2
  exit 1
fi

local_sha="$(git rev-parse HEAD)"
remote_sha="$(git ls-remote "$REPO_URL" "refs/heads/$DEPLOY_BRANCH" | awk '{print $1}')"
if [[ -z "$remote_sha" ]]; then
  printf "remote branch %s not found at %s\n" "$DEPLOY_BRANCH" "$REPO_URL" >&2
  exit 1
fi
if [[ "$local_sha" != "$remote_sha" ]]; then
  printf "local HEAD %s is not pushed to %s (%s)\n" "$local_sha" "$DEPLOY_BRANCH" "$remote_sha" >&2
  exit 1
fi

printf "deploying %s@%s to %s:%s\n" "$DEPLOY_BRANCH" "${local_sha:0:12}" "$DEPLOY_HOST" "$DEPLOY_PATH"

# shellcheck disable=SC2086
$SSH_CMD $SSH_OPTS "$DEPLOY_USER@$DEPLOY_HOST" "bash -s" -- \
  "$REPO_URL" "$DEPLOY_BRANCH" "$DEPLOY_PATH" "$COMPOSE_SERVICE" "$BASE_URL" "$RUN_SMOKE" <<'REMOTE_SCRIPT'
set -euo pipefail

repo_url="$1"
deploy_branch="$2"
deploy_path="$3"
compose_service="$4"
base_url="$5"
run_smoke="$6"

timestamp="$(date +%Y%m%d%H%M%S)"

if [[ -d "$deploy_path/.git" ]]; then
  cd "$deploy_path"
  git fetch origin "$deploy_branch"
  git checkout "$deploy_branch"
  git pull --ff-only origin "$deploy_branch"
else
  clone_path="${deploy_path}.clone-${timestamp}"
  backup_path="${deploy_path}.rsync-backup-${timestamp}"

  git clone --branch "$deploy_branch" --single-branch "$repo_url" "$clone_path"

  if [[ -f "$deploy_path/.env" ]]; then
    cp "$deploy_path/.env" "$clone_path/.env"
  fi

  if [[ -e "$deploy_path" ]]; then
    mv "$deploy_path" "$backup_path"
    printf "previous non-git deploy moved to %s\n" "$backup_path"
  fi

  mv "$clone_path" "$deploy_path"
  cd "$deploy_path"
fi

if [[ ! -f .env ]]; then
  printf ".env is missing at %s; create it before starting the service\n" "$deploy_path" >&2
  exit 1
fi

git_sha="$(git rev-parse --short=12 HEAD)"
GIT_SHA="$git_sha" docker compose up --build -d --force-recreate "$compose_service"
docker compose ps

if [[ "$run_smoke" == "1" ]]; then
  for attempt in {1..30}; do
    if curl -fsS "$base_url/health" >/dev/null 2>&1; then
      break
    fi
    if [[ "$attempt" == "30" ]]; then
      printf "health check did not pass after %s attempts\n" "$attempt" >&2
      exit 1
    fi
    sleep 1
  done

  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a

  if [[ -n "${INTERNAL_API_TOKEN:-}" ]]; then
    BASE_URL="$base_url" INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN" bash scripts/prod-smoke.sh
  else
    printf "smoke skipped: INTERNAL_API_TOKEN is not set in .env\n"
  fi
fi

printf "deployed git_sha=%s\n" "$git_sha"
REMOTE_SCRIPT
