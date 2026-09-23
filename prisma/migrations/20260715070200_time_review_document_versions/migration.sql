ALTER TABLE "TaskTimeEntry"
ADD COLUMN "reviewedByUserId" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewNote" TEXT;

CREATE INDEX "TaskTimeEntry_reviewedByUserId_idx" ON "TaskTimeEntry"("reviewedByUserId");

ALTER TABLE "TaskTimeEntry"
ADD CONSTRAINT "TaskTimeEntry_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProjectDocumentVersion" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation',
  "accountId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "fileObjectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "note" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectDocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectDocumentVersion_fileObjectId_key" ON "ProjectDocumentVersion"("fileObjectId");
CREATE UNIQUE INDEX "ProjectDocumentVersion_artifactId_version_key" ON "ProjectDocumentVersion"("artifactId", "version");
CREATE INDEX "ProjectDocumentVersion_workspaceId_createdAt_idx" ON "ProjectDocumentVersion"("workspaceId", "createdAt");
CREATE INDEX "ProjectDocumentVersion_accountId_createdAt_idx" ON "ProjectDocumentVersion"("accountId", "createdAt");
CREATE INDEX "ProjectDocumentVersion_projectId_createdAt_idx" ON "ProjectDocumentVersion"("projectId", "createdAt");
CREATE INDEX "ProjectDocumentVersion_createdByUserId_idx" ON "ProjectDocumentVersion"("createdByUserId");

ALTER TABLE "ProjectDocumentVersion"
ADD CONSTRAINT "ProjectDocumentVersion_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectDocumentVersion"
ADD CONSTRAINT "ProjectDocumentVersion_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectDocumentVersion"
ADD CONSTRAINT "ProjectDocumentVersion_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectDocumentVersion"
ADD CONSTRAINT "ProjectDocumentVersion_artifactId_fkey"
FOREIGN KEY ("artifactId") REFERENCES "ProjectArtifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectDocumentVersion"
ADD CONSTRAINT "ProjectDocumentVersion_fileObjectId_fkey"
FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectDocumentVersion"
ADD CONSTRAINT "ProjectDocumentVersion_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
