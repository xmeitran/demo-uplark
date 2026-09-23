CREATE TABLE "WorkspaceReminderPolicy" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  "slots" JSONB NOT NULL,
  "weekdaysOnly" BOOLEAN NOT NULL DEFAULT true,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceReminderPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceReminderPolicy_workspaceId_key" ON "WorkspaceReminderPolicy"("workspaceId");
CREATE INDEX "WorkspaceReminderPolicy_workspaceId_enabled_idx" ON "WorkspaceReminderPolicy"("workspaceId", "enabled");
CREATE INDEX "WorkspaceReminderPolicy_updatedByUserId_idx" ON "WorkspaceReminderPolicy"("updatedByUserId");

ALTER TABLE "WorkspaceReminderPolicy" ADD CONSTRAINT "WorkspaceReminderPolicy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceReminderPolicy" ADD CONSTRAINT "WorkspaceReminderPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
