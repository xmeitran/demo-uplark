ALTER TABLE "ProjectMilestone"
  ADD COLUMN "evidenceMode" TEXT NOT NULL DEFAULT 'file_or_link',
  ADD COLUMN "ownerTeamId" TEXT;

CREATE INDEX "ProjectMilestone_workspaceId_ownerTeamId_idx"
  ON "ProjectMilestone"("workspaceId", "ownerTeamId");

ALTER TABLE "ProjectMilestone"
  ADD CONSTRAINT "ProjectMilestone_ownerTeamId_fkey"
  FOREIGN KEY ("ownerTeamId") REFERENCES "WorkspaceTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;
