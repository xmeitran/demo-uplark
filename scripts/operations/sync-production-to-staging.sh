#!/usr/bin/env sh

# Nightly, one-way refresh used by the Render staging environment.
# The source connection must be a read-only production role. The target must
# be a separate staging database; this script intentionally refuses to run
# when it cannot prove that the two connections are different.

set -eu
set -o pipefail

if [ "${ALLOW_NIGHTLY_STAGING_REFRESH:-false}" != "true" ]; then
  echo "Nightly staging refresh is disabled. Set ALLOW_NIGHTLY_STAGING_REFRESH=true to enable it."
  exit 0
fi

: "${PRODUCTION_DATABASE_URL:?PRODUCTION_DATABASE_URL is required}"
: "${STAGING_DATABASE_URL:?STAGING_DATABASE_URL is required}"

if [ "$PRODUCTION_DATABASE_URL" = "$STAGING_DATABASE_URL" ]; then
  echo "Refusing to refresh: PRODUCTION_DATABASE_URL and STAGING_DATABASE_URL are identical." >&2
  exit 1
fi

fingerprint() {
  # Render-hosted PostgreSQL exposes a TCP address. Include the database name
  # so two databases on the same cluster remain distinguishable.
  psql "$1" --tuples-only --no-align --command \
    "select coalesce(inet_server_addr()::text, 'local') || '/' || current_database();" \
    | tr -d '[:space:]'
}

production_fingerprint="$(fingerprint "$PRODUCTION_DATABASE_URL")"
staging_fingerprint="$(fingerprint "$STAGING_DATABASE_URL")"

if [ -z "$production_fingerprint" ] || [ -z "$staging_fingerprint" ]; then
  echo "Refusing to refresh: could not verify database fingerprints." >&2
  exit 1
fi

if [ "$production_fingerprint" = "$staging_fingerprint" ]; then
  echo "Refusing to refresh: source and target resolve to the same PostgreSQL database ($production_fingerprint)." >&2
  exit 1
fi

echo "Refreshing staging from production: $production_fingerprint -> $staging_fingerprint"

# This is a full logical refresh. Staging-only edits are intentionally reset
# every night. Ephemeral credentials and sessions are excluded and therefore
# cannot be reused in the sandbox.
pg_dump "$PRODUCTION_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --no-comments \
  --exclude-table-data='public."PortalSession"' \
  --exclude-table-data='public."AuthActionToken"' \
  --exclude-table-data='public."AuthRateLimit"' \
  --exclude-table-data='public."FileDownloadGrant"' \
  --exclude-table-data='public."PortalInvitation"' \
  | psql "$STAGING_DATABASE_URL" --set=ON_ERROR_STOP=1

# Be explicit about clearing potentially pre-existing ephemeral rows in case a
# custom pg_dump version keeps data for an excluded table during --clean.
psql "$STAGING_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
TRUNCATE TABLE "PortalSession", "AuthActionToken", "AuthRateLimit", "FileDownloadGrant", "PortalInvitation";
SQL

echo "Nightly staging refresh completed successfully."
