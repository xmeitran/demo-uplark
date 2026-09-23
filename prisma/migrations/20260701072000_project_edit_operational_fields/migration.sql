ALTER TABLE "Project"
  ADD COLUMN "projectType" TEXT NOT NULL DEFAULT 'delivery',
  ADD COLUMN "scopeSummary" TEXT;

UPDATE "Project" AS p
SET "scopeSummary" = first_stage."scopeSummary"
FROM (
  SELECT DISTINCT ON ("projectId")
    "projectId",
    "scopeSummary"
  FROM "ProjectStage"
  WHERE "scopeSummary" IS NOT NULL
  ORDER BY "projectId", "sortOrder" ASC, "createdAt" ASC
) AS first_stage
WHERE p."id" = first_stage."projectId"
  AND p."scopeSummary" IS NULL;

CREATE INDEX "Project_workspaceId_projectType_idx" ON "Project"("workspaceId", "projectType");
