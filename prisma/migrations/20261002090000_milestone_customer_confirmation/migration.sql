ALTER TABLE "ProjectMilestone"
  ADD COLUMN "customerConfirmationAt" TIMESTAMP(3),
  ADD COLUMN "customerConfirmationByUserId" TEXT;

CREATE INDEX "ProjectMilestone_customerConfirmationAt_idx"
  ON "ProjectMilestone"("workspaceId", "customerConfirmationAt");
