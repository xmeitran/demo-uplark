-- Restore unique indexes used by the deterministic Render P&L demo seed.
CREATE UNIQUE INDEX IF NOT EXISTS "Account_workspaceId_code_key"
  ON "Account"("workspaceId", "code");

CREATE UNIQUE INDEX IF NOT EXISTS "Project_workspaceId_code_key"
  ON "Project"("workspaceId", "code");

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMember_workspaceId_projectId_userId_relation_key"
  ON "ProjectMember"("workspaceId", "projectId", "userId", "relation");

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectBudget_code_key"
  ON "ProjectBudget"("code");
