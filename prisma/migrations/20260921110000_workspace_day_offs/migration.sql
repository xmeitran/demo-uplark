CREATE TABLE "WorkspaceDayOff" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'national_holiday',
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceDayOff_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TaskTimeEntry" ADD COLUMN "dayOffId" TEXT;

CREATE UNIQUE INDEX "WorkspaceDayOff_workspaceId_date_key"
ON "WorkspaceDayOff"("workspaceId", "date");
CREATE INDEX "WorkspaceDayOff_workspaceId_isActive_date_idx"
ON "WorkspaceDayOff"("workspaceId", "isActive", "date");
CREATE INDEX "WorkspaceDayOff_createdByUserId_idx"
ON "WorkspaceDayOff"("createdByUserId");
CREATE INDEX "TaskTimeEntry_dayOffId_idx" ON "TaskTimeEntry"("dayOffId");

ALTER TABLE "WorkspaceDayOff"
ADD CONSTRAINT "WorkspaceDayOff_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceDayOff"
ADD CONSTRAINT "WorkspaceDayOff_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskTimeEntry"
ADD CONSTRAINT "TaskTimeEntry_dayOffId_fkey"
FOREIGN KEY ("dayOffId") REFERENCES "WorkspaceDayOff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
