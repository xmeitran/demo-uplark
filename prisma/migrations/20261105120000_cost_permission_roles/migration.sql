-- The cost permission roles were only ever created by prisma/seed-foundation.ts, which production never re-ran after they
-- were added. Without them, choosing PM, BD Lead or Dx Director (which bring the cost permissions by default, 7.7) and
-- the cost permission switches in Admin › Users are refused with "Vai trò COST_VIEW chưa được khởi tạo trong hệ thống".
-- Same ids, names and descriptions as the seed; rows that already exist are left alone.
INSERT INTO "Role" ("id", "code", "name", "type", "description", "createdAt") VALUES
  ('role-cost-view', 'COST_VIEW', 'Cost Viewer', 'BUSINESS', 'Can view approved cost and P&L data.', now()),
  ('role-cost-edit', 'COST_EDIT', 'Cost Editor', 'BUSINESS', 'Can edit resource cost inputs.', now()),
  ('role-cost-approve', 'COST_APPROVE', 'Cost Approver', 'BUSINESS', 'Can approve cost and P&L inputs.', now()),
  ('role-cost-export', 'COST_EXPORT', 'Cost Exporter', 'BUSINESS', 'Can export approved cost and P&L data.', now())
ON CONFLICT ("code") DO NOTHING;
