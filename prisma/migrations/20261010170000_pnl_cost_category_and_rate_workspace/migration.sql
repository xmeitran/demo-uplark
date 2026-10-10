-- P&L cost input: classify non-labor cost lines by BRD expense group, and scope cost rates to a workspace.
ALTER TABLE "ProjectCost" ADD COLUMN "category" TEXT;

ALTER TABLE "CostRateProfile" ADD COLUMN "workspaceId" TEXT;

CREATE INDEX "CostRateProfile_workspaceId_userId_effectiveFrom_idx" ON "CostRateProfile"("workspaceId", "userId", "effectiveFrom");
