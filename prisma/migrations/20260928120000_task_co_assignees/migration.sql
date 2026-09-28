CREATE TABLE "ProjectTaskAssignee" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation',
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectTaskAssignee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectTaskAssignee_workspaceId_taskId_userId_key"
  ON "ProjectTaskAssignee"("workspaceId", "taskId", "userId");
CREATE INDEX "ProjectTaskAssignee_workspaceId_userId_idx"
  ON "ProjectTaskAssignee"("workspaceId", "userId");
CREATE INDEX "ProjectTaskAssignee_taskId_isPrimary_idx"
  ON "ProjectTaskAssignee"("taskId", "isPrimary");

ALTER TABLE "ProjectTaskAssignee"
  ADD CONSTRAINT "ProjectTaskAssignee_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectTaskAssignee"
  ADD CONSTRAINT "ProjectTaskAssignee_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTaskAssignee"
  ADD CONSTRAINT "ProjectTaskAssignee_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
