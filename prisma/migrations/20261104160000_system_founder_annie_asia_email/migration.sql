-- Trần Anh Annie signs in as trananh@upbase.asia on production (trananh@upbase.vn elsewhere); grant System Founder to
-- that address too, the same way 20261104120000 did for the others.
INSERT INTO "RoleBinding" ("id", "userId", "roleId", "tenantKey", "workspaceId", "startsAt", "createdAt")
SELECT 'rb-sysfounder-' || u."id" || '-' || t."tenantKey", u."id", r."id", t."tenantKey", NULL, now(), now()
FROM "User" u
CROSS JOIN "Role" r
CROSS JOIN (SELECT DISTINCT "tenantKey" FROM "TenantWorkspace") t
WHERE r."code" = 'SYSTEM_FOUNDER'
  AND lower(u."email") = 'trananh@upbase.asia'
  AND NOT EXISTS (
    SELECT 1 FROM "RoleBinding" b
    WHERE b."userId" = u."id" AND b."roleId" = r."id" AND b."tenantKey" = t."tenantKey" AND b."workspaceId" IS NULL
  );
