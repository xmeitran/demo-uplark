-- Rules 5.1 / V-22 / 9.3: ten-status project catalogue with a mandatory close reason.
ALTER TABLE "ProjectStatusHistory" ADD COLUMN IF NOT EXISTS "closeReasonCode" TEXT;

-- Stored values the catalogue would read as unknown only because of case, spacing or dashes ("In Progress" -> "in_progress").
UPDATE "Project"
SET "status" = regexp_replace(lower(btrim("status")), '[_\s-]+', '_', 'g')
WHERE "status" <> regexp_replace(lower(btrim("status")), '[_\s-]+', '_', 'g');

-- "cancelled" used to read as At Risk; it now means Closed with reason "Hủy nội bộ". Re-running finds no cancelled rows.
WITH converted AS (
  UPDATE "Project" SET "status" = 'closed'
  WHERE "status" IN ('cancelled', 'canceled')
  RETURNING "id", "workspaceId"
)
INSERT INTO "ProjectStatusHistory" ("id", "workspaceId", "projectId", "fromStatus", "toStatus", "reason", "closeReasonCode")
SELECT 'psh_' || md5(random()::text || "id"), "workspaceId", "id", 'at_risk', 'closed',
       'Quy đổi tự động từ trạng thái cũ "cancelled" khi chuyển sang danh mục 10 trạng thái.', 'internal_cancel'
FROM converted;
