-- "Yêu cầu tab P&L – hệ thống PM" (12/10/2026): layer 0 configuration, layer 1 inputs that had no home yet,
-- the per-project P&L record and the month snapshot of layer 3. Additive only: no column or row is dropped.

-- PL-28: one P&L record per project, created with the project by the database itself.
CREATE TABLE "ProjectPnlRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "overrideDisabledCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overrideEnabledCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overrideReason" TEXT,
    "overrideByUserId" TEXT,
    "overrideByName" TEXT,
    "overrideAt" TIMESTAMP(3),
    "contractStatus" TEXT NOT NULL DEFAULT 'draft',
    "contractSignedAt" TIMESTAMP(3),
    "contractSignedByUserId" TEXT,
    "frozenDisabledCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPnlRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectPnlRecord_contractStatus_check" CHECK ("contractStatus" IN ('draft', 'signed'))
);
CREATE UNIQUE INDEX "ProjectPnlRecord_projectId_key" ON "ProjectPnlRecord"("projectId");
CREATE INDEX "ProjectPnlRecord_workspaceId_idx" ON "ProjectPnlRecord"("workspaceId");
ALTER TABLE "ProjectPnlRecord" ADD CONSTRAINT "ProjectPnlRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "Project_create_pnl_record"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "ProjectPnlRecord" ("id", "workspaceId", "projectId") VALUES ('ppr_' || NEW."id", NEW."workspaceId", NEW."id")
  ON CONFLICT ("projectId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Project_create_pnl_record" AFTER INSERT ON "Project" FOR EACH ROW EXECUTE FUNCTION "Project_create_pnl_record"();

-- Projects that already exist get their record now.
INSERT INTO "ProjectPnlRecord" ("id", "workspaceId", "projectId")
SELECT 'ppr_' || "id", "workspaceId", "id" FROM "Project"
ON CONFLICT ("projectId") DO NOTHING;

-- PL-20 / PL-21: the cost-item tree.
CREATE TABLE "PnlCostItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentCode" TEXT,
    "sign" INTEGER NOT NULL DEFAULT 1,
    "roleGroup" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'VND',
    "method" TEXT NOT NULL,
    "systemSource" TEXT,
    "formula" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFromPeriod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sourceNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 10,
    "draft" JSONB,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PnlCostItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PnlCostItem_method_check" CHECK ("method" IN ('MANUAL', 'SYSTEM', 'FORMULA', 'FUND', 'GROUP')),
    CONSTRAINT "PnlCostItem_sign_check" CHECK ("sign" IN (1, -1)),
    CONSTRAINT "PnlCostItem_status_check" CHECK ("status" IN ('active', 'draft', 'retired'))
);
CREATE UNIQUE INDEX "PnlCostItem_workspaceId_code_key" ON "PnlCostItem"("workspaceId", "code");

-- PL-22: item templates by project type.
CREATE TABLE "PnlItemTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "disabledCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consumable" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PnlItemTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PnlItemTemplate_workspaceId_key_key" ON "PnlItemTemplate"("workspaceId", "key");

