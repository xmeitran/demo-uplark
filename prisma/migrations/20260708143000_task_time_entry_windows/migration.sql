ALTER TABLE "TaskTimeEntry"
  ADD COLUMN "startAt" TIMESTAMP(3),
  ADD COLUMN "endAt" TIMESTAMP(3),
  ADD COLUMN "timeZone" TEXT DEFAULT 'Asia/Ho_Chi_Minh';

CREATE INDEX "TaskTimeEntry_workspaceId_startAt_idx" ON "TaskTimeEntry"("workspaceId", "startAt");
CREATE INDEX "TaskTimeEntry_taskId_startAt_idx" ON "TaskTimeEntry"("taskId", "startAt");
CREATE INDEX "TaskTimeEntry_projectId_startAt_idx" ON "TaskTimeEntry"("projectId", "startAt");
CREATE INDEX "TaskTimeEntry_userId_startAt_idx" ON "TaskTimeEntry"("userId", "startAt");
