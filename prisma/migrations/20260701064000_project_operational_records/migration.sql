CREATE TABLE "ProjectActivity" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation',
  "projectId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "activityType" TEXT NOT NULL DEFAULT 'note',
  "subject" TEXT NOT NULL,
  "note" TEXT,
  "target" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectRisk" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation',
  "projectId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'Operational',
  "description" TEXT NOT NULL,
  "likelihood" TEXT NOT NULL DEFAULT 'Medium',
  "impact" TEXT NOT NULL DEFAULT 'Medium',
  "response" TEXT NOT NULL DEFAULT '',
  "switchTrigger" TEXT,
  "ownerUserId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectRisk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectActivity_workspaceId_occurredAt_idx" ON "ProjectActivity"("workspaceId", "occurredAt");
CREATE INDEX "ProjectActivity_projectId_occurredAt_idx" ON "ProjectActivity"("projectId", "occurredAt");
CREATE INDEX "ProjectActivity_accountId_occurredAt_idx" ON "ProjectActivity"("accountId", "occurredAt");
CREATE INDEX "ProjectActivity_activityType_idx" ON "ProjectActivity"("activityType");
CREATE INDEX "ProjectActivity_status_idx" ON "ProjectActivity"("status");
CREATE INDEX "ProjectActivity_createdByUserId_idx" ON "ProjectActivity"("createdByUserId");

CREATE INDEX "ProjectRisk_workspaceId_status_idx" ON "ProjectRisk"("workspaceId", "status");
CREATE INDEX "ProjectRisk_projectId_status_idx" ON "ProjectRisk"("projectId", "status");
CREATE INDEX "ProjectRisk_accountId_status_idx" ON "ProjectRisk"("accountId", "status");
CREATE INDEX "ProjectRisk_ownerUserId_status_idx" ON "ProjectRisk"("ownerUserId", "status");
CREATE INDEX "ProjectRisk_category_idx" ON "ProjectRisk"("category");
CREATE INDEX "ProjectRisk_createdByUserId_idx" ON "ProjectRisk"("createdByUserId");

ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