-- PL-19: parameter values by scope and effective period, append-only.
CREATE TABLE "PnlParameterValue" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subKey" TEXT,
    "scopeType" TEXT NOT NULL DEFAULT 'company',
    "scopeId" TEXT,
    "value" JSONB NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PnlParameterValue_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PnlParameterValue_scopeType_check" CHECK ("scopeType" IN ('company', 'customer', 'project_type', 'project')),
    CONSTRAINT "PnlParameterValue_effectiveFrom_check" CHECK ("effectiveFrom" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE INDEX "PnlParameterValue_workspaceId_key_effectiveFrom_idx" ON "PnlParameterValue"("workspaceId", "key", "effectiveFrom");
CREATE FUNCTION "PnlParameterValue_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PnlParameterValue rows are immutable; add a new value instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PnlParameterValue_no_update" BEFORE UPDATE ON "PnlParameterValue" FOR EACH ROW EXECUTE FUNCTION "PnlParameterValue_immutable"();

-- PL-17: shared cost funds.
CREATE TABLE "PnlFund" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetItemCode" TEXT NOT NULL,
    "criterion" TEXT NOT NULL DEFAULT 'pnl_hours',
    "eligibility" TEXT NOT NULL DEFAULT 'billable_with_hours',
    "eligibleProjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PnlFund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PnlFund_workspaceId_code_key" ON "PnlFund"("workspaceId", "code");

CREATE TABLE "PnlFundPeriod" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "sourceCurrency" TEXT NOT NULL DEFAULT 'VND',
    "sourceAmount" DECIMAL(65,30) NOT NULL,
    "exchangeRate" DECIMAL(65,30),
    "invoiceRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unallocated',
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "confirmedByName" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PnlFundPeriod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PnlFundPeriod_status_check" CHECK ("status" IN ('unallocated', 'allocated')),
    CONSTRAINT "PnlFundPeriod_amount_check" CHECK ("amount" >= 0)
);
CREATE UNIQUE INDEX "PnlFundPeriod_fundId_periodKey_key" ON "PnlFundPeriod"("fundId", "periodKey");
CREATE INDEX "PnlFundPeriod_workspaceId_periodKey_idx" ON "PnlFundPeriod"("workspaceId", "periodKey");
ALTER TABLE "PnlFundPeriod" ADD CONSTRAINT "PnlFundPeriod_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "PnlFund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PnlFundAllocation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fundPeriodId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PnlFundAllocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PnlFundAllocation_workspaceId_projectId_idx" ON "PnlFundAllocation"("workspaceId", "projectId");
CREATE INDEX "PnlFundAllocation_workspaceId_periodKey_idx" ON "PnlFundAllocation"("workspaceId", "periodKey");
ALTER TABLE "PnlFundAllocation" ADD CONSTRAINT "PnlFundAllocation_fundPeriodId_fkey" FOREIGN KEY ("fundPeriodId") REFERENCES "PnlFundPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PL-23 / PL-24: the snapshot of a locked month and the lock / reopen history.
CREATE TABLE "PnlPeriodSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedByUserId" TEXT,
    "lockedByName" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenedByName" TEXT,
    "reopenReason" TEXT,

    CONSTRAINT "PnlPeriodSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PnlPeriodSnapshot_workspaceId_periodKey_lockedAt_idx" ON "PnlPeriodSnapshot"("workspaceId", "periodKey", "lockedAt" DESC);

-- Mục 6.1 khối C: payment instalments of a line item.
CREATE TABLE "ProjectContractInstallment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contractItemId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "gateCode" TEXT,
    "percent" DECIMAL(65,30) NOT NULL,
    "expectedOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'not_due',
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectContractInstallment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectContractInstallment_status_check" CHECK ("status" IN ('not_due', 'accepted', 'invoiced', 'paid')),
    CONSTRAINT "ProjectContractInstallment_percent_check" CHECK ("percent" > 0 AND "percent" <= 100)
);
CREATE UNIQUE INDEX "ProjectContractInstallment_contractItemId_sequence_key" ON "ProjectContractInstallment"("contractItemId", "sequence");
CREATE INDEX "ProjectContractInstallment_workspaceId_projectId_idx" ON "ProjectContractInstallment"("workspaceId", "projectId");
ALTER TABLE "ProjectContractInstallment" ADD CONSTRAINT "ProjectContractInstallment_contractItemId_fkey" FOREIGN KEY ("contractItemId") REFERENCES "ProjectContractItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PnlStaffCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PnlStaffCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PnlStaffCode_workspaceId_userId_key" ON "PnlStaffCode"("workspaceId", "userId");
CREATE UNIQUE INDEX "PnlStaffCode_workspaceId_employeeCode_key" ON "PnlStaffCode"("workspaceId", "employeeCode");

ALTER TABLE "ProjectContractItem" ADD COLUMN "warnThresholdPercent" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "ProjectCost" ADD COLUMN "itemCode" TEXT;

-- PL-08: the monthly staff cost gets an approval state. Rows entered under the previous rules ("ENTERED") were already
-- producing cost rates, so they become "Đã duyệt" — otherwise every current P&L would lose its staff cost overnight.
ALTER TABLE "ResourceMonthlyCost" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "ResourceMonthlyCost" ADD COLUMN "approvedByUserId" TEXT;
ALTER TABLE "ResourceMonthlyCost" ADD COLUMN "approvedByName" TEXT;
UPDATE "ResourceMonthlyCost" SET "status" = 'APPROVED', "approvedAt" = "updatedAt", "approvedByName" = 'Chuyển đổi từ quy tắc cũ' WHERE "status" = 'ENTERED';
-- A single figure entered before the components existed is kept as "Lương tiêu chuẩn" so the columns add up to the total.
UPDATE "ResourceMonthlyCost" SET "p1BaseAmount" = "totalMonthlyIncome"
WHERE "p1BaseAmount" = 0 AND "p2AllowanceAmount" = 0 AND "p3PerformanceAmount" = 0 AND "p4OtherVariableAmount" = 0
  AND "overtimeAmount" = 0 AND "socialInsuranceAmount" = 0 AND "otherAmount" = 0 AND "totalMonthlyIncome" > 0;
