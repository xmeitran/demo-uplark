-- Rules V-02 (project Lark groups), 7.5 / V-36 (Lark delivery log) and D-09 (personal leave from Lark Approval).

ALTER TABLE "Project"
  ADD COLUMN "larkInternalChatId" TEXT,
  ADD COLUMN "larkCustomerChatId" TEXT,
  ADD COLUMN "larkGroupStatus" TEXT NOT NULL DEFAULT 'not_created',
  ADD COLUMN "larkGroupError" TEXT,
  ADD COLUMN "larkGroupSyncedAt" TIMESTAMP(3);

CREATE TABLE "LarkDeliveryLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "bot" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LarkDeliveryLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LarkDeliveryLog_status_check" CHECK ("status" IN ('sent', 'disabled', 'failed'))
);

CREATE INDEX "LarkDeliveryLog_dedupeKey_idx" ON "LarkDeliveryLog"("dedupeKey");
CREATE INDEX "LarkDeliveryLog_workspaceId_createdAt_idx" ON "LarkDeliveryLog"("workspaceId", "createdAt" DESC);
CREATE INDEX "LarkDeliveryLog_projectId_createdAt_idx" ON "LarkDeliveryLog"("projectId", "createdAt" DESC);

CREATE TABLE "PersonalLeave" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "startHalfDay" BOOLEAN NOT NULL DEFAULT false,
    "endHalfDay" BOOLEAN NOT NULL DEFAULT false,
    "leaveType" TEXT,
    "source" TEXT NOT NULL DEFAULT 'lark_approval',
    "sourceInstanceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalLeave_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PersonalLeave_status_check" CHECK ("status" IN ('approved', 'cancelled')),
    CONSTRAINT "PersonalLeave_range_check" CHECK ("endDate" >= "startDate")
);

CREATE UNIQUE INDEX "PersonalLeave_workspaceId_sourceInstanceId_key" ON "PersonalLeave"("workspaceId", "sourceInstanceId");
CREATE INDEX "PersonalLeave_workspaceId_userId_startDate_endDate_idx" ON "PersonalLeave"("workspaceId", "userId", "startDate", "endDate");
