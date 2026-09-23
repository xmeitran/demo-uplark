CREATE TABLE "TaskPlanningBlock" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation',
    "taskId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "plannedMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskPlanningBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskPlanningBlock_workspaceId_startAt_idx" ON "TaskPlanningBlock"("workspaceId", "startAt");
CREATE INDEX "TaskPlanningBlock_workspaceId_endAt_idx" ON "TaskPlanningBlock"("workspaceId", "endAt");
CREATE INDEX "TaskPlanningBlock_taskId_startAt_idx" ON "TaskPlanningBlock"("taskId", "startAt");
CREATE INDEX "TaskPlanningBlock_accountId_startAt_idx" ON "TaskPlanningBlock"("accountId", "startAt");
CREATE INDEX "TaskPlanningBlock_projectId_startAt_idx" ON "TaskPlanningBlock"("projectId", "startAt");
CREATE INDEX "TaskPlanningBlock_userId_startAt_idx" ON "TaskPlanningBlock"("userId", "startAt");
CREATE INDEX "TaskPlanningBlock_status_idx" ON "TaskPlanningBlock"("status");

ALTER TABLE "TaskPlanningBlock" ADD CONSTRAINT "TaskPlanningBlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskPlanningBlock" ADD CONSTRAINT "TaskPlanningBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskPlanningBlock" ADD CONSTRAINT "TaskPlanningBlock_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskPlanningBlock" ADD CONSTRAINT "TaskPlanningBlock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskPlanningBlock" ADD CONSTRAINT "TaskPlanningBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
