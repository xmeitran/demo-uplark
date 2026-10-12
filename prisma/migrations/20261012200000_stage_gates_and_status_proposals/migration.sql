-- Rules 7.2, 7.3, 8.1: stage-level gates G1–G8 (ProjectGate), stage SLA with the customer-wait pause (V-19)
-- and status proposals (V-17). Definitions of the gates: packages/contracts/src/gates.ts.

ALTER TABLE "ProjectStage"
  ADD COLUMN "slaDays" INTEGER,
  ADD COLUMN "slaPausedAt" TIMESTAMP(3),
  ADD COLUMN "customerWaitDays" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProjectGate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_submitted',
    "submittedAt" TIMESTAMP(3),
    "submittedByUserId" TEXT,
    "decision" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decisionReason" TEXT,
    "conditionIssueId" TEXT,
    "paymentConfirmedAt" TIMESTAMP(3),
    "paymentConfirmedByUserId" TEXT,
    "paymentNote" TEXT,
    "customerRequestedAt" TIMESTAMP(3),
    "customerDueAt" TIMESTAMP(3),
    "customerReminderCount" INTEGER NOT NULL DEFAULT 0,
    "customerConfirmedAt" TIMESTAMP(3),
    "customerConfirmedBy" TEXT,
    "customerEvidence" TEXT,
    "customerRecordedByUserId" TEXT,
    "exceptionAt" TIMESTAMP(3),
    "exceptionByUserId" TEXT,
    "exceptionReason" TEXT,
    "goLiveDate" DATE,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectGate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectGate_status_check" CHECK ("status" IN ('not_submitted', 'submitted', 'rejected', 'awaiting_customer', 'approved', 'exception'))
);

CREATE UNIQUE INDEX "ProjectGate_stageId_key" ON "ProjectGate"("stageId");
CREATE UNIQUE INDEX "ProjectGate_projectId_code_key" ON "ProjectGate"("projectId", "code");
CREATE INDEX "ProjectGate_workspaceId_status_idx" ON "ProjectGate"("workspaceId", "status");
ALTER TABLE "ProjectGate" ADD CONSTRAINT "ProjectGate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectGate" ADD CONSTRAINT "ProjectGate_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectStatusProposal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "proposedStatus" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "suggestedReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "declineReason" TEXT,

    CONSTRAINT "ProjectStatusProposal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectStatusProposal_status_check" CHECK ("status" IN ('pending', 'confirmed', 'declined', 'superseded'))
);

CREATE INDEX "ProjectStatusProposal_workspaceId_status_idx" ON "ProjectStatusProposal"("workspaceId", "status");
CREATE INDEX "ProjectStatusProposal_projectId_createdAt_idx" ON "ProjectStatusProposal"("projectId", "createdAt" DESC);
-- One open proposal per project; a new computation replaces it.
CREATE UNIQUE INDEX "ProjectStatusProposal_one_pending_per_project" ON "ProjectStatusProposal"("projectId") WHERE "status" = 'pending';
ALTER TABLE "ProjectStatusProposal" ADD CONSTRAINT "ProjectStatusProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing projects on TPL-001 (milestoneTemplateKey 'pilot-v1'): stage SLA from the template.
UPDATE "ProjectStage" s SET "slaDays" = t.sla
FROM (VALUES ('intake', 2), ('validate', 2), ('design', 3), ('build', 5), ('deployment_preparation', 2), ('pilot', 3), ('onboard', 2), ('acceptance', 1)) AS t(stage_key, sla),
     "Project" p
WHERE p."id" = s."projectId" AND p."milestoneTemplateKey" = 'pilot-v1' AND s."stageKey" = t.stage_key;

-- ...and G1–G8, with the state inferred conservatively from the milestone gate row of the stage's milestone:
--   milestone approved        -> every gate inside it is approved (its approver and time are kept; flagged as migrated)
--   milestone pending review  -> its closing gate (G1/G4/G7/G8) is submitted; inner gates stay "chờ nộp"
--   milestone rejected        -> its closing gate is rejected
--   milestone conditional     -> its closing gate is submitted again (the old "conditional" never opened the next milestone)
--   anything else             -> not submitted
-- Projects on hand-built frameworks get no rows and keep their milestone gates unchanged.
INSERT INTO "ProjectGate" ("id", "workspaceId", "projectId", "milestoneId", "stageId", "code", "sortOrder", "status",
                           "submittedAt", "submittedByUserId", "decision", "decidedAt", "decidedByUserId",
                           "customerConfirmedAt", "customerRecordedByUserId", "history", "updatedAt")
SELECT 'gate_' || md5(s."id"), s."workspaceId", s."projectId", s."milestoneId", s."id", g.code, g.ord,
       CASE WHEN m."gateStatus" = 'approved' THEN 'approved'
            WHEN g.closes AND m."gateStatus" IN ('pending_review', 'conditional') THEN 'submitted'
            WHEN g.closes AND m."gateStatus" = 'rejected' THEN 'rejected'
            ELSE 'not_submitted' END,
       CASE WHEN g.closes AND m."gateStatus" IN ('pending_review', 'conditional', 'approved') THEN COALESCE(m."approvalRequestedAt", m."updatedAt") END,
       CASE WHEN g.closes AND m."gateStatus" IN ('pending_review', 'conditional', 'approved') THEN m."approvalRequestedByUserId" END,
       CASE WHEN m."gateStatus" = 'approved' THEN 'approved' WHEN g.closes AND m."gateStatus" = 'rejected' THEN 'rejected' END,
       CASE WHEN m."gateStatus" = 'approved' THEN COALESCE(m."reviewerApprovedAt", m."updatedAt") END,
       CASE WHEN m."gateStatus" = 'approved' THEN m."reviewerApprovedByUserId" END,
       CASE WHEN g.closes AND m."gateStatus" = 'approved' THEN m."customerConfirmationAt" END,
       CASE WHEN g.closes AND m."gateStatus" = 'approved' THEN m."customerConfirmationByUserId" END,
       jsonb_build_array(jsonb_build_object(
         'at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'action', 'migrated', 'label', 'Chuyển đổi từ điểm chốt milestone', 'byUserId', NULL, 'byName', 'Hệ thống', 'fromStatus', NULL,
         'toStatus', CASE WHEN m."gateStatus" = 'approved' THEN 'approved'
                          WHEN g.closes AND m."gateStatus" IN ('pending_review', 'conditional') THEN 'submitted'
                          WHEN g.closes AND m."gateStatus" = 'rejected' THEN 'rejected'
                          ELSE 'not_submitted' END,
         'note', 'Trạng thái suy ra từ điểm chốt milestone "' || m."name" || '" (' || m."gateStatus" || ')')),
       CURRENT_TIMESTAMP
FROM "ProjectStage" s
JOIN "Project" p ON p."id" = s."projectId" AND p."milestoneTemplateKey" = 'pilot-v1'
JOIN "ProjectMilestone" m ON m."id" = s."milestoneId"
JOIN (VALUES ('validate', 'G1', 1, true), ('design', 'G2', 2, false), ('build', 'G3', 3, false), ('deployment_preparation', 'G4', 4, true),
             ('pilot', 'G5', 5, false), ('onboard', 'G6', 6, false), ('acceptance', 'G7', 7, true), ('handover', 'G8', 8, true)) AS g(stage_key, code, ord, closes)
  ON g.stage_key = s."stageKey";
