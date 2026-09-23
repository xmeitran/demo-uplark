ALTER TABLE "TaskPlanningBlock"
ADD COLUMN "billable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "workType" TEXT NOT NULL DEFAULT 'delivery';

ALTER TABLE "TaskTimeEntry"
ADD COLUMN "sourcePlanningBlockId" TEXT;

CREATE UNIQUE INDEX "TaskTimeEntry_sourcePlanningBlockId_key"
ON "TaskTimeEntry"("sourcePlanningBlockId");

ALTER TABLE "TaskTimeEntry"
ADD CONSTRAINT "TaskTimeEntry_sourcePlanningBlockId_fkey"
FOREIGN KEY ("sourcePlanningBlockId")
REFERENCES "TaskPlanningBlock"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
