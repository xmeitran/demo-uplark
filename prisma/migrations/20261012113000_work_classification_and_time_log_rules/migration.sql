-- Rules section 4 / D-02..D-04 / D-09 / D-16: two-layer work classification and the on-hold time-log flag.
ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "taskTypeLayer1" TEXT;
ALTER TABLE "ProjectStage" ADD COLUMN IF NOT EXISTS "afterPnlClose" BOOLEAN;
ALTER TABLE "TaskTimeEntry" ADD COLUMN IF NOT EXISTS "loggedWhileOnHold" BOOLEAN NOT NULL DEFAULT false;

-- Stages created from the built-in template TPL-001 (exact stage keys) take its Layer 1 and P&L-close position.
-- Stages of hand-built frameworks carry no template lineage and stay NULL ("Chờ phân loại").
UPDATE "ProjectStage"
SET "taskTypeLayer1" = CASE
      WHEN "stageKey" IN ('intake', 'validate') THEN 'PRE_SALE'
      WHEN "stageKey" IN ('acceptance', 'handover') THEN 'PM'
      ELSE 'DELIVERY'
    END,
    "afterPnlClose" = "stageKey" IN ('optimize', 'handover')
WHERE "taskTypeLayer1" IS NULL
  AND "stageKey" IN ('intake', 'validate', 'design', 'build', 'deployment_preparation', 'pilot', 'onboard', 'acceptance', 'optimize', 'handover');

-- D-09: a day off is not a kind of work.
UPDATE "ProjectTask" SET "taskTypeLayer2" = NULL WHERE "taskTypeLayer2" = 'DAY_OFF_COMPANY';
UPDATE "TaskTimeEntry" SET "taskTypeLayer2" = NULL WHERE "taskTypeLayer2" = 'DAY_OFF_COMPANY';

-- D-02: a task without Layer 1 takes its stage's value; a sub-task then repeats its parent (nesting is at most 4 deep).
UPDATE "ProjectTask" t SET "taskTypeLayer1" = s."taskTypeLayer1"
FROM "ProjectStage" s
WHERE s."id" = t."stageId" AND t."taskTypeLayer1" IS NULL AND s."taskTypeLayer1" IS NOT NULL;
UPDATE "ProjectTask" c SET "taskTypeLayer1" = p."taskTypeLayer1" FROM "ProjectTask" p
WHERE p."id" = c."parentTaskId" AND c."taskTypeLayer1" IS NULL AND p."taskTypeLayer1" IS NOT NULL;
UPDATE "ProjectTask" c SET "taskTypeLayer1" = p."taskTypeLayer1" FROM "ProjectTask" p
WHERE p."id" = c."parentTaskId" AND c."taskTypeLayer1" IS NULL AND p."taskTypeLayer1" IS NOT NULL;
UPDATE "ProjectTask" c SET "taskTypeLayer1" = p."taskTypeLayer1" FROM "ProjectTask" p
WHERE p."id" = c."parentTaskId" AND c."taskTypeLayer1" IS NULL AND p."taskTypeLayer1" IS NOT NULL;

-- D-04: Layer 2 is derived for every task (same rule as deriveTaskTypeLayer2); a hand-picked value does not survive.
UPDATE "ProjectTask" t SET "taskTypeLayer2" = d."layer2"
FROM (
  SELECT t."id",
    CASE
      WHEN p."id" IS NULL THEN NULL
      WHEN regexp_replace(lower(btrim(p."projectType")), '[\s-]+', '_', 'g') = 'internal_worklog' THEN 'INTERNAL_PROJECT'
      WHEN regexp_replace(lower(btrim(p."projectType")), '[\s-]+', '_', 'g') IN ('internal', '') THEN NULL
      WHEN s."afterPnlClose" IS TRUE THEN 'TICKET_MAINTENANCE'
      WHEN s."afterPnlClose" IS FALSE THEN 'CUSTOMER_PROJECT'
      ELSE NULL
    END AS "layer2"
  FROM "ProjectTask" t
  LEFT JOIN "Project" p ON p."id" = t."projectId"
  LEFT JOIN "ProjectTask" parent ON parent."id" = t."parentTaskId"
  LEFT JOIN "ProjectStage" s ON s."id" = COALESCE(t."stageId", parent."stageId")
) d
WHERE d."id" = t."id" AND t."taskTypeLayer2" IS DISTINCT FROM d."layer2";

-- D-03: time entries that never got a classification take their task's; entries that have one keep their stored copy.
UPDATE "TaskTimeEntry" e SET "taskTypeLayer1" = t."taskTypeLayer1"
FROM "ProjectTask" t WHERE t."id" = e."taskId" AND e."taskTypeLayer1" IS NULL AND t."taskTypeLayer1" IS NOT NULL;
UPDATE "TaskTimeEntry" e SET "taskTypeLayer2" = t."taskTypeLayer2"
FROM "ProjectTask" t WHERE t."id" = e."taskId" AND e."taskTypeLayer2" IS NULL AND t."taskTypeLayer2" IS NOT NULL;
