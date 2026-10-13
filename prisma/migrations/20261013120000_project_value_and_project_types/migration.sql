-- "Nguyên tắc nền tảng hệ thống PM" + "Yêu cầu tab P&L" v2 (chốt 13/10): revenue is ONE "Giá trị dự án" per project
-- (D-22, PL-13) and Layer 2 follows Loại dự án + the task's position (table 4.2), no longer the contract line item.
-- Additive: nothing is dropped. Line items, instalments and selling rates stay in place, unread.

ALTER TABLE "ProjectPnlRecord" ADD COLUMN IF NOT EXISTS "projectValueAmount" DECIMAL(65,30);

-- Loại dự án: delivery = Khách hàng, internal = Nội bộ, training = Đào tạo (+ the fixed internal_worklog project).
-- The old model told "nội bộ có tính mandays" from "nội bộ không tính phí" by the line item's type; that answer is
-- carried over to the project type so no logged hour changes side: an internal project with a Trọn gói / Theo giờ item
-- becomes Khách hàng, a project whose items are all Nội bộ becomes Nội bộ. Every other legacy value is Khách hàng.
WITH kinds AS (
  SELECT p."id", p."workspaceId", p."projectType" AS "before",
         regexp_replace(lower(btrim(COALESCE(p."projectType", ''))), '[\s_-]+', '_', 'g') AS "kind",
         (SELECT count(*) FROM "ProjectContractItem" i WHERE i."projectId" = p."id" AND i."archivedAt" IS NULL AND i."status" <> 'archived') AS "items",
         (SELECT count(*) FROM "ProjectContractItem" i WHERE i."projectId" = p."id" AND i."archivedAt" IS NULL AND i."status" <> 'archived' AND i."contractType" = 'INTERNAL') AS "internalItems",
         (SELECT count(*) FROM "ProjectContractItem" i WHERE i."projectId" = p."id" AND i."archivedAt" IS NULL AND i."status" <> 'archived' AND i."contractType" IN ('FIXED_PRICE', 'TIME_AND_MATERIAL')) AS "billableItems"
  FROM "Project" p
), targets AS (
  SELECT "id", "workspaceId", "before",
    CASE
      WHEN "kind" = 'internal_worklog' THEN 'internal_worklog'
      WHEN "kind" IN ('training', 'dao_tao') THEN 'training'
      WHEN "kind" IN ('internal', 'noi_bo') THEN CASE WHEN "billableItems" > 0 THEN 'delivery' ELSE 'internal' END
      WHEN "items" > 0 AND "internalItems" = "items" THEN 'internal'
      ELSE 'delivery'
    END AS "after"
  FROM kinds
), changed AS (
  UPDATE "Project" p SET "projectType" = t."after"
  FROM targets t WHERE t."id" = p."id" AND p."projectType" IS DISTINCT FROM t."after"
  RETURNING p."id", p."workspaceId", t."before", t."after"
)
INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "resource", "resourceId", "before", "after", "requestId")
SELECT 'aud_' || md5(random()::text || "id"), "workspaceId", 'project.kind_converted', 'project', "id",
       jsonb_build_object('projectType', "before"), jsonb_build_object('projectType', "after", 'source', 'migration 20261013120000'), 'migration-20261013120000'
FROM changed;

-- Giá trị dự án of an existing project = its old contract value, when that was known: every chargeable line item has a
-- type and a value (Trọn gói: value, Theo giờ: ceiling). Nội bộ / Đào tạo projects have none.
WITH valued AS (
  SELECT i."projectId", sum(i."valueAmount") AS "amount"
  FROM "ProjectContractItem" i
  WHERE i."archivedAt" IS NULL AND i."status" <> 'archived' AND i."contractType" IS DISTINCT FROM 'INTERNAL'
  GROUP BY i."projectId"
  HAVING bool_and(i."contractType" IS NOT NULL AND i."valueAmount" IS NOT NULL)
), filled AS (
  UPDATE "ProjectPnlRecord" r SET "projectValueAmount" = v."amount"
  FROM valued v JOIN "Project" p ON p."id" = v."projectId"
  WHERE r."projectId" = v."projectId" AND r."projectValueAmount" IS NULL AND p."projectType" = 'delivery' AND v."amount" > 0
  RETURNING r."projectId", r."workspaceId", v."amount"
)
INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "resource", "resourceId", "after", "requestId")
SELECT 'aud_' || md5(random()::text || "projectId"), "workspaceId", 'pnl.project_value_changed', 'pnl_project', "projectId",
       jsonb_build_object('amount', "amount", 'reason', 'Chuyển từ giá trị hợp đồng (các hạng mục) sang Giá trị dự án'), 'migration-20261013120000'
FROM filled;

-- Table 4.2, same rule as deriveTaskTypeLayer2: re-derive Layer 2 of every task from Loại dự án and the stage's side
-- of the P&L closing point.
UPDATE "ProjectTask" t SET "taskTypeLayer2" = d."layer2"
FROM (
  SELECT t."id",
    CASE
      WHEN p."id" IS NULL THEN NULL
      WHEN p."projectType" IN ('internal_worklog', 'internal', 'training') THEN 'INTERNAL_PROJECT'
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

-- D-03: an hour without a stored Layer 2 takes its task's; an hour that has one keeps its stored copy.
UPDATE "TaskTimeEntry" e SET "taskTypeLayer2" = t."taskTypeLayer2"
FROM "ProjectTask" t WHERE t."id" = e."taskId" AND e."taskTypeLayer2" IS NULL AND t."taskTypeLayer2" IS NOT NULL;
