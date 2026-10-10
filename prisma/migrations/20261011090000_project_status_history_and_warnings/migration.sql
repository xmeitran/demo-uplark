-- EV-064 project status history; EV-065 shared project warning record + its event log.
CREATE TABLE "ProjectStatusHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "reason" TEXT,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectWarning" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "stageId" TEXT,
    "taskId" TEXT,
    "typeCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "ownerUserId" TEXT,
    "dueAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "closeReason" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWarning_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectWarningEvent" (
    "id" TEXT NOT NULL,
    "warningId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectWarningEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectStatusHistory_projectId_changedAt_idx" ON "ProjectStatusHistory"("projectId", "changedAt" DESC);
CREATE INDEX "ProjectWarning_workspaceId_status_idx" ON "ProjectWarning"("workspaceId", "status");
CREATE INDEX "ProjectWarning_projectId_status_openedAt_idx" ON "ProjectWarning"("projectId", "status", "openedAt" DESC);
CREATE INDEX "ProjectWarning_projectId_dedupeKey_idx" ON "ProjectWarning"("projectId", "dedupeKey");
-- At most one OPEN warning per project and dedupe key; closed rows stay queryable.
CREATE UNIQUE INDEX "ProjectWarning_open_dedupe_key" ON "ProjectWarning"("projectId", "dedupeKey") WHERE "status" = 'open';
CREATE INDEX "ProjectWarningEvent_warningId_at_idx" ON "ProjectWarningEvent"("warningId", "at");

ALTER TABLE "ProjectStatusHistory" ADD CONSTRAINT "ProjectStatusHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWarning" ADD CONSTRAINT "ProjectWarning_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectWarningEvent" ADD CONSTRAINT "ProjectWarningEvent_warningId_fkey" FOREIGN KEY ("warningId") REFERENCES "ProjectWarning"("id") ON DELETE CASCADE ON UPDATE CASCADE;
