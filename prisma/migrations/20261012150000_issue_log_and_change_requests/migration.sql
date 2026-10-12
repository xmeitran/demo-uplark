-- Rules 5.4, V-23…V-32, 8.2: ProjectRisk becomes the shared issue log (Blocker, Risk, Issue, Yêu cầu thay đổi)
-- with a stable per-project code, a validated type/status, location, escalation, change-request steps and a history.
ALTER TABLE "ProjectRisk"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'issue',
  ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN "milestoneId" TEXT,
  ADD COLUMN "stageId" TEXT,
  ADD COLUMN "taskId" TEXT,
  ADD COLUMN "evidence" TEXT,
  ADD COLUMN "nextStep" TEXT,
  ADD COLUMN "impactArea" TEXT,
  ADD COLUMN "escalationLevel" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "escalatedAt" TIMESTAMP(3),
  ADD COLUMN "resolutionEvidence" TEXT,
  ADD COLUMN "resolutionProposedAt" TIMESTAMP(3),
  ADD COLUMN "acceptPmUserId" TEXT,
  ADD COLUMN "acceptLeaderUserId" TEXT,
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "crStep" TEXT,
  ADD COLUMN "stepDueAt" TIMESTAMP(3),
  ADD COLUMN "extension" JSONB NOT NULL DEFAULT '{}';

-- Type: Blocker/Risk/Issue keep their meaning, the four legacy risk categories become Risk, anything else Issue.
UPDATE "ProjectRisk" SET "type" = CASE
  WHEN lower("category") = 'blocker' THEN 'blocker'
  WHEN lower("category") IN ('risk', 'financial', 'operational', 'external', 'strategic') THEN 'risk'
  ELSE 'issue' END;

-- Status: two free-text states become the four of 5.4; unknown values are treated as still waiting.
UPDATE "ProjectRisk" SET "status" = CASE
  WHEN lower("status") IN ('resolved', 'closed', 'done') THEN 'resolved'
  WHEN lower("status") IN ('accepted') THEN 'accepted'
  WHEN lower("status") IN ('in_progress', 'in-progress', 'doing') THEN 'in_progress'
  ELSE 'pending' END;
UPDATE "ProjectRisk" SET "closedAt" = "updatedAt" WHERE "status" IN ('resolved', 'accepted');

-- One severity instead of likelihood x impact: the higher of the two.
UPDATE "ProjectRisk" SET "severity" = CASE
  WHEN 'High' IN ("likelihood", "impact") THEN 'high'
  WHEN 'Medium' IN ("likelihood", "impact") THEN 'medium'
  ELSE 'low' END;
UPDATE "ProjectRisk" SET "nextStep" = "switchTrigger" WHERE "switchTrigger" IS NOT NULL AND btrim("switchTrigger") <> '';

-- Codes in creation order, per project and type prefix.
UPDATE "ProjectRisk" AS r SET "code" = numbered.prefix || '-' || lpad(numbered.n::text, 3, '0')
FROM (
  SELECT "id",
         CASE "type" WHEN 'blocker' THEN 'BLK' WHEN 'risk' THEN 'RSK' WHEN 'change_request' THEN 'CR' ELSE 'ISS' END AS prefix,
         row_number() OVER (PARTITION BY "projectId", "type" ORDER BY "createdAt", "id") AS n
  FROM "ProjectRisk"
) AS numbered
WHERE numbered."id" = r."id";

ALTER TABLE "ProjectRisk" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "ProjectRisk" ALTER COLUMN "status" SET DEFAULT 'pending';
ALTER TABLE "ProjectRisk"
  ADD CONSTRAINT "ProjectRisk_type_check" CHECK ("type" IN ('blocker', 'risk', 'issue', 'change_request')),
  ADD CONSTRAINT "ProjectRisk_status_check" CHECK ("status" IN ('pending', 'in_progress', 'resolved', 'accepted', 'new', 'assessing', 'commercial_review', 'customer_approval', 'approved', 'implementing', 'closed', 'not_cr', 'rejected', 'deferred', 'cancelled')),
  ADD CONSTRAINT "ProjectRisk_severity_check" CHECK ("severity" IN ('low', 'medium', 'high', 'critical')),
  ADD CONSTRAINT "ProjectRisk_escalationLevel_check" CHECK ("escalationLevel" IN ('none', 'dx_director', 'bd_lead'));

CREATE UNIQUE INDEX "ProjectRisk_projectId_code_key" ON "ProjectRisk"("projectId", "code");
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "ProjectMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectRisk" ADD CONSTRAINT "ProjectRisk_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProjectRiskEvent" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "fromStep" TEXT,
    "toStep" TEXT,
    "note" TEXT,
    "changes" JSONB,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRiskEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectRiskEvent_riskId_at_idx" ON "ProjectRiskEvent"("riskId", "at");
ALTER TABLE "ProjectRiskEvent" ADD CONSTRAINT "ProjectRiskEvent_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "ProjectRisk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectRiskCounter" (
    "projectId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectRiskCounter_pkey" PRIMARY KEY ("projectId", "prefix")
);
ALTER TABLE "ProjectRiskCounter" ADD CONSTRAINT "ProjectRiskCounter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProjectRiskCounter" ("projectId", "prefix", "last")
SELECT "projectId", split_part("code", '-', 1), count(*) FROM "ProjectRisk" GROUP BY 1, 2;

-- Existing rows start their history with how they were converted.
INSERT INTO "ProjectRiskEvent" ("id", "riskId", "action", "toStatus", "note", "at")
SELECT 'mig_' || md5("id"), "id", 'migrated', "status", 'Chuyển đổi dữ liệu: loại cũ "' || "category" || '", gán mã ' || "code", "createdAt"
FROM "ProjectRisk";
