ALTER TABLE "Project"
ADD COLUMN "priority" TEXT,
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "color" TEXT;

CREATE INDEX "Project_workspaceId_priority_idx" ON "Project"("workspaceId", "priority");
