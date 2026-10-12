-- "Hai loại tài khoản: Admin và User" + 7.7: the business roles the rules document names become real role rows
-- (catalogue: packages/contracts/src/access-control.ts). Only Role rows are added — no RoleBinding is created,
-- changed or ended here; existing accounts keep exactly the roles they hold.
-- WORKSPACE_ADMIN / WORKSPACE_USER are included because the Users screen binds them and they were only created by the seed.

INSERT INTO "Role" ("id", "code", "name", "type", "description") VALUES
  ('role-pm', 'PM', 'PM', 'BUSINESS', 'Admin - PM'),
  ('role-dx-director', 'DX_DIRECTOR', 'Dx Director', 'BUSINESS', 'Admin - Dx Director (Leader)'),
  ('role-bd-lead', 'BD_LEAD', 'BD Lead', 'BUSINESS', 'Admin - BD Lead (Leader)'),
  ('role-bd', 'BD', 'BD', 'BUSINESS', 'User - BD'),
  ('role-dx', 'DX', 'Dx', 'BUSINESS', 'User - Dx'),
  ('role-pqa', 'PQA', 'PQA', 'BUSINESS', 'User - PQA'),
  ('role-cs', 'CS', 'CS', 'BUSINESS', 'User - CS'),
  ('role-finance-admin', 'FINANCE_ADMIN', 'Finance Admin', 'BUSINESS', 'User - Kế toán'),
  ('role-workspace-admin', 'WORKSPACE_ADMIN', 'Workspace Admin', 'SYSTEM', 'Manages workspace users and internal controls without changing Founder ownership.'),
  ('role-workspace-user', 'WORKSPACE_USER', 'Workspace User', 'BUSINESS', 'Standard internal CRM user without financial administration access.')
ON CONFLICT DO NOTHING;

-- 7.7: an Admin switches between admin view and user view on screen; the choice is kept per account.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "viewMode" TEXT NOT NULL DEFAULT 'admin';
