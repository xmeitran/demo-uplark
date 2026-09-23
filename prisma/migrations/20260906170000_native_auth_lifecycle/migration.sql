ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT, ADD COLUMN "emailVerifiedAt" TIMESTAMP(3), ADD COLUMN "mfaSecret" TEXT, ADD COLUMN "mfaPendingSecret" TEXT, ADD COLUMN "mfaEnabledAt" TIMESTAMP(3), ADD COLUMN "mfaLastStep" INTEGER, ADD COLUMN "mfaRecoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PortalSession" ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'legacy', ADD COLUMN "userAgent" TEXT, ADD COLUMN "ipAddress" TEXT, ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3), ADD COLUMN "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE TABLE "AuthActionToken" ("id" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "purpose" TEXT NOT NULL, "userId" TEXT, "workspaceId" TEXT, "payload" JSONB, "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuthActionToken_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "AuthActionToken_tokenHash_key" ON "AuthActionToken"("tokenHash");
CREATE INDEX "AuthActionToken_userId_purpose_idx" ON "AuthActionToken"("userId", "purpose");
CREATE INDEX "AuthActionToken_expiresAt_idx" ON "AuthActionToken"("expiresAt");
ALTER TABLE "AuthActionToken" ADD CONSTRAINT "AuthActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "AuthRateLimit" ("key" TEXT NOT NULL, "attempts" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key"));
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");
