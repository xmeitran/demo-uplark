-- Workspace-scoped, effective-dated membership model for workforce analytics.
-- Additive only: legacy User.departmentCode, Team and TeamMember stay untouched
-- and read-compatible. Backfill below copies only deterministic mappings; rows
-- that cannot be mapped deterministically are intentionally left missing so
-- analytics can report coverage instead of inventing membership.

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceTeam" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceTeamMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMemberProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT,
    "primaryTeamId" TEXT,
    "weeklyCapacityMinutes" INTEGER,
    "billableTargetPercent" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceMemberProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_workspaceId_code_key" ON "Department"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "Department_workspaceId_active_idx" ON "Department"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceTeam_workspaceId_code_key" ON "WorkspaceTeam"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "WorkspaceTeam_workspaceId_active_idx" ON "WorkspaceTeam"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceTeamMember_workspaceId_teamId_userId_effectiveFro_key" ON "WorkspaceTeamMember"("workspaceId", "teamId", "userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkspaceTeamMember_workspaceId_userId_effectiveFrom_idx" ON "WorkspaceTeamMember"("workspaceId", "userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkspaceTeamMember_teamId_effectiveFrom_idx" ON "WorkspaceTeamMember"("teamId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkspaceTeamMember_userId_idx" ON "WorkspaceTeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMemberProfile_workspaceId_userId_effectiveFrom_key" ON "WorkspaceMemberProfile"("workspaceId", "userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkspaceMemberProfile_workspaceId_userId_idx" ON "WorkspaceMemberProfile"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "WorkspaceMemberProfile_workspaceId_departmentId_idx" ON "WorkspaceMemberProfile"("workspaceId", "departmentId");

-- CreateIndex
CREATE INDEX "WorkspaceMemberProfile_workspaceId_primaryTeamId_idx" ON "WorkspaceMemberProfile"("workspaceId", "primaryTeamId");

-- CreateIndex
CREATE INDEX "WorkspaceMemberProfile_userId_idx" ON "WorkspaceMemberProfile"("userId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTeam" ADD CONSTRAINT "WorkspaceTeam_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTeamMember" ADD CONSTRAINT "WorkspaceTeamMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTeamMember" ADD CONSTRAINT "WorkspaceTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "WorkspaceTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceTeamMember" ADD CONSTRAINT "WorkspaceTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMemberProfile" ADD CONSTRAINT "WorkspaceMemberProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "TenantWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMemberProfile" ADD CONSTRAINT "WorkspaceMemberProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMemberProfile" ADD CONSTRAINT "WorkspaceMemberProfile_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMemberProfile" ADD CONSTRAINT "WorkspaceMemberProfile_primaryTeamId_fkey" FOREIGN KEY ("primaryTeamId") REFERENCES "WorkspaceTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Deterministic backfill. Every inserted row records its provenance in
-- "source" so provisional data stays distinguishable from curated data.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Departments: one row per (workspace, normalized legacy departmentCode)
--    for internal users holding an active role binding in that workspace.
INSERT INTO "Department" ("id", "workspaceId", "code", "name", "active", "source", "createdAt", "updatedAt")
SELECT DISTINCT
    'dept-' || md5(rb."workspaceId" || ':' || lower(trim(u."departmentCode"))),
    rb."workspaceId",
    lower(trim(u."departmentCode")),
    trim(u."departmentCode"),
    true,
    'backfill_department_code',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User" u
JOIN "RoleBinding" rb
    ON rb."userId" = u."id"
   AND rb."endsAt" IS NULL
   AND rb."workspaceId" IS NOT NULL
WHERE u."subjectType" = 'INTERNAL_USER'
  AND u."departmentCode" IS NOT NULL
  AND trim(u."departmentCode") <> ''
ON CONFLICT ("workspaceId", "code") DO NOTHING;

-- 2) WorkspaceTeam: mirror a global Team into a workspace only when at least
--    one of its members holds an active role binding in that workspace.
INSERT INTO "WorkspaceTeam" ("id", "workspaceId", "code", "name", "active", "source", "sourceTeamId", "createdAt", "updatedAt")
SELECT DISTINCT
    'wteam-' || md5(rb."workspaceId" || ':' || t."code"),
    rb."workspaceId",
    t."code",
    t."name",
    true,
    'backfill_global_team',
    t."id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Team" t
