import type { ArAgingSummaryItem, LeadSummary, OpportunitySummary, PaymentScheduleDetail, SalesOwnerSummary } from "@b2b-crm/contracts";

export type DraftOpportunity = {
  title: string;
  leadId: string;
  ownerUserId: string;
  stageEnteredAt: string;
  stage: string;
  amount: string;
  probability: string;
  nextActivitySubject: string;
  nextActivityAt: string;
};

export type ActivityDraft = {
  type: string;
  subject: string;
  note: string;
  dueAt: string;
  delayReason: string;
};

export type LeadDraft = {
  accountId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  source: string;
  painPoint: string;
  serviceFit: string;
  timeline: string;
  budgetRange: string;
  authority: string;
  qualificationSummary: string;
  nextActivityAt: string;
  allowDuplicate: boolean;
};

export type OpportunityCreateDraft = {
  leadId: string;
  accountId: string;
  title: string;
  amount: string;
  stage: string;
  nextActivitySubject: string;
  nextActivityAt: string;
};

export type DisqualifyDraft = {
  leadId: string;
  reason: string;
  note: string;
};

export type CloseDraft = {
  outcome: "won" | "lost";
  wonReason: string;
  lostReason: string;
  commercialScope: boolean;
  signedSow: boolean;
  kickoffOwner: boolean;
  billingReady: boolean;
};

export type HandoffDraft = {
  projectCode: string;
  projectName: string;
  kickoffOwnerUserId: string;
  kickoffAt: string;
  deploymentStatus: string;
  note: string;
  commercialScope: boolean;
  signedSow: boolean;
  kickoffOwner: boolean;
  billingReady: boolean;
  deliveryOwner: boolean;
  kickoffScheduled: boolean;
  createStageTaskTemplate: boolean;
};

export type FinanceMilestoneDraft = {
  scheduleId: string;
  label: string;
  amount: string;
  dueAt: string;
  customerVisible: boolean;
};

export type PaymentEvidenceDraft = {
  milestoneId: string;
  invoiceId: string;
  evidenceType: string;
  title: string;
  externalUrl: string;
  customerVisible: boolean;
};

export type OpportunityWorkbenchState = {
  activities: import("@b2b-crm/contracts").OpportunityActivitySummary[];
  activityDraft: ActivityDraft;
  activityOpen: boolean;
  closeDraft: CloseDraft;
  detailOpen: boolean;
  draft: DraftOpportunity;
  financeMilestoneDraft: FinanceMilestoneDraft;
  handoffDraft: HandoffDraft;
  handoffModalOpen: boolean;
  isEditing: boolean;
  financeLoading: boolean;
  financeOpen: boolean;
  loading: boolean;
  message: string;
  leads: LeadSummary[];
  opportunities: OpportunitySummary[];
  arAging: ArAgingSummaryItem[];
  paymentSchedules: PaymentScheduleDetail[];
  paymentEvidenceDraft: PaymentEvidenceDraft;
  pipelineStats: ReturnType<typeof import("./utils").getPipelineStats>;
  salesOwners: SalesOwnerSummary[];
  selected: OpportunitySummary | null;
};
