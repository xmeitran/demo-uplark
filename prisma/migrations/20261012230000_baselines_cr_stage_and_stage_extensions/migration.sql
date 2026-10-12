-- Rules 6.3 (D-20, D-21), V-39/V-40 and TD-04/TD-05: versioned baselines B0/B1, the stage generated for a
-- change request, and approved stage extensions.

CREATE TABLE "ProjectBaseline" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "causeType" TEXT NOT NULL,
    "causeId" TEXT,
    "causeCode" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBaseline_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectBaseline_layer_check" CHECK ("layer" IN ('B0', 'B1')),
    CONSTRAINT "ProjectBaseline_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "ProjectBaseline_projectId_layer_version_key" ON "ProjectBaseline"("projectId", "layer", "version");
CREATE INDEX "ProjectBaseline_workspaceId_projectId_idx" ON "ProjectBaseline"("workspaceId", "projectId");
ALTER TABLE "ProjectBaseline" ADD CONSTRAINT "ProjectBaseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- D-20: an old version is kept for reconciliation, so a stored version can never be rewritten.
-- (Deleting is left to the project cascade.)
CREATE FUNCTION "ProjectBaseline_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ProjectBaseline rows are immutable; write a new version instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProjectBaseline_no_update" BEFORE UPDATE ON "ProjectBaseline" FOR EACH ROW EXECUTE FUNCTION "ProjectBaseline_immutable"();

ALTER TABLE "ProjectStage" ADD COLUMN "changeRequestId" TEXT;
CREATE UNIQUE INDEX "ProjectStage_changeRequestId_key" ON "ProjectStage"("changeRequestId");

CREATE TABLE "ProjectStageExtension" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "previousDueAt" TIMESTAMP(3),
    "newDueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "changeRequestId" TEXT,
    "approvedByUserId" TEXT NOT NULL,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectStageExtension_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectStageExtension_stageId_approvedAt_idx" ON "ProjectStageExtension"("stageId", "approvedAt");
CREATE INDEX "ProjectStageExtension_workspaceId_projectId_idx" ON "ProjectStageExtension"("workspaceId", "projectId");
ALTER TABLE "ProjectStageExtension" ADD CONSTRAINT "ProjectStageExtension_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectStageExtension" ADD CONSTRAINT "ProjectStageExtension_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
