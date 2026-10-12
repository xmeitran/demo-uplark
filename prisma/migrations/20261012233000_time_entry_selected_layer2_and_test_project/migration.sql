-- P&L tab spec, decisions of 12/10:
-- point 5: Layer 2 is chosen by the person logging time. "taskTypeLayer2" stays the value derived from the task;
--          "selectedTaskTypeLayer2" is the choice (NULL = legacy row written before the picker). The hour gate compares the two.
-- PL-02:   "Dự án thử nghiệm" flag on the project.

ALTER TABLE "TaskTimeEntry" ADD COLUMN "selectedTaskTypeLayer2" TEXT;
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_selectedTaskTypeLayer2_check"
  CHECK ("selectedTaskTypeLayer2" IS NULL OR "selectedTaskTypeLayer2" IN ('CUSTOMER_PROJECT', 'TICKET_MAINTENANCE', 'INTERNAL_PROJECT'));

ALTER TABLE "Project" ADD COLUMN "isTestProject" BOOLEAN NOT NULL DEFAULT false;
