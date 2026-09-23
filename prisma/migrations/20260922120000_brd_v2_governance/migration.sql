-- BRD v2 additive migration. It preserves existing worklogs and introduces
-- explicit approval, OT, monthly cost, P&L reconciliation and reminder state.

ALTER TABLE "ProjectTask"
  ADD COLUMN "taskTypeLayer1" TEXT,
  ADD COLUMN "taskTypeLayer2" TEXT,
  ADD COLUMN "taskTypeVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "planApprovalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "planSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "planApprovedAt" TIMESTAMP(3),
  ADD COLUMN "planApprovedByUserId" TEXT,
  ADD COLUMN "baselineStartAt" TIMESTAMP(3),
  ADD COLUMN "baselineEndAt" TIMESTAMP(3),
  ADD COLUMN "baselineEstimateMinutes" INTEGER;

ALTER TABLE "TaskTimeEntry"
  ADD COLUMN "regularMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taskTypeLayer1" TEXT,
  ADD COLUMN "taskTypeLayer2" TEXT,
  ADD COLUMN "overtimeApprovalStatus" TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN "overtimePlanId" TEXT,
  ADD COLUMN "pnlStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "pnlReason" TEXT,
  ADD COLUMN "classificationVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "TaskPlanningBlock"
  ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedByUserId" TEXT;

CREATE TABLE "TaskTypeCatalog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "layer1" TEXT NOT NULL,
  "layer2" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'system',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskTypeCatalog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskTimelineChangeRequest" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "taskId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "proposedStartAt" TIMESTAMP(3),
  "proposedEndAt" TIMESTAMP(3),
  "proposedEstimateMinutes" INTEGER,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaskTimelineChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskPlanHistory" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "taskId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "before" JSONB,
  "after" JSONB NOT NULL,
  "changedByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskPlanHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OvertimePlan" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "userId" TEXT NOT NULL,
  "workDate" DATE NOT NULL,
  "plannedMinutes" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OvertimePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResourceMonthlyCost" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "periodKey" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "p1BaseAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "p2AllowanceAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "p3PerformanceAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "p4OtherVariableAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "overtimeAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "socialInsuranceAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "pitAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "otherAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "totalMonthlyIncome" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "hourlyCostRate" DECIMAL(20,2),
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResourceMonthlyCost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PnlPeriod" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "periodKey" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "revenueAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "confirmedByUserId" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "lockedByUserId" TEXT,
  "lockedAt" TIMESTAMP(3),
  "reopenedByUserId" TEXT,
  "reopenedAt" TIMESTAMP(3),
  "reopenReason" TEXT,
  "formulaVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PnlPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PnlTimeEntryAllocation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "timeEntryId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "standardMinutes" INTEGER NOT NULL DEFAULT 0,
  "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
  "hourlyCostRate" DECIMAL(20,2),
  "laborCostAmount" DECIMAL(20,2),
  "classifiedAt" TIMESTAMP(3),
  "classifiedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PnlTimeEntryAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReminderDeliveryLog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "localDate" DATE NOT NULL,
  "moment" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pmUserId" TEXT,
  "missingType" TEXT NOT NULL,
  "conditionKey" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'lark',
  "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "deepLink" TEXT,
  "payload" JSONB,
  "errorMessage" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReminderDeliveryLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskTypeCatalog_workspaceId_layer1_layer2_key" ON "TaskTypeCatalog"("workspaceId", "layer1", "layer2");