JOIN "TeamMember" tm ON tm."teamId" = t."id"
JOIN "RoleBinding" rb
    ON rb."userId" = tm."userId"
   AND rb."endsAt" IS NULL
   AND rb."workspaceId" IS NOT NULL
ON CONFLICT ("workspaceId", "code") DO NOTHING;

-- 3) WorkspaceTeamMember: mirror global TeamMember rows only for users with an
--    active role binding in the target workspace. effectiveFrom uses the
--    original membership creation instant (deterministic).
INSERT INTO "WorkspaceTeamMember" ("id", "workspaceId", "teamId", "userId", "effectiveFrom", "effectiveTo", "source", "createdAt", "updatedAt")
SELECT DISTINCT
    'wtm-' || md5(wt."workspaceId" || ':' || wt."id" || ':' || tm."userId"),
    wt."workspaceId",
    wt."id",
    tm."userId",
    tm."createdAt",
    NULL::TIMESTAMP(3),
    'backfill_global_team',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "TeamMember" tm
JOIN "WorkspaceTeam" wt ON wt."sourceTeamId" = tm."teamId"
JOIN "RoleBinding" rb
    ON rb."userId" = tm."userId"
   AND rb."endsAt" IS NULL
   AND rb."workspaceId" = wt."workspaceId"
ON CONFLICT ("workspaceId", "teamId", "userId", "effectiveFrom") DO NOTHING;

-- 4) WorkspaceMemberProfile: one open-ended profile per internal user with an
--    active role binding in the workspace. Capacity/billable target copy from
--    ResourceProfile when present, otherwise stay NULL (missing coverage).
--    primaryTeamId is set only when the user maps to exactly one workspace
--    team (deterministic); ambiguous membership stays NULL.
INSERT INTO "WorkspaceMemberProfile" (
    "id", "workspaceId", "userId", "departmentId", "primaryTeamId",
    "weeklyCapacityMinutes", "billableTargetPercent",
    "effectiveFrom", "effectiveTo", "source", "createdAt", "updatedAt"
)
SELECT
    'wmp-' || md5(scoped."workspaceId" || ':' || scoped."userId"),
    scoped."workspaceId",
    scoped."userId",
    d."id",
    single_team."teamId",
    rp."defaultWeeklyCapacityMinutes",
    rp."billableTargetPercent",
    LEAST(u."createdAt", scoped."firstBoundAt"),
    NULL::TIMESTAMP(3),
    'backfill_legacy_profile',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT rb."workspaceId", rb."userId", MIN(rb."createdAt") AS "firstBoundAt"
    FROM "RoleBinding" rb
    WHERE rb."endsAt" IS NULL AND rb."workspaceId" IS NOT NULL
    GROUP BY rb."workspaceId", rb."userId"
) scoped
JOIN "User" u ON u."id" = scoped."userId" AND u."subjectType" = 'INTERNAL_USER'
LEFT JOIN "Department" d
    ON d."workspaceId" = scoped."workspaceId"
   AND u."departmentCode" IS NOT NULL
   AND d."code" = lower(trim(u."departmentCode"))
LEFT JOIN "ResourceProfile" rp ON rp."userId" = scoped."userId"
LEFT JOIN (
    SELECT wtm."workspaceId", wtm."userId", MIN(wtm."teamId") AS "teamId"
    FROM "WorkspaceTeamMember" wtm
    WHERE wtm."effectiveTo" IS NULL
    GROUP BY wtm."workspaceId", wtm."userId"
    HAVING COUNT(DISTINCT wtm."teamId") = 1
) single_team
    ON single_team."workspaceId" = scoped."workspaceId"
   AND single_team."userId" = scoped."userId"
ON CONFLICT ("workspaceId", "userId", "effectiveFrom") DO NOTHING;
