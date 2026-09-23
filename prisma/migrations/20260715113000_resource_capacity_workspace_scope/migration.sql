-- Expand ResourceCapacityPeriod with an optional workspace boundary. Legacy
-- rows are backfilled only when the user's active role bindings identify one
-- and only one workspace; ambiguous rows intentionally remain NULL and are
-- excluded from workspace analytics until curated.

ALTER TABLE "ResourceCapacityPeriod"
  ADD COLUMN "workspaceId" TEXT;

WITH deterministic_workspace AS (
  SELECT
    rb."userId",
    MIN(rb."workspaceId") AS "workspaceId"
  FROM "RoleBinding" rb
  WHERE rb."endsAt" IS NULL
    AND rb."workspaceId" IS NOT NULL
  GROUP BY rb."userId"
  HAVING COUNT(DISTINCT rb."workspaceId") = 1
)
UPDATE "ResourceCapacityPeriod" rcp
SET "workspaceId" = scoped."workspaceId"
FROM deterministic_workspace scoped
WHERE scoped."userId" = rcp."userId"
  AND rcp."workspaceId" IS NULL;

CREATE UNIQUE INDEX "ResourceCapacityPeriod_ws_user_period_key"
  ON "ResourceCapacityPeriod"("workspaceId", "userId", "periodStart", "periodEnd");

CREATE INDEX "ResourceCapacityPeriod_ws_user_period_idx"
  ON "ResourceCapacityPeriod"("workspaceId", "userId", "periodStart", "periodEnd");

ALTER TABLE "ResourceCapacityPeriod"
  ADD CONSTRAINT "ResourceCapacityPeriod_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "ResourceCapacityPeriod_userId_periodStart_periodEnd_key";
