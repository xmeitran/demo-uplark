CREATE INDEX IF NOT EXISTS "Project_workspaceId_updatedAt_name_idx"
  ON "Project" ("workspaceId", "updatedAt" DESC, "name" ASC);
