CREATE TABLE "PnlConfiguration" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "parameters" JSONB NOT NULL,
  "pool" JSONB NOT NULL,
  "templates" JSONB NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PnlConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PnlConfiguration_workspaceId_periodKey_key" ON "PnlConfiguration"("workspaceId", "periodKey");
CREATE INDEX "PnlConfiguration_workspaceId_periodKey_idx" ON "PnlConfiguration"("workspaceId", "periodKey");
ALTER TABLE "PnlConfiguration" ADD CONSTRAINT "PnlConfiguration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
