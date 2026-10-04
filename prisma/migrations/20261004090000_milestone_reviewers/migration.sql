ALTER TABLE "ProjectMilestone"
  ADD COLUMN "reviewerMode" TEXT NOT NULL DEFAULT 'workspace_admin',
  ADD COLUMN "reviewerUserId" TEXT,
  ADD COLUMN "reviewerApprovedAt" TIMESTAMP(3),
  ADD COLUMN "reviewerApprovedByUserId" TEXT;

-- Old releases marked gates approved as soon as checklist facts passed. Those
-- approvals have no reviewer identity, so require the new explicit review once.
UPDATE "ProjectMilestone"
SET "gateStatus" = 'pending_review'
WHERE "gateStatus" = 'approved'
  AND "reviewerApprovedAt" IS NULL;

CREATE INDEX "ProjectMilestone_workspaceId_reviewerUserId_idx"
  ON "ProjectMilestone"("workspaceId", "reviewerUserId");

CREATE INDEX "ProjectMilestone_workspaceId_reviewerApprovedAt_idx"
  ON "ProjectMilestone"("workspaceId", "reviewerApprovedAt");
