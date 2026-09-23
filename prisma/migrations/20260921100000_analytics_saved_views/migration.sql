CREATE TABLE "AnalyticsSavedView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "searchState" VARCHAR(1500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnalyticsSavedView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsSavedView_workspaceId_ownerUserId_name_key"
ON "AnalyticsSavedView"("workspaceId", "ownerUserId", "name");

CREATE INDEX "AnalyticsSavedView_workspaceId_ownerUserId_updatedAt_idx"
ON "AnalyticsSavedView"("workspaceId", "ownerUserId", "updatedAt" DESC);

ALTER TABLE "AnalyticsSavedView"
ADD CONSTRAINT "AnalyticsSavedView_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsSavedView"
ADD CONSTRAINT "AnalyticsSavedView_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
