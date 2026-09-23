-- First production SaaS boundary: tenant/workspace for Auth, Accounts, Projects, Stages, and Tasks.
-- Existing rows are assigned to the foundation workspace so deploy migration is additive.

CREATE TABLE "TenantWorkspace" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL,
  "workspaceKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "planCode" TEXT NOT NULL DEFAULT 'foundation',
  "regionCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TenantWorkspace_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TenantWorkspace" ("id", "tenantKey", "workspaceKey", "name", "status", "planCode")
VALUES ('twk-foundation', 'prod', 'default', 'Default Workspace', 'active', 'foundation')
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "PortalSession" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation';
ALTER TABLE "RoleBinding" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Account" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation';
ALTER TABLE "Contact" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation';
ALTER TABLE "Project" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation';
ALTER TABLE "ProjectStage" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation';
ALTER TABLE "ProjectTask" ADD COLUMN "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation';

UPDATE "RoleBinding"
SET "workspaceId" = 'twk-foundation'
WHERE "workspaceId" IS NULL AND "tenantKey" = 'prod';

UPDATE "Contact" c
SET "workspaceId" = a."workspaceId"
FROM "Account" a
WHERE c."accountId" = a."id";

UPDATE "Project" p
SET "workspaceId" = a."workspaceId"
FROM "Account" a
WHERE p."accountId" = a."id";

UPDATE "ProjectStage" ps
SET "workspaceId" = p."workspaceId"
FROM "Project" p
WHERE ps."projectId" = p."id";

UPDATE "ProjectTask" pt
SET "workspaceId" = a."workspaceId"
FROM "Account" a
WHERE pt."accountId" = a."id";

DROP INDEX IF EXISTS "Account_code_key";
DROP INDEX IF EXISTS "Contact_email_key";
DROP INDEX IF EXISTS "Project_code_key";

CREATE UNIQUE INDEX "TenantWorkspace_tenantKey_workspaceKey_key" ON "TenantWorkspace"("tenantKey", "workspaceKey");
CREATE INDEX "TenantWorkspace_status_idx" ON "TenantWorkspace"("status");
CREATE INDEX "PortalSession_workspaceId_idx" ON "PortalSession"("workspaceId");
CREATE INDEX "RoleBinding_workspaceId_idx" ON "RoleBinding"("workspaceId");
CREATE UNIQUE INDEX "Account_workspaceId_code_key" ON "Account"("workspaceId", "code");
CREATE INDEX "Account_workspaceId_stage_idx" ON "Account"("workspaceId", "stage");
CREATE UNIQUE INDEX "Contact_workspaceId_email_key" ON "Contact"("workspaceId", "email");
CREATE INDEX "Contact_workspaceId_idx" ON "Contact"("workspaceId");
CREATE UNIQUE INDEX "Project_workspaceId_code_key" ON "Project"("workspaceId", "code");
CREATE INDEX "Project_workspaceId_status_idx" ON "Project"("workspaceId", "status");
CREATE INDEX "ProjectStage_workspaceId_status_idx" ON "ProjectStage"("workspaceId", "status");
CREATE INDEX "ProjectTask_workspaceId_status_idx" ON "ProjectTask"("workspaceId", "status");

ALTER TABLE "PortalSession"
  ADD CONSTRAINT "PortalSession_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoleBinding"
  ADD CONSTRAINT "RoleBinding_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Account"
  ADD CONSTRAINT "Account_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectStage"
  ADD CONSTRAINT "ProjectStage_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectTask"
  ADD CONSTRAINT "ProjectTask_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
