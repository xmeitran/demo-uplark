-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('INTERNAL_USER', 'PORTAL_USER', 'SERVICE_ACCOUNT');

-- CreateEnum
CREATE TYPE "SubjectStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('SYSTEM', 'BUSINESS', 'PORTAL', 'SERVICE');

-- CreateEnum
CREATE TYPE "Action" AS ENUM ('LIST', 'READ', 'CREATE', 'UPDATE', 'APPROVE', 'EXPORT', 'DOWNLOAD', 'DELETE');

-- CreateEnum
CREATE TYPE "Resource" AS ENUM ('ACCOUNT', 'OPPORTUNITY', 'PROPOSAL', 'PROJECT', 'TASK', 'CONTRACT', 'PAYMENT', 'CAPACITY', 'DASHBOARD', 'INTEGRATION_EVENT', 'POLICY_DECISION', 'TICKET', 'ARTIFACT');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('GLOBAL', 'TEAM', 'OWNED', 'ASSIGNED_ACCOUNT', 'ASSIGNED_PROJECT', 'CUSTOMER_ACCOUNT', 'CUSTOMER_PROJECT', 'NONE');

-- CreateEnum
CREATE TYPE "DefaultDecision" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "FieldSensitivity" AS ENUM ('PUBLIC', 'INTERNAL', 'COMMERCIAL', 'FINANCIAL', 'CONFIDENTIAL');

-- CreateEnum
CREATE TYPE "ProjectionMode" AS ENUM ('FULL', 'MASK', 'OMIT');

-- CreateEnum
CREATE TYPE "AccountMemberRelation" AS ENUM ('OWNER', 'COLLABORATOR', 'DELIVERY_LEAD', 'FINANCE_OWNER');

