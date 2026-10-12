-- 7.6: configuration parameters entered by Admin. Append-only: the newest row of a key is its value, older rows its history.
CREATE TABLE "SystemParameter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemParameter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemParameter_workspaceId_key_createdAt_idx" ON "SystemParameter"("workspaceId", "key", "createdAt" DESC);
