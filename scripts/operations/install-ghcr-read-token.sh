#!/usr/bin/env bash
set -Eeuo pipefail

vps_host="${VPS_HOST:?VPS_HOST is required}"
vps_user="${VPS_USER:-kha_nguyen}"
vps_port="${VPS_PORT:-22}"
ghcr_username="${GHCR_USERNAME:?GHCR_USERNAME is required}"
image_registry="${IMAGE_REGISTRY:-ghcr.io/khanguyen09/b2b-crm-saas}"
image_tag="${IMAGE_TAG:?IMAGE_TAG is required, for example sha-<full-git-sha>}"

IFS= read -r ghcr_token
if [ -z "$ghcr_token" ]; then
  echo "GHCR read token must be provided on stdin" >&2
  exit 1
fi

remote_script='
set -Eeuo pipefail
ghcr_username="$1"
image_registry="$2"
image_tag="$3"

IFS= read -r token
if [ -z "$token" ]; then
  echo "missing token on stdin" >&2
  exit 1
fi

docker logout ghcr.io >/dev/null 2>&1 || true
printf "%s\n" "$token" | docker login ghcr.io -u "$ghcr_username" --password-stdin >/dev/null
unset token

for service in api worker web; do
  docker pull "$image_registry/$service:$image_tag" >/dev/null
done

python3 - <<PY
import base64, json, os
path = os.path.expanduser("~/.docker/config.json")
with open(path) as fh:
    data = json.load(fh)
entry = (data.get("auths") or {}).get("ghcr.io") or {}
raw = base64.b64decode(entry.get("auth", "")).decode("utf-8", "replace")
user = raw.split(":", 1)[0] if ":" in raw else ""
token_present = bool(entry.get("auth"))
print(f"ghcr.io username={user} token_present={token_present}")
PY
'

remote_script_b64="$(printf '%s' "$remote_script" | base64 | tr -d '\n')"

printf '%s\n' "$ghcr_token" | ssh -p "$vps_port" -o BatchMode=yes "$vps_user@$vps_host" \
  "tmp=\$(mktemp); printf '%s' '$remote_script_b64' | base64 -d > \"\$tmp\"; bash \"\$tmp\" '$ghcr_username' '$image_registry' '$image_tag'; status=\$?; rm -f \"\$tmp\"; exit \$status"

unset ghcr_token
