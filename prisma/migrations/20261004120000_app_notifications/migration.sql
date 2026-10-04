CREATE TABLE "AppNotification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dedupeKey" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "actedAt" TIMESTAMP(3),
    CONSTRAINT "AppNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppNotification_dedupeKey_key" ON "AppNotification"("dedupeKey");
CREATE INDEX "AppNotification_workspaceId_recipientUserId_createdAt_idx" ON "AppNotification"("workspaceId", "recipientUserId", "createdAt" DESC);
CREATE INDEX "AppNotification_recipientUserId_readAt_createdAt_idx" ON "AppNotification"("recipientUserId", "readAt", "createdAt" DESC);
CREATE INDEX "AppNotification_workspaceId_entityType_entityId_idx" ON "AppNotification"("workspaceId", "entityType", "entityId");

ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppNotification" ADD CONSTRAINT "AppNotification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectMilestone"
  ADD COLUMN "approvalRequestedAt" TIMESTAMP(3),
  ADD COLUMN "approvalRequestedByUserId" TEXT,
  ADD COLUMN "approvalRequestedByName" TEXT;

CREATE INDEX "ProjectMilestone_workspaceId_approvalRequestedAt_idx"
  ON "ProjectMilestone"("workspaceId", "approvalRequestedAt");
