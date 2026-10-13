-- Restore unique indexes used by the idempotent foundation seed. The Render
-- staging database can have these tables while its baseline indexes are absent.
CREATE UNIQUE INDEX IF NOT EXISTS "Role_code_key"
  ON "Role"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "Team_code_key"
  ON "Team"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "RoleBinding_userId_roleId_tenantKey_workspaceId_key"
  ON "RoleBinding"("userId", "roleId", "tenantKey", "workspaceId");

CREATE UNIQUE INDEX IF NOT EXISTS "PortalIdentity_provider_providerUserId_tenantKey_key"
  ON "PortalIdentity"("provider", "providerUserId", "tenantKey");

CREATE UNIQUE INDEX IF NOT EXISTS "FieldPolicy_resource_fieldName_key"
  ON "FieldPolicy"("resource", "fieldName");

CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationEventLog_idempotencyKey_key"
  ON "IntegrationEventLog"("idempotencyKey");

CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationEventLog_provider_externalEventId_key"
  ON "IntegrationEventLog"("provider", "externalEventId");
