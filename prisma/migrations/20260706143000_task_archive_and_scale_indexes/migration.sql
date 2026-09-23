-- Add archive metadata for task lifecycle without deleting operational history.
ALTER TABLE "ProjectTask" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "ProjectTask" ADD COLUMN "archivedByUserId" TEXT;
ALTER TABLE "ProjectTask" ADD COLUMN "archiveReason" TEXT;

-- Foreign key stays nullable so archived tasks remain readable if a user is later removed.
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_archivedByUserId_fkey"
  FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Active/default list and project-detail workload indexes.
CREATE INDEX "ProjectTask_workspaceId_archivedAt_updatedAt_idx" ON "ProjectTask"("workspaceId", "archivedAt", "updatedAt" DESC);
CREATE INDEX "ProjectTask_projectId_archivedAt_status_idx" ON "ProjectTask"("projectId", "archivedAt", "status");
CREATE INDEX "ProjectTask_assigneeUserId_archivedAt_status_idx" ON "ProjectTask"("assigneeUserId", "archivedAt", "status");
CREATE INDEX "ProjectTask_archivedByUserId_idx" ON "ProjectTask"("archivedByUserId");

-- Calendar/workload read paths frequently filter by workspace + project/user + date range.
CREATE INDEX "TaskPlanningBlock_workspaceId_projectId_startAt_idx" ON "TaskPlanningBlock"("workspaceId", "projectId", "startAt");
CREATE INDEX "TaskPlanningBlock_workspaceId_userId_startAt_idx" ON "TaskPlanningBlock"("workspaceId", "userId", "startAt");
CREATE INDEX "TaskTimeEntry_workspaceId_projectId_workDate_idx" ON "TaskTimeEntry"("workspaceId", "projectId", "workDate");
CREATE INDEX "TaskTimeEntry_workspaceId_userId_workDate_idx" ON "TaskTimeEntry"("workspaceId", "userId", "workDate");
CREATE INDEX "TaskStatusHistory_workspaceId_taskId_changedAt_idx" ON "TaskStatusHistory"("workspaceId", "taskId", "changedAt");
