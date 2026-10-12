-- Rules 2 / 3.1-3.2 / 4.2 / D-01, D-05..D-07, D-22: contract line items (hạng mục hợp đồng) and the internal worklog project kind.
CREATE TABLE IF NOT EXISTS "ProjectContractItem" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL DEFAULT 'twk-foundation',
  "projectId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'ROOT',
  "contractType" TEXT,
  "valueAmount" DECIMAL(65,30),
  "currency" TEXT NOT NULL DEFAULT 'VND',
  "estimateMinutes" INTEGER,
  "changeRequestId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "sortOrder" INTEGER NOT NULL DEFAULT 10,
  "createdByUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectContractItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectContractItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectContractItem_projectId_code_key" ON "ProjectContractItem"("projectId", "code");
CREATE INDEX IF NOT EXISTS "ProjectContractItem_workspaceId_projectId_status_sortOrder_idx" ON "ProjectContractItem"("workspaceId", "projectId", "status", "sortOrder");

ALTER TABLE "ProjectTask" ADD COLUMN IF NOT EXISTS "contractItemId" TEXT;
ALTER TABLE "ProjectTask" DROP CONSTRAINT IF EXISTS "ProjectTask_contractItemId_fkey";
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_contractItemId_fkey" FOREIGN KEY ("contractItemId") REFERENCES "ProjectContractItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskTimeEntry" ADD COLUMN IF NOT EXISTS "contractItemId" TEXT;

-- D-08: the fixed "DX Internal Worklog" project becomes its own project kind. Matched by id only (a no-op on any other
-- database), and never when the workspace already has one.
WITH converted AS (
  UPDATE "Project" p SET "projectType" = 'internal_worklog'
  WHERE p."id" = 'cmri1a75c0065rz0j93xscrtv' AND p."projectType" <> 'internal_worklog'
    AND NOT EXISTS (SELECT 1 FROM "Project" o WHERE o."workspaceId" = p."workspaceId" AND o."projectType" = 'internal_worklog')
  RETURNING p."id", p."workspaceId"
)
INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "resource", "resourceId", "before", "after", "requestId")
SELECT 'aud_' || md5(random()::text || "id"), "workspaceId", 'project.kind_converted', 'project', "id",
       '{"projectType":"delivery"}'::jsonb, '{"projectType":"internal_worklog","source":"migration 20261012140000"}'::jsonb, 'migration-20261012140000'
FROM converted;

-- D-01 / D-06: every existing project gets ONE root line item named after it, so no task is left without one.
-- Nothing on Project tells Trọn gói from Theo giờ from Nội bộ, so the type stays NULL ("Chờ phân loại") for the PM to set.
-- The internal worklog project has no line item (rules section 2).
INSERT INTO "ProjectContractItem" ("id", "workspaceId", "projectId", "code", "name", "kind", "sortOrder", "updatedAt")
SELECT 'pci_' || md5(p."id"), p."workspaceId", p."id", 'HM-01', p."name", 'ROOT', 10, CURRENT_TIMESTAMP
FROM "Project" p
WHERE p."projectType" <> 'internal_worklog'
  AND NOT EXISTS (SELECT 1 FROM "ProjectContractItem" i WHERE i."projectId" = p."id");

UPDATE "ProjectTask" t SET "contractItemId" = 'pci_' || md5(t."projectId")
WHERE t."contractItemId" IS NULL AND t."projectId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "ProjectContractItem" i WHERE i."id" = 'pci_' || md5(t."projectId"));

-- D-03: an entry that never had a line item takes its task's.
UPDATE "TaskTimeEntry" e SET "contractItemId" = t."contractItemId"
FROM "ProjectTask" t WHERE t."id" = e."taskId" AND e."contractItemId" IS NULL AND t."contractItemId" IS NOT NULL;

-- D-04: re-derive Layer 2 for every task with the line item and the project kind (same rule as deriveTaskTypeLayer2).
UPDATE "ProjectTask" t SET "taskTypeLayer2" = d."layer2"
FROM (
  SELECT t."id",
    CASE
      WHEN p."id" IS NULL OR k."kind" = '' THEN NULL
      WHEN k."kind" = 'internal_worklog' THEN 'INTERNAL_PROJECT'
      WHEN i."contractType" = 'INTERNAL' THEN 'INTERNAL_PROJECT'
      WHEN k."kind" = 'internal' AND i."contractType" IS DISTINCT FROM 'FIXED_PRICE' AND i."contractType" IS DISTINCT FROM 'TIME_AND_MATERIAL' THEN NULL
      WHEN s."afterPnlClose" IS TRUE THEN 'TICKET_MAINTENANCE'
      WHEN s."afterPnlClose" IS FALSE THEN 'CUSTOMER_PROJECT'
      ELSE NULL
    END AS "layer2"
  FROM "ProjectTask" t
  LEFT JOIN "Project" p ON p."id" = t."projectId"
  LEFT JOIN LATERAL (SELECT regexp_replace(lower(btrim(COALESCE(p."projectType", ''))), '[\s-]+', '_', 'g') AS "kind") k ON TRUE
  LEFT JOIN "ProjectContractItem" i ON i."id" = t."contractItemId"
  LEFT JOIN "ProjectTask" parent ON parent."id" = t."parentTaskId"
  LEFT JOIN "ProjectStage" s ON s."id" = COALESCE(t."stageId", parent."stageId")
) d
WHERE d."id" = t."id" AND t."taskTypeLayer2" IS DISTINCT FROM d."layer2";

-- D-03: entries without a Layer 2 take their task's; entries that have one keep their stored copy.
UPDATE "TaskTimeEntry" e SET "taskTypeLayer2" = t."taskTypeLayer2"
FROM "ProjectTask" t WHERE t."id" = e."taskId" AND e."taskTypeLayer2" IS NULL AND t."taskTypeLayer2" IS NOT NULL;