-- CreateEnum
CREATE TYPE "IntegrationEventStatus" AS ENUM ('RECEIVED', 'VALIDATED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "PortalInvitationStatus" AS ENUM ('PENDING', 'REVIEW_REQUIRED', 'ACCEPTED', 'REVOKED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProposalPackageType" AS ENUM ('QUICK_SETUP_DISCOVERY', 'STANDARD_IMPLEMENTATION', 'COMPLEX_MULTI_PHASE', 'MONTHLY_RETAINER_SUPPORT', 'CHANGE_REQUEST', 'LICENSE_SUBSCRIPTION_PASS_THROUGH');

-- CreateEnum
CREATE TYPE "ProposalPackageStatus" AS ENUM ('DRAFT', 'INTERNAL_REVIEW', 'REVISION_REQUIRED', 'INTERNALLY_APPROVED', 'SENT_TO_CUSTOMER', 'CUSTOMER_REVISION_REQUESTED', 'CUSTOMER_ACCEPTED', 'SUPERSEDED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProposalDocumentType" AS ENUM ('PROPOSAL', 'SOW', 'QUOTATION', 'PAYMENT_SCHEDULE', 'RISK_REGISTER', 'APPENDIX', 'VENDOR_QUOTE', 'CUSTOMER_ACCEPTANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "DealApprovalRequestType" AS ENUM ('PROPOSAL_READINESS', 'DISCOUNT', 'PAYMENT_TERM', 'SCOPE_RISK', 'UNUSUAL_COMMITMENT', 'LICENSE_PASS_THROUGH', 'CHANGE_REQUEST_IMPACT');

-- CreateEnum
CREATE TYPE "DealApprovalRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ScopeRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'INTERNAL_REVIEW', 'READY_FOR_SIGNATURE', 'SENT_FOR_SIGNATURE', 'SIGNED', 'ACTIVE', 'VOIDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContractSignatureStatus" AS ENUM ('NOT_READY', 'READY', 'SENT', 'SIGNED', 'VOIDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContractDocumentType" AS ENUM ('CONTRACT_PDF', 'SIGNED_CONTRACT', 'APPENDIX', 'SOW', 'PAYMENT_SCHEDULE', 'LEGAL_REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMilestoneStatus" AS ENUM ('PLANNED', 'READY_FOR_FINANCE_REVIEW', 'READY_TO_INVOICE', 'INVOICED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentTriggerType" AS ENUM ('CONTRACT_SIGNING', 'KICKOFF', 'DELIVERY_STAGE', 'ACCEPTANCE', 'CALENDAR_DATE', 'MONTHLY_RETAINER', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'CANCELLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "InvoicePaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "ArFollowUpStatus" AS ENUM ('OPEN', 'SNOOZED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentEvidenceType" AS ENUM ('INVOICE_FILE', 'PAYMENT_RECEIPT', 'BANK_TRANSFER', 'CUSTOMER_CONFIRMATION', 'ACCEPTANCE_EVIDENCE', 'EXCEPTION_APPROVAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ResourceAllocationStatus" AS ENUM ('REQUESTED', 'TENTATIVE', 'RESERVED', 'CONFIRMED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectBudgetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'LOCKED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ProjectCostType" AS ENUM ('LABOR', 'EXTERNAL', 'SOFTWARE', 'TRAVEL', 'WRITE_OFF', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectPlSnapshotStatus" AS ENUM ('DRAFT', 'LOCKED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "subjectType" "SubjectType" NOT NULL DEFAULT 'INTERNAL_USER',
    "status" "SubjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "departmentCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "roleVersion" TEXT NOT NULL,
    "grantVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RoleType" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionSet" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "action" "Action" NOT NULL,
    "resource" "Resource" NOT NULL,
    "scope" "ScopeType" NOT NULL,
    "defaultDecision" "DefaultDecision" NOT NULL DEFAULT 'DENY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "ownerTeamId" TEXT,
    "picUserId" TEXT,
    "annualValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "commercialNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMember" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relation" "AccountMemberRelation" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountUsageReview" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "metricsAvailable" BOOLEAN NOT NULL DEFAULT true,
    "unavailabilityReason" TEXT,
    "licensedUsers" INTEGER,
    "activeUsersMau" INTEGER,
    "adoptionRate" DECIMAL(65,30),
    "weeklyActivityWeeks" INTEGER,
    "docsUsage" INTEGER,
    "baseUsage" INTEGER,
    "taskUsage" INTEGER,
    "workflowUsage" INTEGER,
    "ticketCount" INTEGER,
    "slaBreaches" INTEGER,
    "csat" INTEGER,
    "trainingAttendance" INTEGER,
    "healthScore" TEXT NOT NULL,
    "interpretation" TEXT,
    "expansionSignal" TEXT NOT NULL,
    "nextAction" TEXT NOT NULL,
    "nextReviewDate" TIMESTAMP(3),
    "owner" TEXT NOT NULL,
    "escalationOwner" TEXT,
    "escalationNote" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountUsageReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "influence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "source" TEXT NOT NULL,
    "painPoint" TEXT,
    "serviceFit" TEXT,
    "timeline" TEXT,
    "budgetRange" TEXT,
    "authority" TEXT,
    "status" TEXT NOT NULL DEFAULT 'captured',
    "ownerUserId" TEXT,
    "duplicateOfLeadId" TEXT,
    "duplicateReason" TEXT,
    "qualificationSummary" TEXT,
    "nextActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "leadId" TEXT,
    "title" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "stage" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "forecastCategory" TEXT NOT NULL DEFAULT 'pipeline',
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "handoffConfirmedAt" TIMESTAMP(3),
    "handoffChecklist" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalPackage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "packageType" "ProposalPackageType" NOT NULL,
    "status" "ProposalPackageStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "proposedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paymentTermSummary" TEXT,
    "scopeRiskLevel" "ScopeRiskLevel" NOT NULL DEFAULT 'LOW',
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalDocument" (
    "id" TEXT NOT NULL,
    "proposalPackageId" TEXT NOT NULL,
    "documentType" "ProposalDocumentType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'lark_drive',
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "checksum" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealApprovalRequest" (
    "id" TEXT NOT NULL,
    "proposalPackageId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "requestType" "DealApprovalRequestType" NOT NULL,
    "status" "DealApprovalRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requiredRoleCode" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "assignedToUserId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'standard',
    "reason" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "larkApprovalInstanceCode" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealApprovalDecision" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "comment" TEXT,
    "larkTaskId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "projectId" TEXT,
    "proposalPackageId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "signatureStatus" "ContractSignatureStatus" NOT NULL DEFAULT 'NOT_READY',
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "contractValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "effectiveDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signedByName" TEXT,
    "signedByEmail" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "allowedRoles" TEXT[],
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractDocument" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "documentType" "ContractDocumentType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'lark_drive',
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "checksum" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSchedule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contractId" TEXT,
    "opportunityId" TEXT,
    "projectId" TEXT,
    "proposalPackageId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "PaymentScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "allowedRoles" TEXT[],
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMilestone" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contractId" TEXT,
    "projectId" TEXT,
    "code" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "triggerType" "PaymentTriggerType" NOT NULL DEFAULT 'MANUAL',
    "triggerRef" TEXT,
    "percentage" DECIMAL(65,30),
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "invoiceReadyAt" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "status" "PaymentMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "invoiceStatus" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "InvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "financeOwnerUserId" TEXT,
    "overdueOwnerUserId" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "internalNote" TEXT,
    "customerNote" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contractId" TEXT,
    "projectId" TEXT,
    "code" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "InvoicePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "externalInvoiceNo" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "storageProvider" TEXT NOT NULL DEFAULT 'lark_drive',
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "amount" DECIMAL(65,30) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceType" "PaymentEvidenceType",
    "evidenceTitle" TEXT,
    "storageProvider" TEXT,
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArFollowUp" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "accountId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "status" "ArFollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "nextActionAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvidence" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT,
    "invoiceId" TEXT,
    "accountId" TEXT NOT NULL,
    "evidenceType" "PaymentEvidenceType" NOT NULL,
    "title" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'lark_drive',
    "storageKey" TEXT,
    "externalUrl" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityActivity" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityStageHistory" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "probability" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "forecastCategory" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "OpportunityStageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "marginPercent" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectStage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "cumulativePercent" INTEGER NOT NULL,
    "activityPercent" INTEGER NOT NULL,
    "criteria" TEXT NOT NULL,
    "description" TEXT,
    "upbaseRole" TEXT,
    "customerRole" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "ownerUserId" TEXT,
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "acceptanceCriteria" TEXT,
    "blockerSummary" TEXT,
    "scopeSummary" TEXT,
    "standardMinutes" INTEGER,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayRole" TEXT,
    "defaultWeeklyCapacityMinutes" INTEGER NOT NULL DEFAULT 2400,
    "billableTargetPercent" INTEGER NOT NULL DEFAULT 70,
    "skills" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceCapacityPeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "availableMinutes" INTEGER NOT NULL,
    "plannedLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceCapacityPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceAllocation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "opportunityId" TEXT,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "skill" TEXT,
    "status" "ResourceAllocationStatus" NOT NULL DEFAULT 'REQUESTED',
    "allocationPercent" INTEGER NOT NULL DEFAULT 100,
    "plannedMinutes" INTEGER NOT NULL DEFAULT 0,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "overbookApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedByUserId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostRateProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "hourlyCostRate" DECIMAL(65,30) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostRateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBudget" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "revenueBasis" TEXT NOT NULL DEFAULT 'contracted',
    "plannedRevenueAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "plannedCostAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "baselineMinutes" INTEGER NOT NULL DEFAULT 0,
    "contingencyPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "status" "ProjectBudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCost" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskTimeEntryId" TEXT,
    "costType" "ProjectCostType" NOT NULL DEFAULT 'OTHER',
    "label" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "amount" DECIMAL(65,30) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPlSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "revenueAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "budgetAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "plannedCostAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "actualLaborCostAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "directCostAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "writeOffAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "totalCostAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "grossMarginAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "grossMarginPercent" DECIMAL(65,30),
    "status" "ProjectPlSnapshotStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPlSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "requesterUserId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'other_triage',
    "source" TEXT NOT NULL DEFAULT 'internal',
    "ownerQueue" TEXT NOT NULL DEFAULT 'customer_success',
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "firstResponseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "customerVisibleNote" TEXT,
    "internalNote" TEXT,
    "resolutionSummary" TEXT,
    "resolutionType" TEXT,
    "closureReason" TEXT,
    "confirmationState" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "escalationOwnerUserId" TEXT,
    "escalationReason" TEXT,
    "recoveryAction" TEXT,
    "nextUpdateAt" TIMESTAMP(3),
    "requestedAction" TEXT,
    "customerOwner" TEXT,
    "customerDueAt" TIMESTAMP(3),
    "resolutionSlaPausedAt" TIMESTAMP(3),
    "convertedChangeRequestId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStatusHistory" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "reason" TEXT,
    "customerVisibleNote" TEXT,
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectArtifact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "internalOnly" BOOLEAN NOT NULL DEFAULT false,
    "allowedRoles" TEXT[],
    "signedUrlExpiresSeconds" INTEGER NOT NULL DEFAULT 300,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'local',
    "storageKey" TEXT NOT NULL,
    "externalUrl" TEXT,
    "ownerType" TEXT NOT NULL DEFAULT 'general',
    "ownerId" TEXT,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "internalOnly" BOOLEAN NOT NULL DEFAULT true,
    "allowedRoles" TEXT[],
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdByUserId" TEXT,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileDownloadGrant" (
    "id" TEXT NOT NULL,
    "fileObjectId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileDownloadGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "stageId" TEXT,
    "opportunityId" TEXT,
    "ticketId" TEXT,
    "parentTaskId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "taskType" TEXT NOT NULL DEFAULT 'implementation',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "ownerUserId" TEXT,
    "assigneeUserId" TEXT,
    "ownerTeamId" TEXT,
    "plannedStartAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "estimateMinutes" INTEGER NOT NULL DEFAULT 0,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "parentCommentId" TEXT,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "status" TEXT NOT NULL DEFAULT 'active',
    "larkTaskGuid" TEXT,
    "larkCommentId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'not_synced',
    "syncError" TEXT,
    "createdByUserId" TEXT,
    "deletedByUserId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectComment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "status" TEXT NOT NULL DEFAULT 'active',
    "syncStatus" TEXT NOT NULL DEFAULT 'not_synced',
    "syncError" TEXT,
    "createdByUserId" TEXT,
    "deletedByUserId" TEXT,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "fileObjectId" TEXT NOT NULL,
    "commentId" TEXT,
    "larkTaskGuid" TEXT,
    "larkAttachmentToken" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'not_synced',
    "syncError" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAttachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fileObjectId" TEXT NOT NULL,
    "commentId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'not_synced',
    "syncError" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskStatusHistory" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "TaskStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTimeEntry" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "workType" TEXT NOT NULL DEFAULT 'delivery',
    "approvalStatus" TEXT NOT NULL DEFAULT 'submitted',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAccessGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "projectId" TEXT,
    "scope" "ScopeType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalInvitation" (
    "id" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "invitedEmail" TEXT NOT NULL,
    "requestedEmail" TEXT,
    "requestedOpenId" TEXT,
    "requestedTenantKey" TEXT,
    "requestedName" TEXT,
    "accountId" TEXT,
    "projectId" TEXT,
    "scope" "ScopeType" NOT NULL,
    "roleCode" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "PortalInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT NOT NULL,
    "activatedUserId" TEXT,
    "reviewReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProgressShareLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "viewerEmail" TEXT,
    "viewerDomain" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "revokedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastAccessedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectProgressShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldPolicy" (
    "id" TEXT NOT NULL,
    "resource" "Resource" NOT NULL,
    "fieldName" TEXT NOT NULL,
    "sensitivity" "FieldSensitivity" NOT NULL,
    "allowedRoles" TEXT[],
    "projection" "ProjectionMode" NOT NULL DEFAULT 'OMIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyDecisionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "subjectType" "SubjectType" NOT NULL,
    "action" "Action" NOT NULL,
    "resource" "Resource" NOT NULL,
    "resourceId" TEXT,
    "decision" "DefaultDecision" NOT NULL,
    "reason" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEventLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "IntegrationEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "IntegrationEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PortalIdentity_tenantKey_idx" ON "PortalIdentity"("tenantKey");

-- CreateIndex
CREATE UNIQUE INDEX "PortalIdentity_provider_providerUserId_tenantKey_key" ON "PortalIdentity"("provider", "providerUserId", "tenantKey");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSession_tokenHash_key" ON "PortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalSession_userId_idx" ON "PortalSession"("userId");

-- CreateIndex
CREATE INDEX "PortalSession_tenantKey_idx" ON "PortalSession"("tenantKey");

-- CreateIndex
CREATE INDEX "PortalSession_expiresAt_idx" ON "PortalSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE INDEX "PermissionSet_resource_action_idx" ON "PermissionSet"("resource", "action");

-- CreateIndex
CREATE INDEX "RoleBinding_tenantKey_idx" ON "RoleBinding"("tenantKey");

-- CreateIndex
CREATE INDEX "RoleBinding_userId_roleId_idx" ON "RoleBinding"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleBinding_userId_roleId_tenantKey_key" ON "RoleBinding"("userId", "roleId", "tenantKey");

-- CreateIndex
CREATE UNIQUE INDEX "Team_code_key" ON "Team"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE INDEX "Account_stage_idx" ON "Account"("stage");

-- CreateIndex
CREATE INDEX "Account_ownerTeamId_idx" ON "Account"("ownerTeamId");

-- CreateIndex
CREATE INDEX "Account_picUserId_idx" ON "Account"("picUserId");

-- CreateIndex
CREATE INDEX "AccountMember_userId_idx" ON "AccountMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMember_accountId_userId_relation_key" ON "AccountMember"("accountId", "userId", "relation");

-- CreateIndex
CREATE INDEX "AccountUsageReview_accountId_month_idx" ON "AccountUsageReview"("accountId", "month");

-- CreateIndex
CREATE INDEX "AccountUsageReview_createdByUserId_idx" ON "AccountUsageReview"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_email_key" ON "Contact"("email");

-- CreateIndex
CREATE INDEX "Contact_accountId_idx" ON "Contact"("accountId");

-- CreateIndex
CREATE INDEX "Contact_name_idx" ON "Contact"("name");

-- CreateIndex
CREATE INDEX "Lead_accountId_status_idx" ON "Lead"("accountId", "status");

-- CreateIndex
CREATE INDEX "Lead_contactId_idx" ON "Lead"("contactId");

-- CreateIndex
CREATE INDEX "Lead_ownerUserId_idx" ON "Lead"("ownerUserId");

-- CreateIndex
CREATE INDEX "Lead_duplicateOfLeadId_idx" ON "Lead"("duplicateOfLeadId");

-- CreateIndex
CREATE INDEX "Lead_contactEmail_idx" ON "Lead"("contactEmail");

-- CreateIndex
CREATE INDEX "Opportunity_accountId_stage_idx" ON "Opportunity"("accountId", "stage");

-- CreateIndex
CREATE INDEX "Opportunity_leadId_idx" ON "Opportunity"("leadId");

-- CreateIndex
CREATE INDEX "Opportunity_ownerUserId_idx" ON "Opportunity"("ownerUserId");

-- CreateIndex
CREATE INDEX "Opportunity_forecastCategory_idx" ON "Opportunity"("forecastCategory");

-- CreateIndex
CREATE INDEX "Opportunity_stageEnteredAt_idx" ON "Opportunity"("stageEnteredAt");

-- CreateIndex
CREATE INDEX "Opportunity_closedAt_idx" ON "Opportunity"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_accountId_title_key" ON "Opportunity"("accountId", "title");

-- CreateIndex
CREATE INDEX "ProposalPackage_accountId_status_idx" ON "ProposalPackage"("accountId", "status");

-- CreateIndex
CREATE INDEX "ProposalPackage_opportunityId_status_idx" ON "ProposalPackage"("opportunityId", "status");

-- CreateIndex
CREATE INDEX "ProposalPackage_packageType_status_idx" ON "ProposalPackage"("packageType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalPackage_opportunityId_version_key" ON "ProposalPackage"("opportunityId", "version");

-- CreateIndex
CREATE INDEX "ProposalDocument_proposalPackageId_documentType_idx" ON "ProposalDocument"("proposalPackageId", "documentType");

-- CreateIndex
CREATE INDEX "ProposalDocument_customerVisible_idx" ON "ProposalDocument"("customerVisible");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalDocument_proposalPackageId_documentType_version_key" ON "ProposalDocument"("proposalPackageId", "documentType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DealApprovalRequest_larkApprovalInstanceCode_key" ON "DealApprovalRequest"("larkApprovalInstanceCode");

-- CreateIndex
CREATE INDEX "DealApprovalRequest_proposalPackageId_status_idx" ON "DealApprovalRequest"("proposalPackageId", "status");

-- CreateIndex
CREATE INDEX "DealApprovalRequest_opportunityId_status_idx" ON "DealApprovalRequest"("opportunityId", "status");

-- CreateIndex
CREATE INDEX "DealApprovalRequest_requestType_status_idx" ON "DealApprovalRequest"("requestType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DealApprovalRequest_proposalPackageId_requestType_requiredR_key" ON "DealApprovalRequest"("proposalPackageId", "requestType", "requiredRoleCode");

-- CreateIndex
CREATE INDEX "DealApprovalDecision_approvalRequestId_decidedAt_idx" ON "DealApprovalDecision"("approvalRequestId", "decidedAt");

-- CreateIndex
CREATE INDEX "DealApprovalDecision_decidedByUserId_idx" ON "DealApprovalDecision"("decidedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_code_key" ON "Contract"("code");

-- CreateIndex
CREATE INDEX "Contract_accountId_status_idx" ON "Contract"("accountId", "status");

-- CreateIndex
CREATE INDEX "Contract_opportunityId_idx" ON "Contract"("opportunityId");

-- CreateIndex
CREATE INDEX "Contract_projectId_idx" ON "Contract"("projectId");

-- CreateIndex
CREATE INDEX "Contract_proposalPackageId_idx" ON "Contract"("proposalPackageId");

-- CreateIndex
CREATE INDEX "Contract_signatureStatus_idx" ON "Contract"("signatureStatus");

-- CreateIndex
CREATE INDEX "Contract_customerVisible_idx" ON "Contract"("customerVisible");

-- CreateIndex
CREATE INDEX "ContractDocument_contractId_documentType_idx" ON "ContractDocument"("contractId", "documentType");

-- CreateIndex
CREATE INDEX "ContractDocument_customerVisible_idx" ON "ContractDocument"("customerVisible");

-- CreateIndex
CREATE UNIQUE INDEX "ContractDocument_contractId_documentType_version_key" ON "ContractDocument"("contractId", "documentType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSchedule_code_key" ON "PaymentSchedule"("code");

-- CreateIndex
CREATE INDEX "PaymentSchedule_accountId_status_idx" ON "PaymentSchedule"("accountId", "status");

-- CreateIndex
CREATE INDEX "PaymentSchedule_contractId_idx" ON "PaymentSchedule"("contractId");

-- CreateIndex
CREATE INDEX "PaymentSchedule_opportunityId_idx" ON "PaymentSchedule"("opportunityId");

-- CreateIndex
CREATE INDEX "PaymentSchedule_projectId_idx" ON "PaymentSchedule"("projectId");

-- CreateIndex
CREATE INDEX "PaymentSchedule_proposalPackageId_idx" ON "PaymentSchedule"("proposalPackageId");

-- CreateIndex
CREATE INDEX "PaymentSchedule_customerVisible_idx" ON "PaymentSchedule"("customerVisible");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMilestone_code_key" ON "PaymentMilestone"("code");

-- CreateIndex
CREATE INDEX "PaymentMilestone_accountId_status_idx" ON "PaymentMilestone"("accountId", "status");

-- CreateIndex
CREATE INDEX "PaymentMilestone_contractId_idx" ON "PaymentMilestone"("contractId");

-- CreateIndex
CREATE INDEX "PaymentMilestone_projectId_idx" ON "PaymentMilestone"("projectId");

-- CreateIndex
CREATE INDEX "PaymentMilestone_dueAt_idx" ON "PaymentMilestone"("dueAt");

-- CreateIndex
CREATE INDEX "PaymentMilestone_paymentStatus_idx" ON "PaymentMilestone"("paymentStatus");

-- CreateIndex
CREATE INDEX "PaymentMilestone_customerVisible_idx" ON "PaymentMilestone"("customerVisible");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMilestone_scheduleId_sequence_key" ON "PaymentMilestone"("scheduleId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_code_key" ON "Invoice"("code");

-- CreateIndex
CREATE INDEX "Invoice_milestoneId_status_idx" ON "Invoice"("milestoneId", "status");

-- CreateIndex
CREATE INDEX "Invoice_accountId_paymentStatus_idx" ON "Invoice"("accountId", "paymentStatus");

-- CreateIndex
CREATE INDEX "Invoice_contractId_idx" ON "Invoice"("contractId");

-- CreateIndex
CREATE INDEX "Invoice_projectId_idx" ON "Invoice"("projectId");

-- CreateIndex
CREATE INDEX "Invoice_dueAt_idx" ON "Invoice"("dueAt");

-- CreateIndex
CREATE INDEX "Invoice_customerVisible_idx" ON "Invoice"("customerVisible");

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_paidAt_idx" ON "InvoicePayment"("invoiceId", "paidAt");

-- CreateIndex
CREATE INDEX "InvoicePayment_milestoneId_idx" ON "InvoicePayment"("milestoneId");

-- CreateIndex
CREATE INDEX "InvoicePayment_accountId_paidAt_idx" ON "InvoicePayment"("accountId", "paidAt");

-- CreateIndex
CREATE INDEX "InvoicePayment_projectId_paidAt_idx" ON "InvoicePayment"("projectId", "paidAt");

-- CreateIndex
CREATE INDEX "InvoicePayment_createdByUserId_idx" ON "InvoicePayment"("createdByUserId");

-- CreateIndex
CREATE INDEX "ArFollowUp_milestoneId_status_idx" ON "ArFollowUp"("milestoneId", "status");

-- CreateIndex
CREATE INDEX "ArFollowUp_invoiceId_status_idx" ON "ArFollowUp"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "ArFollowUp_accountId_status_idx" ON "ArFollowUp"("accountId", "status");

-- CreateIndex
CREATE INDEX "ArFollowUp_ownerUserId_status_idx" ON "ArFollowUp"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "ArFollowUp_nextActionAt_idx" ON "ArFollowUp"("nextActionAt");

-- CreateIndex
CREATE INDEX "PaymentEvidence_milestoneId_evidenceType_idx" ON "PaymentEvidence"("milestoneId", "evidenceType");

-- CreateIndex
CREATE INDEX "PaymentEvidence_invoiceId_evidenceType_idx" ON "PaymentEvidence"("invoiceId", "evidenceType");

-- CreateIndex
CREATE INDEX "PaymentEvidence_accountId_evidenceType_idx" ON "PaymentEvidence"("accountId", "evidenceType");

-- CreateIndex
CREATE INDEX "PaymentEvidence_customerVisible_idx" ON "PaymentEvidence"("customerVisible");

-- CreateIndex
CREATE INDEX "OpportunityActivity_opportunityId_status_idx" ON "OpportunityActivity"("opportunityId", "status");

-- CreateIndex
CREATE INDEX "OpportunityActivity_accountId_createdAt_idx" ON "OpportunityActivity"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "OpportunityActivity_createdByUserId_idx" ON "OpportunityActivity"("createdByUserId");

-- CreateIndex
CREATE INDEX "OpportunityStageHistory_opportunityId_changedAt_idx" ON "OpportunityStageHistory"("opportunityId", "changedAt");

-- CreateIndex
CREATE INDEX "OpportunityStageHistory_accountId_changedAt_idx" ON "OpportunityStageHistory"("accountId", "changedAt");

-- CreateIndex
CREATE INDEX "OpportunityStageHistory_changedByUserId_idx" ON "OpportunityStageHistory"("changedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_accountId_status_idx" ON "Project"("accountId", "status");

-- CreateIndex
CREATE INDEX "Project_opportunityId_idx" ON "Project"("opportunityId");

-- CreateIndex
CREATE INDEX "ProjectStage_accountId_status_idx" ON "ProjectStage"("accountId", "status");

-- CreateIndex
CREATE INDEX "ProjectStage_projectId_sortOrder_idx" ON "ProjectStage"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProjectStage_ownerUserId_status_idx" ON "ProjectStage"("ownerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectStage_projectId_stageKey_key" ON "ProjectStage"("projectId", "stageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceProfile_userId_key" ON "ResourceProfile"("userId");

-- CreateIndex
CREATE INDEX "ResourceProfile_active_idx" ON "ResourceProfile"("active");

-- CreateIndex
CREATE INDEX "ResourceCapacityPeriod_periodStart_periodEnd_idx" ON "ResourceCapacityPeriod"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceCapacityPeriod_userId_periodStart_periodEnd_key" ON "ResourceCapacityPeriod"("userId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ResourceAllocation_accountId_status_idx" ON "ResourceAllocation"("accountId", "status");

-- CreateIndex
CREATE INDEX "ResourceAllocation_projectId_status_idx" ON "ResourceAllocation"("projectId", "status");

-- CreateIndex
CREATE INDEX "ResourceAllocation_opportunityId_idx" ON "ResourceAllocation"("opportunityId");

-- CreateIndex
CREATE INDEX "ResourceAllocation_userId_status_idx" ON "ResourceAllocation"("userId", "status");

-- CreateIndex
CREATE INDEX "ResourceAllocation_startAt_endAt_idx" ON "ResourceAllocation"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "ResourceAllocation_approvedByUserId_idx" ON "ResourceAllocation"("approvedByUserId");

-- CreateIndex
CREATE INDEX "CostRateProfile_userId_active_idx" ON "CostRateProfile"("userId", "active");

-- CreateIndex
CREATE INDEX "CostRateProfile_role_active_idx" ON "CostRateProfile"("role", "active");

-- CreateIndex
CREATE INDEX "CostRateProfile_effectiveFrom_effectiveTo_idx" ON "CostRateProfile"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBudget_code_key" ON "ProjectBudget"("code");

-- CreateIndex
CREATE INDEX "ProjectBudget_accountId_status_idx" ON "ProjectBudget"("accountId", "status");

-- CreateIndex
CREATE INDEX "ProjectBudget_projectId_status_idx" ON "ProjectBudget"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectCost_accountId_occurredAt_idx" ON "ProjectCost"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectCost_projectId_occurredAt_idx" ON "ProjectCost"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProjectCost_taskTimeEntryId_idx" ON "ProjectCost"("taskTimeEntryId");

-- CreateIndex
CREATE INDEX "ProjectCost_costType_idx" ON "ProjectCost"("costType");

-- CreateIndex
CREATE INDEX "ProjectPlSnapshot_accountId_periodStart_periodEnd_idx" ON "ProjectPlSnapshot"("accountId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ProjectPlSnapshot_projectId_periodStart_periodEnd_idx" ON "ProjectPlSnapshot"("projectId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ProjectPlSnapshot_status_idx" ON "ProjectPlSnapshot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_code_key" ON "Ticket"("code");

-- CreateIndex
CREATE INDEX "Ticket_accountId_status_idx" ON "Ticket"("accountId", "status");

-- CreateIndex
CREATE INDEX "Ticket_projectId_idx" ON "Ticket"("projectId");

-- CreateIndex
CREATE INDEX "Ticket_requesterUserId_idx" ON "Ticket"("requesterUserId");

-- CreateIndex
CREATE INDEX "Ticket_category_priority_idx" ON "Ticket"("category", "priority");

-- CreateIndex
CREATE INDEX "Ticket_ownerQueue_status_idx" ON "Ticket"("ownerQueue", "status");

-- CreateIndex
CREATE INDEX "Ticket_firstResponseDueAt_idx" ON "Ticket"("firstResponseDueAt");

-- CreateIndex
CREATE INDEX "Ticket_resolutionDueAt_idx" ON "Ticket"("resolutionDueAt");

-- CreateIndex
CREATE INDEX "TicketStatusHistory_ticketId_createdAt_idx" ON "TicketStatusHistory"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketStatusHistory_accountId_createdAt_idx" ON "TicketStatusHistory"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketStatusHistory_projectId_idx" ON "TicketStatusHistory"("projectId");

-- CreateIndex
CREATE INDEX "TicketStatusHistory_toStatus_idx" ON "TicketStatusHistory"("toStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectArtifact_code_key" ON "ProjectArtifact"("code");

-- CreateIndex
CREATE INDEX "ProjectArtifact_accountId_artifactType_idx" ON "ProjectArtifact"("accountId", "artifactType");

-- CreateIndex
CREATE INDEX "ProjectArtifact_projectId_idx" ON "ProjectArtifact"("projectId");

-- CreateIndex
CREATE INDEX "ProjectArtifact_customerVisible_idx" ON "ProjectArtifact"("customerVisible");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE INDEX "FileObject_accountId_status_idx" ON "FileObject"("accountId", "status");

-- CreateIndex
CREATE INDEX "FileObject_projectId_status_idx" ON "FileObject"("projectId", "status");

-- CreateIndex
CREATE INDEX "FileObject_ownerType_ownerId_idx" ON "FileObject"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "FileObject_customerVisible_idx" ON "FileObject"("customerVisible");

-- CreateIndex
CREATE INDEX "FileObject_scanStatus_idx" ON "FileObject"("scanStatus");

-- CreateIndex
CREATE UNIQUE INDEX "FileDownloadGrant_tokenHash_key" ON "FileDownloadGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "FileDownloadGrant_fileObjectId_expiresAt_idx" ON "FileDownloadGrant"("fileObjectId", "expiresAt");

-- CreateIndex
CREATE INDEX "FileDownloadGrant_accountId_expiresAt_idx" ON "FileDownloadGrant"("accountId", "expiresAt");

-- CreateIndex
CREATE INDEX "FileDownloadGrant_projectId_expiresAt_idx" ON "FileDownloadGrant"("projectId", "expiresAt");

-- CreateIndex
CREATE INDEX "FileDownloadGrant_revokedAt_idx" ON "FileDownloadGrant"("revokedAt");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_relation_key" ON "ProjectMember"("projectId", "userId", "relation");

-- CreateIndex
CREATE INDEX "ProjectTask_accountId_status_idx" ON "ProjectTask"("accountId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_projectId_status_idx" ON "ProjectTask"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_stageId_status_idx" ON "ProjectTask"("stageId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_opportunityId_idx" ON "ProjectTask"("opportunityId");

-- CreateIndex
CREATE INDEX "ProjectTask_ticketId_idx" ON "ProjectTask"("ticketId");

-- CreateIndex
CREATE INDEX "ProjectTask_parentTaskId_idx" ON "ProjectTask"("parentTaskId");

-- CreateIndex
CREATE INDEX "ProjectTask_assigneeUserId_status_idx" ON "ProjectTask"("assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_ownerUserId_status_idx" ON "ProjectTask"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_ownerTeamId_status_idx" ON "ProjectTask"("ownerTeamId", "status");

-- CreateIndex
CREATE INDEX "ProjectTask_dueAt_idx" ON "ProjectTask"("dueAt");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskComment_accountId_createdAt_idx" ON "TaskComment"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskComment_projectId_createdAt_idx" ON "TaskComment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskComment_visibility_idx" ON "TaskComment"("visibility");

-- CreateIndex
CREATE INDEX "TaskComment_status_idx" ON "TaskComment"("status");

-- CreateIndex
CREATE INDEX "ProjectComment_projectId_createdAt_idx" ON "ProjectComment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectComment_accountId_createdAt_idx" ON "ProjectComment"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectComment_visibility_idx" ON "ProjectComment"("visibility");

-- CreateIndex
CREATE INDEX "ProjectComment_status_idx" ON "ProjectComment"("status");

-- CreateIndex
CREATE INDEX "TaskAttachment_taskId_createdAt_idx" ON "TaskAttachment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskAttachment_fileObjectId_idx" ON "TaskAttachment"("fileObjectId");

-- CreateIndex
CREATE INDEX "TaskAttachment_commentId_idx" ON "TaskAttachment"("commentId");

-- CreateIndex
CREATE INDEX "TaskAttachment_accountId_createdAt_idx" ON "TaskAttachment"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskAttachment_projectId_createdAt_idx" ON "TaskAttachment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectAttachment_projectId_createdAt_idx" ON "ProjectAttachment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectAttachment_fileObjectId_idx" ON "ProjectAttachment"("fileObjectId");

-- CreateIndex
CREATE INDEX "ProjectAttachment_commentId_idx" ON "ProjectAttachment"("commentId");

-- CreateIndex
CREATE INDEX "ProjectAttachment_accountId_createdAt_idx" ON "ProjectAttachment"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskStatusHistory_taskId_changedAt_idx" ON "TaskStatusHistory"("taskId", "changedAt");

-- CreateIndex
CREATE INDEX "TaskStatusHistory_accountId_changedAt_idx" ON "TaskStatusHistory"("accountId", "changedAt");

-- CreateIndex
CREATE INDEX "TaskStatusHistory_projectId_changedAt_idx" ON "TaskStatusHistory"("projectId", "changedAt");

-- CreateIndex
CREATE INDEX "TaskStatusHistory_changedByUserId_idx" ON "TaskStatusHistory"("changedByUserId");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_taskId_workDate_idx" ON "TaskTimeEntry"("taskId", "workDate");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_accountId_workDate_idx" ON "TaskTimeEntry"("accountId", "workDate");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_projectId_workDate_idx" ON "TaskTimeEntry"("projectId", "workDate");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_userId_workDate_idx" ON "TaskTimeEntry"("userId", "workDate");

-- CreateIndex
CREATE INDEX "TaskTimeEntry_approvalStatus_idx" ON "TaskTimeEntry"("approvalStatus");

-- CreateIndex
CREATE INDEX "CustomerAccessGrant_userId_accountId_idx" ON "CustomerAccessGrant"("userId", "accountId");

-- CreateIndex
CREATE INDEX "CustomerAccessGrant_userId_projectId_idx" ON "CustomerAccessGrant"("userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalInvitation_tokenHash_key" ON "PortalInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "PortalInvitation_tenantKey_invitedEmail_idx" ON "PortalInvitation"("tenantKey", "invitedEmail");

-- CreateIndex
CREATE INDEX "PortalInvitation_status_expiresAt_idx" ON "PortalInvitation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PortalInvitation_accountId_idx" ON "PortalInvitation"("accountId");

-- CreateIndex
CREATE INDEX "PortalInvitation_projectId_idx" ON "PortalInvitation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectProgressShareLink_tokenHash_key" ON "ProjectProgressShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ProjectProgressShareLink_accountId_idx" ON "ProjectProgressShareLink"("accountId");

-- CreateIndex
CREATE INDEX "ProjectProgressShareLink_projectId_expiresAt_idx" ON "ProjectProgressShareLink"("projectId", "expiresAt");

-- CreateIndex
CREATE INDEX "ProjectProgressShareLink_createdByUserId_idx" ON "ProjectProgressShareLink"("createdByUserId");

-- CreateIndex
CREATE INDEX "ProjectProgressShareLink_revokedAt_idx" ON "ProjectProgressShareLink"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FieldPolicy_resource_fieldName_key" ON "FieldPolicy"("resource", "fieldName");

-- CreateIndex
CREATE INDEX "PolicyDecisionLog_requestId_idx" ON "PolicyDecisionLog"("requestId");

-- CreateIndex
CREATE INDEX "PolicyDecisionLog_resource_action_decision_idx" ON "PolicyDecisionLog"("resource", "action", "decision");

-- CreateIndex
CREATE INDEX "PolicyDecisionLog_createdAt_idx" ON "PolicyDecisionLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEventLog_idempotencyKey_key" ON "IntegrationEventLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IntegrationEventLog_eventType_status_idx" ON "IntegrationEventLog"("eventType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEventLog_provider_externalEventId_key" ON "IntegrationEventLog"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "AuditEvent_resource_resourceId_idx" ON "AuditEvent"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");

-- AddForeignKey
ALTER TABLE "PortalIdentity" ADD CONSTRAINT "PortalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionSet" ADD CONSTRAINT "PermissionSet_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_picUserId_fkey" FOREIGN KEY ("picUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMember" ADD CONSTRAINT "AccountMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMember" ADD CONSTRAINT "AccountMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountUsageReview" ADD CONSTRAINT "AccountUsageReview_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountUsageReview" ADD CONSTRAINT "AccountUsageReview_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_duplicateOfLeadId_fkey" FOREIGN KEY ("duplicateOfLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalPackage" ADD CONSTRAINT "ProposalPackage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalPackage" ADD CONSTRAINT "ProposalPackage_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalDocument" ADD CONSTRAINT "ProposalDocument_proposalPackageId_fkey" FOREIGN KEY ("proposalPackageId") REFERENCES "ProposalPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealApprovalRequest" ADD CONSTRAINT "DealApprovalRequest_proposalPackageId_fkey" FOREIGN KEY ("proposalPackageId") REFERENCES "ProposalPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealApprovalDecision" ADD CONSTRAINT "DealApprovalDecision_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "DealApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_proposalPackageId_fkey" FOREIGN KEY ("proposalPackageId") REFERENCES "ProposalPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractDocument" ADD CONSTRAINT "ContractDocument_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_proposalPackageId_fkey" FOREIGN KEY ("proposalPackageId") REFERENCES "ProposalPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSchedule" ADD CONSTRAINT "PaymentSchedule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "PaymentSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_financeOwnerUserId_fkey" FOREIGN KEY ("financeOwnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_overdueOwnerUserId_fkey" FOREIGN KEY ("overdueOwnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMilestone" ADD CONSTRAINT "PaymentMilestone_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "PaymentMilestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "PaymentMilestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArFollowUp" ADD CONSTRAINT "ArFollowUp_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "PaymentMilestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArFollowUp" ADD CONSTRAINT "ArFollowUp_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArFollowUp" ADD CONSTRAINT "ArFollowUp_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArFollowUp" ADD CONSTRAINT "ArFollowUp_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArFollowUp" ADD CONSTRAINT "ArFollowUp_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "PaymentMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityStageHistory" ADD CONSTRAINT "OpportunityStageHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceProfile" ADD CONSTRAINT "ResourceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceCapacityPeriod" ADD CONSTRAINT "ResourceCapacityPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAllocation" ADD CONSTRAINT "ResourceAllocation_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRateProfile" ADD CONSTRAINT "CostRateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudget" ADD CONSTRAINT "ProjectBudget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudget" ADD CONSTRAINT "ProjectBudget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudget" ADD CONSTRAINT "ProjectBudget_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_taskTimeEntryId_fkey" FOREIGN KEY ("taskTimeEntryId") REFERENCES "TaskTimeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCost" ADD CONSTRAINT "ProjectCost_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPlSnapshot" ADD CONSTRAINT "ProjectPlSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPlSnapshot" ADD CONSTRAINT "ProjectPlSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPlSnapshot" ADD CONSTRAINT "ProjectPlSnapshot_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusHistory" ADD CONSTRAINT "TicketStatusHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusHistory" ADD CONSTRAINT "TicketStatusHistory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusHistory" ADD CONSTRAINT "TicketStatusHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusHistory" ADD CONSTRAINT "TicketStatusHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectArtifact" ADD CONSTRAINT "ProjectArtifact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectArtifact" ADD CONSTRAINT "ProjectArtifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileDownloadGrant" ADD CONSTRAINT "FileDownloadGrant_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileDownloadGrant" ADD CONSTRAINT "FileDownloadGrant_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "ProjectStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "ProjectTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "TaskComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "ProjectComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TaskComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ProjectComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskStatusHistory" ADD CONSTRAINT "TaskStatusHistory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskStatusHistory" ADD CONSTRAINT "TaskStatusHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProjectTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAccessGrant" ADD CONSTRAINT "CustomerAccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAccessGrant" ADD CONSTRAINT "CustomerAccessGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAccessGrant" ADD CONSTRAINT "CustomerAccessGrant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressShareLink" ADD CONSTRAINT "ProjectProgressShareLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressShareLink" ADD CONSTRAINT "ProjectProgressShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressShareLink" ADD CONSTRAINT "ProjectProgressShareLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProgressShareLink" ADD CONSTRAINT "ProjectProgressShareLink_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecisionLog" ADD CONSTRAINT "PolicyDecisionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
