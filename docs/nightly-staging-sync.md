# Nightly production → staging refresh

The Render deployment is split into two data planes:

- production PostgreSQL is the read-only source;
- a separate staging PostgreSQL database is the only database used by the
  sandbox frontend/API.

`render.yaml` defines a Render Cron Job that runs every night at **02:00
Vietnam time** (`19:00 UTC`). It runs `pg_dump` from the production URL and
restores it into staging with `--clean --if-exists`. The refresh excludes
sessions, auth tokens, rate-limit rows, file download grants, and invitations.
Those rows are truncated after restore as an additional guard.

The job is fail-closed:

1. `ALLOW_NIGHTLY_STAGING_REFRESH` must be explicitly set to `true`.
2. Both database URLs are required.
3. Identical URLs are rejected.
4. The PostgreSQL server/database fingerprints are compared; an identical
   source and target is rejected before `pg_dump` starts.

Every staging edit is sandbox-only and will be replaced by the next nightly
refresh. This is intentional: the sandbox stays close to production while
never writing back to production.

## Render setup

Create/sync the Blueprint from `render.yaml`, then set these Cron Job secrets
in Render (do not commit them):

```text
PRODUCTION_DATABASE_URL=<read-only production connection string>
STAGING_DATABASE_URL=<separate staging connection string>
ALLOW_NIGHTLY_STAGING_REFRESH=true
```

The staging API must use the staging URL and the staging frontend must point to
that API. Keep the production URL out of the frontend environment.