CREATE UNIQUE INDEX "TaskTypeCatalog_workspaceId_code_key" ON "TaskTypeCatalog"("workspaceId", "code");
CREATE INDEX "TaskTypeCatalog_workspaceId_active_idx" ON "TaskTypeCatalog"("workspaceId", "active");
CREATE INDEX "TaskTimelineChangeRequest_workspaceId_status_createdAt_idx" ON "TaskTimelineChangeRequest"("workspaceId", "status", "createdAt");
CREATE INDEX "TaskTimelineChangeRequest_projectId_status_idx" ON "TaskTimelineChangeRequest"("projectId", "status");
CREATE INDEX "TaskTimelineChangeRequest_taskId_createdAt_idx" ON "TaskTimelineChangeRequest"("taskId", "createdAt");
CREATE UNIQUE INDEX "TaskPlanHistory_taskId_version_key" ON "TaskPlanHistory"("taskId", "version");
CREATE INDEX "TaskPlanHistory_workspaceId_changedAt_idx" ON "TaskPlanHistory"("workspaceId", "changedAt");
CREATE INDEX "TaskPlanHistory_projectId_changedAt_idx" ON "TaskPlanHistory"("projectId", "changedAt");
CREATE INDEX "OvertimePlan_workspaceId_workDate_approvalStatus_idx" ON "OvertimePlan"("workspaceId", "workDate", "approvalStatus");
CREATE INDEX "OvertimePlan_projectId_workDate_idx" ON "OvertimePlan"("projectId", "workDate");
CREATE INDEX "OvertimePlan_requestedByUserId_workDate_idx" ON "OvertimePlan"("requestedByUserId", "workDate");
CREATE UNIQUE INDEX "ResourceMonthlyCost_workspaceId_userId_periodKey_key" ON "ResourceMonthlyCost"("workspaceId", "userId", "periodKey");
CREATE INDEX "ResourceMonthlyCost_workspaceId_periodStart_periodEnd_idx" ON "ResourceMonthlyCost"("workspaceId", "periodStart", "periodEnd");
CREATE INDEX "ResourceMonthlyCost_userId_periodStart_periodEnd_idx" ON "ResourceMonthlyCost"("userId", "periodStart", "periodEnd");
CREATE INDEX "ResourceMonthlyCost_status_idx" ON "ResourceMonthlyCost"("status");
CREATE UNIQUE INDEX "PnlPeriod_workspaceId_projectId_periodKey_key" ON "PnlPeriod"("workspaceId", "projectId", "periodKey");
CREATE INDEX "PnlPeriod_workspaceId_periodStart_periodEnd_status_idx" ON "PnlPeriod"("workspaceId", "periodStart", "periodEnd", "status");
CREATE INDEX "PnlPeriod_projectId_periodStart_periodEnd_idx" ON "PnlPeriod"("projectId", "periodStart", "periodEnd");
CREATE UNIQUE INDEX "PnlTimeEntryAllocation_timeEntryId_key" ON "PnlTimeEntryAllocation"("timeEntryId");
CREATE INDEX "PnlTimeEntryAllocation_workspaceId_status_idx" ON "PnlTimeEntryAllocation"("workspaceId", "status");
CREATE INDEX "PnlTimeEntryAllocation_periodId_status_idx" ON "PnlTimeEntryAllocation"("periodId", "status");
CREATE UNIQUE INDEX "ReminderDeliveryLog_workspaceId_localDate_moment_userId_missingType_key" ON "ReminderDeliveryLog"("workspaceId", "localDate", "moment", "userId", "missingType");
CREATE INDEX "ReminderDeliveryLog_workspaceId_localDate_moment_deliveryStatus_idx" ON "ReminderDeliveryLog"("workspaceId", "localDate", "moment", "deliveryStatus");
CREATE INDEX "ReminderDeliveryLog_userId_localDate_idx" ON "ReminderDeliveryLog"("userId", "localDate");
CREATE INDEX "ProjectTask_workspaceId_planApprovalStatus_idx" ON "ProjectTask"("workspaceId", "planApprovalStatus");
CREATE INDEX "ProjectTask_projectId_taskTypeLayer1_taskTypeLayer2_idx" ON "ProjectTask"("projectId", "taskTypeLayer1", "taskTypeLayer2");
CREATE INDEX "TaskTimeEntry_pnlStatus_workDate_idx" ON "TaskTimeEntry"("pnlStatus", "workDate");
CREATE INDEX "TaskTimeEntry_overtimeApprovalStatus_workDate_idx" ON "TaskTimeEntry"("overtimeApprovalStatus", "workDate");
CREATE INDEX "TaskTimeEntry_overtimePlanId_idx" ON "TaskTimeEntry"("overtimePlanId");
CREATE INDEX "TaskPlanningBlock_approvalStatus_startAt_idx" ON "TaskPlanningBlock"("approvalStatus", "startAt");

ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_planApprovedByUserId_fkey" FOREIGN KEY ("planApprovedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskPlanningBlock" ADD CONSTRAINT "TaskPlanningBlock_lockedByUserId_fkey" FOREIGN KEY ("lockedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_overtimePlanId_fkey" FOREIGN KEY ("overtimePlanId") REFERENCES "OvertimePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskTypeCatalog" ADD CONSTRAINT "TaskTypeCatalog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskTimelineChangeRequest" ADD CONSTRAINT "TaskTimelineChangeRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskTimelineChangeRequest" ADD CONSTRAINT "TaskTimelineChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskTimelineChangeRequest" ADD CONSTRAINT "TaskTimelineChangeRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskTimelineChangeRequest" ADD CONSTRAINT "TaskTimelineChangeRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskTimelineChangeRequest" ADD CONSTRAINT "TaskTimelineChangeRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskPlanHistory" ADD CONSTRAINT "TaskPlanHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPlanHistory" ADD CONSTRAINT "TaskPlanHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskPlanHistory" ADD CONSTRAINT "TaskPlanHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPlanHistory" ADD CONSTRAINT "TaskPlanHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskPlanHistory" ADD CONSTRAINT "TaskPlanHistory_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OvertimePlan" ADD CONSTRAINT "OvertimePlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OvertimePlan" ADD CONSTRAINT "OvertimePlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OvertimePlan" ADD CONSTRAINT "OvertimePlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OvertimePlan" ADD CONSTRAINT "OvertimePlan_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OvertimePlan" ADD CONSTRAINT "OvertimePlan_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResourceMonthlyCost" ADD CONSTRAINT "ResourceMonthlyCost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResourceMonthlyCost" ADD CONSTRAINT "ResourceMonthlyCost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PnlPeriod" ADD CONSTRAINT "PnlPeriod_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PnlPeriod" ADD CONSTRAINT "PnlPeriod_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PnlPeriod" ADD CONSTRAINT "PnlPeriod_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PnlPeriod" ADD CONSTRAINT "PnlPeriod_lockedByUserId_fkey" FOREIGN KEY ("lockedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PnlPeriod" ADD CONSTRAINT "PnlPeriod_reopenedByUserId_fkey" FOREIGN KEY ("reopenedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PnlTimeEntryAllocation" ADD CONSTRAINT "PnlTimeEntryAllocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PnlTimeEntryAllocation" ADD CONSTRAINT "PnlTimeEntryAllocation_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PnlPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PnlTimeEntryAllocation" ADD CONSTRAINT "PnlTimeEntryAllocation_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TaskTimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderDeliveryLog" ADD CONSTRAINT "ReminderDeliveryLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderDeliveryLog" ADD CONSTRAINT "ReminderDeliveryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReminderDeliveryLog" ADD CONSTRAINT "ReminderDeliveryLog_pmUserId_fkey" FOREIGN KEY ("pmUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
