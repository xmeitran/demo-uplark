ALTER TABLE "ProjectArtifact" ADD COLUMN "milestoneId" TEXT;

CREATE INDEX "ProjectArtifact_projectId_milestoneId_idx"
  ON "ProjectArtifact"("projectId", "milestoneId");

ALTER TABLE "ProjectArtifact"
  ADD CONSTRAINT "ProjectArtifact_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "ProjectMilestone"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
