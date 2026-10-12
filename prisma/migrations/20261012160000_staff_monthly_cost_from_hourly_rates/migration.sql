-- Rules section 2 "Nhân sự và chi phí", D-26, D-34: staff cost is entered per person per MONTH (ResourceMonthlyCost).
-- CostRateProfile (hourly rate, carried forward) is no longer read; the table and its rows are kept.
ALTER TABLE "ResourceMonthlyCost" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "ResourceMonthlyCost" ADD COLUMN IF NOT EXISTS "level" TEXT;

-- Each hourly rate becomes the cost of the ONE month it was entered for (the month of effectiveFrom in Asia/Ho_Chi_Minh);
-- no later month inherits it (D-26). Monthly cost = hourly rate x Mon-Fri days of that month x 8 hours, the inverse of
-- the derivation in apps/api/src/modules/resource-controls/pnl-rules.ts. Rows without a workspace or a person cannot
-- be attached to a staff profile and are left out. A person-month that already has a monthly cost is not overwritten.
WITH rates AS (
  SELECT DISTINCT ON (c."workspaceId", c."userId", date_trunc('month', c."effectiveFrom" + interval '7 hours'))
         c."id", c."workspaceId", c."userId", c."role", c."currency", c."hourlyCostRate",
         date_trunc('month', c."effectiveFrom" + interval '7 hours') AS month_start
  FROM "CostRateProfile" c
  WHERE c."active" AND c."workspaceId" IS NOT NULL AND c."userId" IS NOT NULL
  ORDER BY c."workspaceId", c."userId", date_trunc('month', c."effectiveFrom" + interval '7 hours'), c."effectiveFrom" DESC, c."updatedAt" DESC
), converted AS (
  INSERT INTO "ResourceMonthlyCost" ("id", "workspaceId", "userId", "periodStart", "periodEnd", "periodKey", "currency",
                                     "totalMonthlyIncome", "hourlyCostRate", "status", "source", "role", "updatedAt")
  SELECT 'rmc_' || md5(r."id"), r."workspaceId", r."userId", r.month_start::date, (r.month_start + interval '1 month' - interval '1 day')::date,
         to_char(r.month_start, 'YYYY-MM'), r."currency",
         round(r."hourlyCostRate" * w.working_days * 8, 2), r."hourlyCostRate", 'ENTERED', 'converted_hourly_rate', r."role", CURRENT_TIMESTAMP
  FROM rates r
  CROSS JOIN LATERAL (
    SELECT count(*) AS working_days
    FROM generate_series(r.month_start, r.month_start + interval '1 month' - interval '1 day', interval '1 day') AS d(day)
    WHERE extract(isodow FROM d.day) < 6
  ) w
  ON CONFLICT ("workspaceId", "userId", "periodKey") DO NOTHING
  RETURNING "id", "workspaceId", "userId", "periodKey", "totalMonthlyIncome", "hourlyCostRate"
)
INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "resource", "resourceId", "before", "after", "requestId")
SELECT 'aud_' || md5(random()::text || "id"), "workspaceId", 'pnl.staff_cost_converted', 'resource_monthly_cost', "userId",
       jsonb_build_object('hourlyCostRate', "hourlyCostRate"::text),
       jsonb_build_object('periodKey', "periodKey", 'monthlyCostAmount', "totalMonthlyIncome"::text, 'source', 'migration 20261012160000'),
       'migration-20261012160000'
FROM converted;
