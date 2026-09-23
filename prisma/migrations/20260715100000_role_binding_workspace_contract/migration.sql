-- Release B (contract): all deployed writers use the workspace-aware selector.
-- Fail closed unless the expand index and data invariants are present, then
-- remove the legacy constraint that blocks the same role across workspaces.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "RoleBinding"
    WHERE "workspaceId" IS NULL
  ) THEN
    RAISE EXCEPTION 'RoleBinding contract requires workspaceId on every row';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "RoleBinding"
    GROUP BY "userId", "roleId", "tenantKey", "workspaceId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'RoleBinding contains duplicate user/role/tenant/workspace rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'RoleBinding'
      AND indexname = 'RoleBinding_userId_roleId_tenantKey_workspaceId_key'
      AND indexdef LIKE 'CREATE UNIQUE INDEX %'
      AND indexdef LIKE '%("userId", "roleId", "tenantKey", "workspaceId")'
  ) THEN
    RAISE EXCEPTION 'RoleBinding workspace-aware unique index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'RoleBinding'
      AND indexname = 'RoleBinding_userId_roleId_tenantKey_key'
  ) THEN
    RAISE EXCEPTION 'RoleBinding legacy unique index is missing';
  END IF;
END $$;

DROP INDEX "RoleBinding_userId_roleId_tenantKey_key";
