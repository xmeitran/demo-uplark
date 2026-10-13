-- Restore the unique arbiter required by Prisma upsert on TenantWorkspace.
-- Some environments have the table but lost the index while the migration
-- history still marks the original migration as applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TenantWorkspace"
    GROUP BY "tenantKey", "workspaceKey"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot restore TenantWorkspace unique index: duplicate tenantKey/workspaceKey rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TenantWorkspace_tenantKey_workspaceKey_key"
  ON "TenantWorkspace"("tenantKey", "workspaceKey");
