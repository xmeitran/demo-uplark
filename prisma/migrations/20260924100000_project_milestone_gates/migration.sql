ALTER TABLE "Project"
  ADD COLUMN "milestoneMode" TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN "milestoneTemplateKey" TEXT;

ALTER TABLE "ProjectMilestone"
  ADD COLUMN "requiredDocumentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "requiredDocumentTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "unlockCriteria" JSONB,
  ADD COLUMN "gateStatus" TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN "customerConfirmationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewerRole" TEXT;

CREATE INDEX "Project_milestoneMode_idx" ON "Project"("milestoneMode");
CREATE INDEX "ProjectMilestone_gateStatus_idx" ON "ProjectMilestone"("projectId", "gateStatus");
