CREATE TABLE "ProjectCreateReceipt" (
  "keyHash" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCreateReceipt_pkey" PRIMARY KEY ("keyHash")
);
CREATE INDEX "ProjectCreateReceipt_workspaceId_actorUserId_createdAt_idx" ON "ProjectCreateReceipt"("workspaceId", "actorUserId", "createdAt");
