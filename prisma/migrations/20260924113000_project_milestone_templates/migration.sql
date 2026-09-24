CREATE TABLE "ProjectMilestoneTemplate" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation',
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "milestones" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMilestoneTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectMilestoneTemplate_workspaceId_key_key" ON "ProjectMilestoneTemplate"("workspaceId", "key");
CREATE INDEX "ProjectMilestoneTemplate_workspaceId_status_idx" ON "ProjectMilestoneTemplate"("workspaceId", "status");
CREATE INDEX "ProjectMilestoneTemplate_workspaceId_updatedAt_idx" ON "ProjectMilestoneTemplate"("workspaceId", "updatedAt" DESC);

ALTER TABLE "ProjectMilestoneTemplate"
  ADD CONSTRAINT "ProjectMilestoneTemplate_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
