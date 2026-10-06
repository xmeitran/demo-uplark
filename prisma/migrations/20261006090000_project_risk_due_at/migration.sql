ALTER TABLE "ProjectRisk" ADD COLUMN "dueAt" TIMESTAMP(3);

CREATE INDEX "ProjectRisk_dueAt_status_idx" ON "ProjectRisk"("dueAt", "status");
