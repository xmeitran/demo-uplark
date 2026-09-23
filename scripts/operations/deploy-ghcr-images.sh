#!/usr/bin/env bash
set -Eeuo pipefail

runtime_dir="${VPS_RUNTIME_DIR:-$(pwd)}"
compose_file="${COMPOSE_FILE:-docker-compose.app.yml}"
project_name="${COMPOSE_PROJECT_NAME:-b2b-crm-saas-runtime}"
image_registry="${IMAGE_REGISTRY:-ghcr.io/khanguyen09/b2b-crm-saas}"
image_tag="${IMAGE_TAG:?IMAGE_TAG is required, for example sha-<full-git-sha>}"
ghcr_username="${GHCR_USERNAME:-}"
skip_login="${GHCR_SKIP_LOGIN:-0}"

cd "$runtime_dir"

if [ ! -f ".env" ]; then
  echo "Missing $runtime_dir/.env" >&2
  exit 1
fi

if [ ! -f "$compose_file" ]; then
  echo "Missing $runtime_dir/$compose_file" >&2
  exit 1
fi

sanitize_env_file() {
  local tmp
  tmp="$(mktemp)"
  awk '
    /^[[:space:]]*=/ { next }
    /^[[:space:]]*$/ { print; next }
    /^[[:space:]]*#/ { print; next }
    /^[^=]+=/ { print; next }
  ' .env > "$tmp"
  mv "$tmp" .env
}

if [ "$skip_login" != "1" ]; then
  if [ -z "$ghcr_username" ]; then
    echo "GHCR_USERNAME is required when GHCR_SKIP_LOGIN is not 1" >&2
    exit 1
  fi

  IFS= read -r ghcr_token
  if [ -z "$ghcr_token" ]; then
    echo "GHCR read token must be provided on stdin" >&2
    exit 1
  fi

  printf '%s\n' "$ghcr_token" | docker login ghcr.io -u "$ghcr_username" --password-stdin >/dev/null
  unset ghcr_token
fi

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v ENV_KEY="$key" -v ENV_VALUE="$value" '
    BEGIN { found = 0 }
    index($0, ENV_KEY "=") == 1 {
      if (!found) {
        print ENV_KEY "=" ENV_VALUE
        found = 1
      }
      next
    }
    { print }
    END {
      if (!found) {
        print ENV_KEY "=" ENV_VALUE
      }
    }
  ' .env > "$tmp"
  mv "$tmp" .env
}

set_env_value IMAGE_REGISTRY "$image_registry"
set_env_value IMAGE_TAG "$image_tag"
sanitize_env_file

echo "Deploying GHCR images from $image_registry with tag $image_tag"

for service in api worker web; do
  docker pull "$image_registry/$service:$image_tag"
done

IMAGE_REGISTRY="$image_registry" IMAGE_TAG="$image_tag" \
  docker compose --env-file .env -f "$compose_file" -p "$project_name" pull api worker web

IMAGE_REGISTRY="$image_registry" IMAGE_TAG="$image_tag" \
  docker compose --env-file .env -f "$compose_file" -p "$project_name" run --rm --no-deps \
    api sh -lc 'DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm db:migrate'

IMAGE_REGISTRY="$image_registry" IMAGE_TAG="$image_tag" \
  docker compose --env-file .env -f "$compose_file" -p "$project_name" up -d --remove-orphans

IMAGE_REGISTRY="$image_registry" IMAGE_TAG="$image_tag" \
  docker compose --env-file .env -f "$compose_file" -p "$project_name" ps

api_port="$(awk -F= '$1 == "API_HOST_PORT" { print $2 }' .env | tail -n 1)"
web_port="$(awk -F= '$1 == "WEB_HOST_PORT" { print $2 }' .env | tail -n 1)"
api_port="${api_port:-4400}"
web_port="${web_port:-3004}"

retry_curl() {
  local url="$1"
  local mode="${2:-get}"
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if [ "$mode" = "head" ]; then
      curl -fsS -I "$url" >/dev/null && return 0
    else
      curl -fsS "$url" >/dev/null && return 0
    fi
    sleep 3
  done

  if [ "$mode" = "head" ]; then
    curl -fsS -I "$url" >/dev/null
  else
    curl -fsS "$url" >/dev/null
  fi
}

retry_curl "http://127.0.0.1:${api_port}/api/health"
retry_curl "http://127.0.0.1:${web_port}/login?returnTo=%2Fprojects" head

echo "GHCR image deploy completed for $image_tag"
