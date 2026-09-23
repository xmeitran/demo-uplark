-- Release A (expand): install the workspace-aware selector while keeping the
-- legacy three-column unique index for old application instances. Release B
-- will guard the final data state and drop the legacy index after every writer
-- uses the four-column selector.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "RoleBinding"
    GROUP BY "userId", "roleId", "tenantKey", "workspaceId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'RoleBinding contains duplicate user/role/tenant/workspace rows';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "RoleBinding_userId_roleId_tenantKey_workspaceId_key"
ON "RoleBinding"("userId", "roleId", "tenantKey", "workspaceId");
