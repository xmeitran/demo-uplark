-- Each organization is a TenantWorkspace. Every existing project, client and member already belongs to the workspace
-- that holds the projects, so naming it is all it takes to make that data DX's. (Other workspaces, e.g. test ones, are left alone.)
UPDATE "TenantWorkspace" SET "name" = 'DX', "updatedAt" = now()
WHERE "id" = (SELECT "workspaceId" FROM "Project" GROUP BY "workspaceId" ORDER BY count(*) DESC LIMIT 1);

-- System Founder manages organizations and who belongs to them. It is held tenant-wide (no workspace) on top of a
-- normal membership, so no workspace admin screen lists or changes it.
INSERT INTO "Role" ("id", "code", "name", "type", "description", "createdAt")
VALUES ('role-system-founder', 'SYSTEM_FOUNDER', 'System Founder', 'SYSTEM', 'Quản lý tổ chức và thành viên của từng tổ chức', now())
ON CONFLICT ("code") DO NOTHING;

-- Sao Mai, Việt Kha, Tố Hải, Thùy Dương, Trần Anh Annie.
INSERT INTO "RoleBinding" ("id", "userId", "roleId", "tenantKey", "workspaceId", "startsAt", "createdAt")
SELECT 'rb-sysfounder-' || u."id" || '-' || t."tenantKey", u."id", r."id", t."tenantKey", NULL, now(), now()
FROM "User" u
CROSS JOIN "Role" r
CROSS JOIN (SELECT DISTINCT "tenantKey" FROM "TenantWorkspace") t
WHERE r."code" = 'SYSTEM_FOUNDER'
  AND lower(u."email") IN ('maitns@upbase.asia', 'khanhv@upbase.asia', 'haidt@upbase.asia', 'duongnt1@upbase.asia', 'trananh@upbase.vn')
  AND NOT EXISTS (
    SELECT 1 FROM "RoleBinding" b
    WHERE b."userId" = u."id" AND b."roleId" = r."id" AND b."tenantKey" = t."tenantKey" AND b."workspaceId" IS NULL
  );
