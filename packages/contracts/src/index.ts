export type SubjectType = "internal_user" | "portal_user" | "service_account";

export type Action =
  | "list"
  | "read"
  | "create"
  | "update"
  | "approve"
  | "export"
  | "download"
  | "delete";

export type Resource =
  | "account"
  | "opportunity"
  | "proposal"
  | "project"
  | "task"
  | "contract"
  | "payment"
  | "capacity"
  | "dashboard"
  | "integration_event"
  | "policy_decision"
  | "ticket"
  | "artifact";

export type PolicyDecision = "allow" | "deny" | "allow_with_projection";

export type FieldSensitivity = "public" | "internal" | "commercial" | "financial" | "confidential";

export interface PrincipalContext {
  subjectType: SubjectType;
  subjectId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  tenantKey: string;
  workspaceId: string;
  workspaceKey: string;
  roleCodes: string[];
  accountIds: string[];
  projectIds: string[];
  customerAccountIds: string[];
  customerProjectIds: string[];
  roleVersion: string;
  grantVersion: string;
}

export interface PolicyCheck {
  action: Action;
  resource: Resource;
  resourceId?: string;
  accountId?: string;
  projectId?: string;
  customerVisible?: boolean;
  allowedRoles?: string[];
}

export interface PolicyDecisionResult {
  decision: PolicyDecision;
  reason: string;
  projectionFields?: string[];
}

export interface SalesOwnerSummary {
  id: string;
  displayName: string;
  email: string;
  roleCodes: string[];
}

export type SalesTargetPeriod = "all" | "month" | "quarter" | "year";
export type SalesTargetScopeType = "company" | "owner" | "team";

export interface SalesTargetSummary {
  id: string;
  period: SalesTargetPeriod;
  scopeType: SalesTargetScopeType;
  amount: number;
  currency: "VND";
  ownerUserId?: string;
  ownerDisplayName?: string;
  ownerTeamId?: string;
  ownerTeamName?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  source: "config" | "env";
}

export interface SalesTargetsResponse {
  data: SalesTargetSummary[];
  meta: {
    principal: string;
    rowScope: string;
    generatedAt: string;
    source: "config";
  };
}

export interface AccountSummary {
  id: string;
  code: string;
  name: string;
  stage: string;
  ownerTeam: string;
  picUserId?: string;
  picName?: string;
  picEmail?: string;
  picAvatarUrl?: string;
  health: "green" | "amber" | "red";
  annualValue?: number;
  commercialNote?: string;
}

export interface CreateAccountInput {
  code: string;
  name: string;
  stage?: string;
  ownerTeamId?: string;
  picUserId?: string;
  annualValue?: number;
  commercialNote?: string;
}

export interface UpdateAccountInput {
  name?: string;
  stage?: string;
  ownerTeamId?: string | null;
  picUserId?: string | null;
  annualValue?: number;
  commercialNote?: string | null;
}

export interface AccountsResponse {
  data: AccountSummary[];
  meta: {
    principal: string;
    rowScope: string;
    hiddenFields: string[];
    pagination?: ResourceListPaginationMeta;
  };
}

export interface OpportunitySummary {
  id: string;
  accountId: string;
  leadId?: string;
  ownerUserId?: string;
  ownerDisplayName?: string;
  accountName: string;
  title: string;
  stage: string;
  amount?: number;
  probability: number;
  forecastCategory: string;
  weightedForecast?: number;
  stageEnteredAt: string;
  stageAgeDays: number;
  stale: boolean;
  staleReason?: string;
  nextActivityAt?: string;
  closedAt?: string;
  closeReason?: string;
  handoffConfirmedAt?: string;
  stageHistory?: OpportunityStageHistorySummary[];
}

export interface OpportunityStageHistorySummary {
  id: string;
  opportunityId: string;
  accountId: string;
  fromStage?: string;
  toStage: string;
  probability: number;
  amount?: number;
  forecastCategory: string;
  changedByUserId?: string;
  changedByUserDisplayName?: string;
  changedByUserEmail?: string;
  changedAt: string;
  reason?: string;
}

export interface OpportunityActivitySummary {
  id: string;
  opportunityId: string;
  accountId: string;
  type: string;
  subject: string;
  note?: string;
  dueAt?: string;
  status: string;
  createdAt: string;
}

export interface UpdateOpportunityInput {
  title?: string;
  leadId?: string | null;
  ownerUserId?: string;
  stage?: string;
  stageEnteredAt?: string;
  amount?: number;
  probability?: number;
  nextActivitySubject?: string;
  nextActivityAt?: string;
}

export interface ContactSummary {
  id: string;
  accountId: string;
  accountName: string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  influence?: string;
  createdAt: string;
}

export interface CreateAccountContactInput {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  influence?: string;
}

export interface UpdateAccountContactInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  influence?: string | null;
}

export interface AccountUsageReviewSummary {
  id: string;
  accountId: string;
  month: string;
  dataSource: string;
  confidence: string;
  metricsAvailable: boolean;
  unavailabilityReason?: string;
  licensedUsers?: number;
  activeUsersMau?: number;
  adoptionRate?: number;
  weeklyActivityWeeks?: number;
  docsUsage?: number;
  baseUsage?: number;
  taskUsage?: number;
  workflowUsage?: number;
  ticketCount?: number;
  slaBreaches?: number;
  csat?: number;
  trainingAttendance?: number;
  healthScore: string;
  interpretation?: string;
  expansionSignal: string;
  nextAction: string;
  nextReviewDate?: string;
  owner: string;
  escalationOwner?: string;
  escalationNote?: string;
  createdByUserId?: string;
  createdAt: string;
}

export interface CreateAccountUsageReviewInput {
  month: string;
  dataSource: string;
  confidence: string;
  metricsAvailable: boolean;
  unavailabilityReason?: string;
  licensedUsers?: number;
  activeUsersMau?: number;
  adoptionRate?: number;
  weeklyActivityWeeks?: number;
  docsUsage?: number;
  baseUsage?: number;
  taskUsage?: number;
  workflowUsage?: number;
  ticketCount?: number;
  slaBreaches?: number;
  csat?: number;
  trainingAttendance?: number;
  healthScore: string;
  interpretation?: string;
  expansionSignal: string;
  nextAction: string;
  nextReviewDate?: string;
  owner: string;
  escalationOwner?: string;
  escalationNote?: string;
}

export interface LeadSummary {
  id: string;
  accountId: string;
  accountName: string;
  contactId?: string;
  companyName: string;
  contactName: string;
  contactEmail?: string;
  source: string;
  painPoint?: string;
  serviceFit?: string;
  timeline?: string;
  budgetRange?: string;
  authority?: string;
  status: string;
  duplicateOfLeadId?: string;
  duplicateReason?: string;
  qualificationSummary?: string;
  nextActivityAt?: string;
  createdAt: string;
}

export interface LeadDuplicateCandidate {
  type: "account" | "contact" | "lead";
  id: string;
  label: string;
  reason: string;
}

export const SALES_LOST_REASONS = [
  { code: "price_or_budget", label: "Chưa khớp ngân sách" },
  { code: "no_decision_authority", label: "Chưa có người quyết định" },
  { code: "timing_not_ready", label: "Chưa đúng thời điểm" },
  { code: "competitor_selected", label: "Đã chọn đối thủ" },
  { code: "scope_not_fit", label: "Phạm vi chưa phù hợp" },
  { code: "unresponsive", label: "Khách hàng không phản hồi" },
  { code: "internal_priority_shift", label: "Ưu tiên nội bộ thay đổi" },
  { code: "duplicate_or_invalid", label: "Trùng hoặc không hợp lệ" }
] as const;

export const SALES_WON_REASONS = [
  { code: "decision_confirmed", label: "Khách hàng đã xác nhận" },
  { code: "sow_signed", label: "SOW đã ký" },
  { code: "budget_approved", label: "Ngân sách đã duyệt" },
  { code: "commercial_fit", label: "Phù hợp nhu cầu" },
  { code: "strategic_account", label: "Tài khoản chiến lược" }
] as const;

export const SALES_DELAY_REASONS = [
  { code: "waiting_customer", label: "Waiting customer" },
  { code: "waiting_internal", label: "Waiting internal" },
  { code: "proposal_revision", label: "Proposal revision" },
  { code: "legal_or_procurement", label: "Legal or procurement" },
  { code: "resource_capacity", label: "Resource capacity" },
  { code: "technical_unknown", label: "Technical unknown" },
  { code: "payment_or_commercial", label: "Payment or commercial" }
] as const;

export const DEPLOYMENT_KICKOFF_STATUSES = [
  { code: "handoff_pending", label: "Handoff pending" },
  { code: "kickoff", label: "Kickoff" },
  { code: "analyst", label: "Analyst" },
  { code: "standard", label: "Standard" },
  { code: "proposal", label: "Proposal" },
  { code: "transform_build_up", label: "Transform / Build Up" },
  { code: "prototype", label: "Prototype" },
  { code: "pilot", label: "Pilot" },
  { code: "onboarding", label: "Onboarding" },
  { code: "acceptance", label: "Acceptance" }
] as const;

export type SalesLostReasonCode = (typeof SALES_LOST_REASONS)[number]["code"];
export type SalesWonReasonCode = (typeof SALES_WON_REASONS)[number]["code"];
export type SalesDelayReasonCode = (typeof SALES_DELAY_REASONS)[number]["code"];
export type DeploymentKickoffStatusCode = (typeof DEPLOYMENT_KICKOFF_STATUSES)[number]["code"];

export interface SalesTaxonomyResponse {
  lostReasons: Array<{ code: SalesLostReasonCode; label: string }>;
  delayReasons: Array<{ code: SalesDelayReasonCode; label: string }>;
  deploymentStatuses: Array<{ code: DeploymentKickoffStatusCode; label: string }>;
}

export interface CreateLeadInput {
  accountId: string;
  companyName: string;
  contactName: string;
  contactEmail?: string;
  phone?: string;
  role?: string;
  source: string;
  painPoint?: string;
  serviceFit?: string;
  timeline?: string;
  budgetRange?: string;
  authority?: string;
  qualificationSummary?: string;
  nextActivityAt?: string;
  allowDuplicate?: boolean;
}

export interface CreateLeadResponse {
  data: LeadSummary;
  duplicateCandidates: LeadDuplicateCandidate[];
}

export interface DisqualifyLeadInput {
  reason: SalesLostReasonCode;
  note?: string;
}

export interface CreateOpportunityInput {
  accountId: string;
  leadId?: string;
  title: string;
  amount?: number;
  stage?: string;
  probability?: number;
  nextActivitySubject?: string;
  nextActivityAt?: string;
}

export interface CloseOpportunityInput {
  outcome: "won" | "lost";
  wonReason?: SalesWonReasonCode;
  lostReason?: SalesLostReasonCode;
  handoffChecklist?: {
    commercialScope: boolean;
    signedSow: boolean;
    kickoffOwner: boolean;
    billingReady: boolean;
  };
}

export interface ProcessMetricLevel {
  level: "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7" | "L8";
  label: string;
  count: number;
  value?: number;
  staleCount: number;
  conversionFromPrevious?: number;
}

export interface ProcessMetricsResponse {
  data: ProcessMetricLevel[];
  meta: {
    principal: string;
    rowScope: string;
    generatedAt: string;
    source: "postgresql";
  };
}

export interface CreateOpportunityActivityInput {
  type: string;
  subject: string;
  note?: string;
  dueAt?: string;
  status?: string;
  delayReason?: SalesDelayReasonCode;
}

export interface ProjectSummary {
  id: string;
  accountId: string;
  accountName: string;
  opportunityId?: string;
  opportunityTitle?: string;
  opportunityStage?: string;
  code: string;
  name: string;
  status: string;
  projectType?: string;
  scopeSummary?: string;
  marginPercent?: number;
  priority?: ProjectPriority;
  tags?: string[];
  color?: string;
  ownerUserId?: string;
  ownerDisplayName?: string;
  ownerAvatarUrl?: string;
  memberUserIds?: string[];
  members?: ProjectMemberSummary[];
  budgetAmount?: number;
  spentAmount?: number;
  budgetCurrency?: string;
  progressPercent?: number;
  taskCount?: number;
  completedTaskCount?: number;
  plannedMinutes?: number;
  loggedMinutes?: number;
  approvedMinutes?: number;
  stageCount?: number;
  activeStageCount?: number;
  plannedStartAt?: string;
  plannedEndAt?: string;
  hierarchyOrderVersion: number;
  milestoneMode?: ProjectMilestoneMode;
  milestoneTemplateKey?: string;
}

export type ProjectPriority = "critical" | "high" | "medium" | "low";

export interface ProjectMemberSummary {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  relation: string;
  assignedTaskCount?: number;
  doneTaskCount?: number;
  doneTaskPercent?: number;
}

export interface CreateProjectInput {
  accountId: string;
  opportunityId?: string;
  code?: string;
  name: string;
  status?: string;
  projectType?: string;
  marginPercent?: number;
  priority?: ProjectPriority;
  tags?: string[];
  color?: string;
  ownerUserId?: string;
  memberUserIds?: string[];
  budgetAmount?: number;
  plannedStartAt?: string;
  plannedEndAt?: string;
  scopeSummary?: string;
  acceptanceCriteria?: string;
  createStageTemplate?: boolean;
  /** How the delivery hierarchy is provisioned for a new project. */
  milestoneMode?: ProjectMilestoneMode;
  /** Standard template key used when milestoneMode is auto. */
  milestoneTemplateKey?: string;
  /** Custom milestone/stage structure used when milestoneMode is manual. */
  manualMilestones?: CreateProjectMilestoneInput[];
}

export type ProjectMilestoneMode = "manual" | "auto";

export interface ProjectMilestoneConditionInput {
  requiredDocumentCount?: number;
  requiredDocumentTypes?: string[];
  unlockCriteria?: string;
  customerConfirmationRequired?: boolean;
  reviewerRole?: string;
}

export interface CreateProjectMilestoneInput extends ProjectMilestoneConditionInput {
  name: string;
  sortOrder?: number;
  stages: Array<{
    stageKey?: string;
    phase?: string;
    activity: string;
    criteria?: string;
    slaDays?: number;
    upbaseRole?: string;
    customerRole?: string;
  }>;
}

export interface UpdateProjectInput {
  accountId?: string;
  opportunityId?: string | null;
  code?: string;
  name?: string;
  status?: string;
  projectType?: string;
  marginPercent?: number | null;
  priority?: ProjectPriority | null;
  tags?: string[];
  color?: string | null;
  ownerUserId?: string | null;
  memberUserIds?: string[];
  budgetAmount?: number | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  scopeSummary?: string | null;
  acceptanceCriteria?: string | null;
}

export interface ProjectStageSummary {
  id: string;
  accountId: string;
  accountName: string;
  projectId: string;
  projectName: string;
  milestoneId: string;
  milestoneName: string;
  milestoneSortOrder: number;
  stageKey: string;
  phase: string;
  activity: string;
  sortOrder: number;
  cumulativePercent: number;
  activityPercent: number;
  criteria: string;
  description?: string;
  upbaseRole?: string;
  customerRole?: string;
  status: string;
  ownerUserId?: string;
  ownerDisplayName?: string;
  ownerAvatarUrl?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  actualStartAt?: string;
  actualEndAt?: string;
  acceptanceCriteria?: string;
  blockerSummary?: string;
  scopeSummary?: string;
  standardMinutes?: number;
  progressPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectStageInput {
  stageKey?: string;
  phase?: string;
  activity: string;
  cumulativePercent?: number;
  activityPercent?: number;
  criteria?: string;
  description?: string;
  status?: string;
  ownerUserId?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
  acceptanceCriteria?: string;
  blockerSummary?: string;
  scopeSummary?: string;
  standardMinutes?: number;
  progressPercent?: number;
}

export interface UpdateProjectStageInput {
  phase?: string;
  activity?: string;
  cumulativePercent?: number;
  activityPercent?: number;
  criteria?: string;
  description?: string | null;
  status?: string;
  ownerUserId?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  acceptanceCriteria?: string | null;
  blockerSummary?: string | null;
  scopeSummary?: string | null;
  standardMinutes?: number | null;
  progressPercent?: number;
}

export interface ProjectDocumentSummary {
  id: string;
  accountId: string;
  accountName: string;
  projectId: string;
  projectName: string;
  code: string;
  name: string;
  artifactType: string;
  storageKey: string;
  customerVisible: boolean;
  internalOnly: boolean;
  allowedRoles: string[];
  signedUrlExpiresSeconds: number;
  versions: ProjectDocumentVersionSummary[];
  latestVersion?: ProjectDocumentVersionSummary;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDocumentVersionSummary {
  id: string;
  version: number;
  note?: string;
  fileObjectId: string;
  file: FileObjectSummary;
  createdByUserId?: string;
  createdByDisplayName?: string;
  createdAt: string;
}

export interface CreateProjectDocumentInput {
  code?: string;
  name: string;
  artifactType?: string;
  fileObjectId: string;
  note?: string;
  customerVisible?: boolean;
  internalOnly?: boolean;
  allowedRoles?: string[];
  signedUrlExpiresSeconds?: number;
}

export interface UpdateProjectDocumentInput {
  name?: string;
  artifactType?: string;
  customerVisible?: boolean;
  internalOnly?: boolean;
  allowedRoles?: string[];
  signedUrlExpiresSeconds?: number;
}

export interface CreateProjectDocumentVersionInput {
  fileObjectId: string;
  /** Current durable version; use 0 when upgrading a legacy artifact without versions. */
  expectedVersion: number;
  note?: string;
}

export interface ProjectActivitySummary {
  id: string;
  accountId: string;
  accountName: string;
  projectId: string;
  projectName: string;
  activityType: string;
  subject: string;
  note?: string;
  target?: string;
  occurredAt: string;
  occurredTime?: string;
  actionLabel?: string;
  fromValue?: string;
  toValue?: string;
  entityType?: string;
  entityId?: string;
  status: string;
  createdByUserId?: string;
  createdByDisplayName?: string;
  createdByAvatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectActivityInput {
  activityType?: string;
  subject: string;
  note?: string;
  target?: string;
  occurredAt?: string;
  status?: string;
}

export interface UpdateProjectActivityInput {
  activityType?: string;
  subject?: string;
  note?: string | null;
  target?: string | null;
  occurredAt?: string;
  status?: string;
}

export type ProjectRiskCategory = "Financial" | "Operational" | "External" | "Strategic";
export type ProjectRiskLevel = "Low" | "Medium" | "High";

export interface ProjectRiskSummary {
  id: string;
  accountId: string;
  accountName: string;
  projectId: string;
  projectName: string;
  category: ProjectRiskCategory;
  description: string;
  likelihood: ProjectRiskLevel;
  impact: ProjectRiskLevel;
  response: string;
  switchTrigger?: string;
  ownerUserId?: string;
  ownerDisplayName?: string;
  status: string;
  createdByUserId?: string;
  createdByDisplayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRiskInput {
  category?: ProjectRiskCategory;
  description: string;
  likelihood?: ProjectRiskLevel;
  impact?: ProjectRiskLevel;
  response?: string;
  switchTrigger?: string;
  ownerUserId?: string;
  status?: string;
}

export interface UpdateProjectRiskInput {
  category?: ProjectRiskCategory;
  description?: string;
  likelihood?: ProjectRiskLevel;
  impact?: ProjectRiskLevel;
  response?: string;
  switchTrigger?: string | null;
  ownerUserId?: string | null;
  status?: string;
}

export interface ProjectTaskStatusHistorySummary {
  id: string;
  taskId: string;
  accountId: string;
  projectId?: string;
  fromStatus?: string;
  toStatus: string;
  changedByUserId?: string;
  changedAt: string;
  reason?: string;
}

export interface TaskTimeEntrySummary {
  id: string;
  taskId: string;
  accountId: string;
  accountName?: string;
  projectId?: string;
  projectName?: string;
  taskTitle?: string;
  userId: string;
  userDisplayName?: string;
  userEmail?: string;
  userAvatarUrl?: string;
  workDate: string;
  startAt?: string;
  endAt?: string;
  timeZone?: string;
  minutes: number;
  billable: boolean;
  billingExemptReason?: "workspace_day_off";
  dayOffName?: string;
  dayOffDate?: string;
  workType: string;
  approvalStatus: string;
  note?: string;
  reviewedByUserId?: string;
  reviewedByDisplayName?: string;
  reviewedAt?: string;
  reviewNote?: string;
  sourcePlanningBlockId?: string;
  createdAt: string;
  updatedAt?: string;
}

export type WorkspaceDayOffCategory = "national_holiday" | "company_day_off" | "other";

export interface WorkspaceDayOffSummary {
  id: string;
  date: string;
  name: string;
  category: WorkspaceDayOffCategory;
  note?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDayOffListResponse {
  data: WorkspaceDayOffSummary[];
  meta: {
    total: number;
    year: number;
    timeZone: "Asia/Ho_Chi_Minh";
    canManage: boolean;
  };
}

export interface CreateWorkspaceDayOffInput {
  startDate: string;
  endDate: string;
  name: string;
  category?: WorkspaceDayOffCategory;
  note?: string;
}

export interface UpdateWorkspaceDayOffInput {
  date?: string;
  name?: string;
  category?: WorkspaceDayOffCategory;
  note?: string;
  isActive?: boolean;
  expectedUpdatedAt: string;
}

export type DailyActualLogState = "below_target" | "target_met" | "over_target";

export interface DailyActualLogStatus {
  localDate: string;
  timeZone: "Asia/Ho_Chi_Minh";
  totalMinutes: number;
  targetMinutes: 480;
  state: DailyActualLogState;
}

export interface CreateTaskTimeEntryResponse extends TaskTimeEntrySummary {
  dailyActualLog: DailyActualLogStatus;
}

export interface TaskPlanningBlockSummary {
  id: string;
  taskId: string;
  accountId: string;
  accountName?: string;
  projectId?: string;
  projectName?: string;
  userId: string;
  userDisplayName?: string;
  userEmail?: string;
  userAvatarUrl?: string;
  title: string;
  notes?: string;
  startAt: string;
  endAt: string;
  plannedMinutes: number;
  billable?: boolean;
  workType?: string;
  status: string;
  source: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTaskSummary {
  id: string;
  accountId: string;
  accountName: string;
  projectId?: string;
  projectName?: string;
  stageId?: string;
  stageKey?: string;
  stageActivity?: string;
  opportunityId?: string;
  ticketId?: string;
  parentTaskId?: string;
  sortOrder: number;
  title: string;
  description?: string;
  taskType: string;
  taskTypeLayer1?: "PRE_SALE" | "DELIVERY" | "PM";
  taskTypeLayer2?: "CUSTOMER_PROJECT" | "INTERNAL_PROJECT" | "TICKET_MAINTENANCE" | "DAY_OFF_COMPANY";
  status: string;
  priority: string;
  ownerUserId?: string;
  ownerDisplayName?: string;
  ownerAvatarUrl?: string;
  assigneeUserId?: string;
  assigneeDisplayName?: string;
  assigneeAvatarUrl?: string;
  ownerTeamId?: string;
  ownerTeamName?: string;
  plannedStartAt?: string;
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  estimateMinutes: number;
  loggedMinutes: number;
  approvedMinutes: number;
  archivedAt?: string;
  archivedByUserId?: string;
  archiveReason?: string;
  overdue: boolean;
  cycleTimeDays?: number;
  customerVisible: boolean;
  createdAt: string;
  updatedAt: string;
  statusHistory?: ProjectTaskStatusHistorySummary[];
  timeEntries?: TaskTimeEntrySummary[];
  planningBlocks?: TaskPlanningBlockSummary[];
  subtasks?: ProjectTaskSummary[];
}

export type ProjectHierarchyOrderKind = "milestone" | "stage" | "task";

export interface ProjectMilestoneSummary {
  id: string;
  projectId: string;
  name: string;
  normalizedKey: string;
  sortOrder: number;
  gateStatus?: "open" | "locked" | "pending_review" | "approved" | "rejected" | "conditional";
  requiredDocumentCount?: number;
  requiredDocumentTypes?: string[];
  submittedDocumentCount?: number;
  unlockCriteria?: string;
  customerConfirmationRequired?: boolean;
  reviewerRole?: string;
}

export interface ProjectHierarchyOrderInput {
  kind: ProjectHierarchyOrderKind;
  parentId: string | null;
  orderedIds: string[];
  expectedVersion: number;
}

export interface ProjectHierarchyOrderResponse {
  kind: ProjectHierarchyOrderKind;
  parentId: string | null;
  orderedIds: string[];
  hierarchyOrderVersion: number;
}

export interface ProjectHierarchySummary {
  projectId: string;
  hierarchyOrderVersion: number;
  milestones: ProjectMilestoneSummary[];
}

export interface CreateProjectTaskInput {
  accountId: string;
  projectId?: string;
  stageId?: string;
  opportunityId?: string;
  ticketId?: string;
  parentTaskId?: string;
  title: string;
  description?: string;
  taskType?: string;
  /** BRD v2 two-layer task classification used by analytics and governance. */
  taskTypeLayer1?: "PRE_SALE" | "DELIVERY" | "PM";
  taskTypeLayer2?: "CUSTOMER_PROJECT" | "INTERNAL_PROJECT" | "TICKET_MAINTENANCE" | "DAY_OFF_COMPANY";
  status?: string;
  priority?: string;
  ownerUserId?: string;
  assigneeUserId?: string;
  ownerTeamId?: string;
  plannedStartAt?: string;
  dueAt?: string;
  estimateMinutes?: number;
  customerVisible?: boolean;
}

export interface UpdateProjectTaskInput {
  accountId?: string;
  projectId?: string | null;
  stageId?: string | null;
  opportunityId?: string | null;
  ticketId?: string | null;
  parentTaskId?: string | null;
  title?: string;
  description?: string | null;
  taskType?: string;
  taskTypeLayer1?: "PRE_SALE" | "DELIVERY" | "PM" | null;
  taskTypeLayer2?: "CUSTOMER_PROJECT" | "INTERNAL_PROJECT" | "TICKET_MAINTENANCE" | "DAY_OFF_COMPANY" | null;
  status?: string;
  priority?: string;
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  ownerTeamId?: string | null;
  plannedStartAt?: string | null;
  dueAt?: string | null;
  estimateMinutes?: number;
  customerVisible?: boolean;
}

export interface TransitionProjectTaskInput {
  status: string;
  reason?: string;
  changedAt?: string;
}

export interface CreateTaskTimeEntryInput {
  userId?: string;
  workDate: string;
  startAt?: string;
  endAt?: string;
  timeZone?: string;
  minutes: number;
  billable?: boolean;
  workType?: string;
  approvalStatus?: string;
  note?: string;
}

export interface ReviewTaskTimeEntryInput {
  status: "approved" | "rejected";
  expectedUpdatedAt: string;
  reason?: string;
}

export interface CreateTaskPlanningBlockInput {
  userId?: string;
  title?: string;
  notes?: string;
  startAt: string;
  endAt: string;
  plannedMinutes?: number;
  billable?: boolean;
  workType?: string;
  status?: string;
}

export interface TransitionTaskPlanningBlockInput {
  status: "in_progress" | "completed" | "cancelled";
  expectedUpdatedAt: string;
  reason?: string;
}

/** BRD v2 task governance (EV-029/EV-061). */
export interface SubmitTaskPlanInput {
  plannedStartAt?: string | null;
  dueAt?: string | null;
  estimateMinutes?: number;
  taskTypeLayer1: "PRE_SALE" | "DELIVERY" | "PM";
  taskTypeLayer2: "CUSTOMER_PROJECT" | "INTERNAL_PROJECT" | "TICKET_MAINTENANCE" | "DAY_OFF_COMPANY";
}

export interface TimelineChangeRequestInput {
  proposedStartAt?: string | null;
  proposedEndAt?: string | null;
  proposedEstimateMinutes?: number;
  reason: string;
}

export interface ReviewTimelineChangeInput {
  decision: "APPROVED" | "REJECTED";
  reviewNote?: string;
}

export interface OvertimePlanInput {
  userId?: string;
  projectId?: string;
  workDate: string;
  plannedMinutes: number;
  reason: string;
}

export interface ResourceMonthlyCostInput {
  userId: string;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  currency?: string;
  p1BaseAmount?: number;
  p2AllowanceAmount?: number;
  p3PerformanceAmount?: number;
  p4OtherVariableAmount?: number;
  overtimeAmount?: number;
  socialInsuranceAmount?: number;
  pitAmount?: number;
  otherAmount?: number;
  totalMonthlyIncome?: number;
  hourlyCostRate?: number;
}

export interface PnlPeriodInput {
  projectId?: string;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  revenueAmount?: number;
  currency?: string;
}

export interface ReopenPnlPeriodInput {
  reason: string;
}

export type PerformanceGroupBy = "team" | "project" | "user";

export interface PerformanceSummaryItem {
  groupBy: PerformanceGroupBy;
  groupId: string;
  groupLabel: string;
  openTasks: number;
  overdueTasks: number;
  completedTasks: number;
  blockedTasks: number;
  estimatedMinutes: number;
  loggedMinutes: number;
  approvedMinutes: number;
  estimateVarianceMinutes: number;
  medianCycleTimeDays?: number;
}

export interface PerformanceSummaryResponse {
  data: PerformanceSummaryItem[];
  meta: {
    principal: string;
    rowScope: string;
    groupBy: PerformanceGroupBy;
    generatedAt: string;
    source: "postgresql";
    policy: string;
  };
}

export const RESOURCE_ALLOCATION_STATUSES = [
  { code: "requested", label: "Requested" },
  { code: "tentative", label: "Tentative" },
  { code: "reserved", label: "Reserved" },
  { code: "confirmed", label: "Confirmed" },
  { code: "released", label: "Released" },
  { code: "cancelled", label: "Cancelled" }
] as const;

export type ResourceAllocationStatus = (typeof RESOURCE_ALLOCATION_STATUSES)[number]["code"];

export interface ResourceProfileSummary {
  id: string;
  userId: string;
  userDisplayName?: string;
  userEmail?: string;
  userAvatarUrl?: string;
  departmentCode?: string;
  larkOpenId?: string;
  larkTenantKey?: string;
  displayRole?: string;
  defaultWeeklyCapacityMinutes: number;
  billableTargetPercent: number;
  skills: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertResourceProfileInput {
  userId: string;
  displayRole?: string;
  defaultWeeklyCapacityMinutes?: number;
  billableTargetPercent?: number;
  skills?: string[];
  active?: boolean;
}

export interface ResourceAllocationSummary {
  id: string;
  accountId: string;
  accountName?: string;
  projectId?: string;
  projectName?: string;
  opportunityId?: string;
  userId: string;
  userDisplayName?: string;
  role: string;
  skill?: string;
  status: ResourceAllocationStatus;
  allocationPercent: number;
  plannedMinutes: number;
  startAt: string;
  endAt: string;
  overbookApproved: boolean;
  approvedByUserId?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResourceAllocationInput {
  accountId: string;
  projectId?: string;
  opportunityId?: string;
  userId: string;
  role: string;
  skill?: string;
  status?: ResourceAllocationStatus;
  allocationPercent?: number;
  plannedMinutes?: number;
  startAt: string;
  endAt: string;
  overbookApproved?: boolean;
  note?: string;
}

export interface UpdateResourceAllocationStatusInput {
  status: ResourceAllocationStatus;
  overbookApproved?: boolean;
  note?: string;
}

export interface CapacitySummaryItem {
  userId: string;
  userDisplayName: string;
  userEmail?: string;
  userAvatarUrl?: string;
  departmentCode?: string;
  larkOpenId?: string;
  larkTenantKey?: string;
  displayRole?: string;
  skills: string[];
  availableMinutes: number;
  allocatedMinutes: number;
  remainingMinutes: number;
  utilizationPercent: number;
  overbooked: boolean;
  billableTargetPercent: number;
  allocations: ResourceAllocationSummary[];
}

export interface CapacitySummaryResponse {
  data: CapacitySummaryItem[];
  meta: {
    principal: string;
    rowScope: string;
    periodStart: string;
    periodEnd: string;
    generatedAt: string;
    source: "postgresql" | "api_unavailable";
  };
}

export const PROJECT_COST_TYPES = [
  { code: "labor", label: "Labor" },
  { code: "external", label: "External" },
  { code: "software", label: "Software" },
  { code: "travel", label: "Travel" },
  { code: "write_off", label: "Write off" },
  { code: "other", label: "Other" }
] as const;

export const PROJECT_BUDGET_STATUSES = [
  { code: "draft", label: "Draft" },
  { code: "active", label: "Active" },
  { code: "locked", label: "Locked" },
  { code: "superseded", label: "Superseded" }
] as const;

export const PROJECT_PL_SNAPSHOT_STATUSES = [
  { code: "draft", label: "Draft" },
  { code: "locked", label: "Locked" },
  { code: "superseded", label: "Superseded" }
] as const;

export type ProjectCostType = (typeof PROJECT_COST_TYPES)[number]["code"];
export type ProjectBudgetStatus = (typeof PROJECT_BUDGET_STATUSES)[number]["code"];
export type ProjectPlSnapshotStatus = (typeof PROJECT_PL_SNAPSHOT_STATUSES)[number]["code"];

export interface CostRateProfileSummary {
  id: string;
  userId?: string;
  userDisplayName?: string;
  role: string;
  currency: string;
  hourlyCostRate: number;
  effectiveFrom: string;
  effectiveTo?: string;
  active: boolean;
}

export interface CreateCostRateProfileInput {
  userId?: string;
  role: string;
  currency?: string;
  hourlyCostRate: number;
  effectiveFrom: string;
  effectiveTo?: string;
  active?: boolean;
}

export interface ProjectBudgetSummary {
  id: string;
  accountId: string;
  projectId: string;
  projectName?: string;
  code: string;
  currency: string;
  revenueBasis: string;
  plannedRevenueAmount: number;
  plannedCostAmount: number;
  baselineMinutes: number;
  contingencyPercent: number;
  status: ProjectBudgetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProjectBudgetInput {
  accountId: string;
  projectId: string;
  code?: string;
  currency?: string;
  revenueBasis?: string;
  plannedRevenueAmount?: number;
  plannedCostAmount?: number;
  baselineMinutes?: number;
  contingencyPercent?: number;
  status?: ProjectBudgetStatus;
}

export interface ProjectCostSummary {
  id: string;
  accountId: string;
  projectId: string;
  taskTimeEntryId?: string;
  costType: ProjectCostType;
  label: string;
  currency: string;
  amount: number;
  occurredAt: string;
  billable: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectCostInput {
  accountId: string;
  projectId: string;
  taskTimeEntryId?: string;
  costType?: ProjectCostType;
  label: string;
  currency?: string;
  amount: number;
  occurredAt?: string;
  billable?: boolean;
  note?: string;
}

export interface ProjectPlSnapshotSummary {
  id: string;
  accountId: string;
  projectId: string;
  projectName?: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  revenueAmount: number;
  budgetAmount: number;
  plannedCostAmount: number;
  actualLaborCostAmount: number;
  directCostAmount: number;
  writeOffAmount: number;
  totalCostAmount: number;
  grossMarginAmount: number;
  grossMarginPercent?: number;
  status: ProjectPlSnapshotStatus;
  createdAt: string;
}

export interface CreateProjectPlSnapshotInput {
  periodStart: string;
  periodEnd: string;
  currency?: string;
  status?: ProjectPlSnapshotStatus;
}

export interface ProjectPlSummaryItem {
  accountId: string;
  accountName?: string;
  projectId: string;
  projectName: string;
  currency: string;
  plannedRevenueAmount: number;
  paidRevenueAmount: number;
  plannedCostAmount: number;
  approvedLaborMinutes: number;
  actualLaborCostAmount: number;
  directCostAmount: number;
  writeOffAmount: number;
  totalCostAmount: number;
  grossMarginAmount: number;
  grossMarginPercent?: number;
  latestSnapshot?: ProjectPlSnapshotSummary;
}

export interface ProjectPlSummaryResponse {
  data: ProjectPlSummaryItem[];
  meta: {
    principal: string;
    rowScope: string;
    generatedAt: string;
    source: "postgresql";
    policy: string;
  };
}

export interface CreateProjectProgressShareLinkInput {
  label?: string;
  viewerEmail?: string;
  viewerDomain?: string;
  expiresInHours?: number;
  expiresAt?: string;
}

export interface ProjectProgressShareLinkSummary {
  id: string;
  accountId: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  label?: string;
  viewerEmail?: string;
  viewerDomain?: string;
  expiresAt: string;
  revokedAt?: string;
  createdAt: string;
}

export interface CreateProjectProgressShareLinkResponse extends ProjectProgressShareLinkSummary {
  shareUrl: string;
}

export interface RevokeProjectProgressShareLinkResponse extends ProjectProgressShareLinkSummary {
  revokedAt: string;
}

export interface ProjectProgressShareViewResponse {
  project: {
    id: string;
    code: string;
    name: string;
    status: string;
    accountName: string;
    updatedAt: string;
  };
  tickets: Array<{
    code: string;
    title: string;
    priority: string;
    status: string;
    customerVisibleNote?: string;
  }>;
  artifacts: Array<{
    code: string;
    name: string;
    artifactType: string;
  }>;
  meta: {
    shareId: string;
    expiresAt: string;
    viewerEmail?: string;
    viewerDomain?: string;
  };
}

export interface HandoffKickoffInput {
  projectCode?: string;
  projectName?: string;
  kickoffOwnerUserId?: string;
  kickoffAt?: string;
  deploymentStatus?: DeploymentKickoffStatusCode;
  note?: string;
  createStageTaskTemplate?: boolean;
  checklist: {
    commercialScope: boolean;
    signedSow: boolean;
    kickoffOwner: boolean;
    billingReady: boolean;
    deliveryOwner: boolean;
    kickoffScheduled: boolean;
  };
}

export interface HandoffKickoffResponse {
  opportunity: OpportunitySummary;
  project: ProjectSummary;
  activity: OpportunityActivitySummary;
  stages?: ProjectStageSummary[];
  taskTemplates?: ProjectTaskSummary[];
}

export const PROPOSAL_PACKAGE_TYPES = [
  { code: "quick_setup_discovery", label: "Quick Setup / Discovery" },
  { code: "standard_implementation", label: "Standard Implementation" },
  { code: "complex_multi_phase", label: "Complex / Multi-phase Implementation" },
  { code: "monthly_retainer_support", label: "Monthly Retainer / Support" },
  { code: "change_request", label: "Change Request" },
  { code: "license_subscription_pass_through", label: "License / Subscription Pass-through" }
] as const;

export const PROPOSAL_DOCUMENT_TYPES = [
  { code: "proposal", label: "Proposal" },
  { code: "sow", label: "SOW" },
  { code: "quotation", label: "Quotation" },
  { code: "payment_schedule", label: "Payment schedule" },
  { code: "risk_register", label: "Risk register" },
  { code: "appendix", label: "Appendix" },
  { code: "vendor_quote", label: "Vendor quote" },
  { code: "customer_acceptance", label: "Customer acceptance" },
  { code: "other", label: "Other" }
] as const;

export type ProposalPackageTypeCode = (typeof PROPOSAL_PACKAGE_TYPES)[number]["code"];
export type ProposalDocumentTypeCode = (typeof PROPOSAL_DOCUMENT_TYPES)[number]["code"];
export type ProposalPackageStatus =
  | "draft"
  | "internal_review"
  | "revision_required"
  | "internally_approved"
  | "sent_to_customer"
  | "customer_revision_requested"
  | "customer_accepted"
  | "superseded"
  | "withdrawn"
  | "expired";
export type ScopeRiskLevel = "low" | "medium" | "high" | "critical";
export type DealApprovalRequestType =
  | "proposal_readiness"
  | "discount"
  | "payment_term"
  | "scope_risk"
  | "unusual_commitment"
  | "license_pass_through"
  | "change_request_impact";
export type DealApprovalRequestStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "cancelled"
  | "expired";
export type DealApprovalDecisionValue = "approved" | "rejected" | "revision_requested";
export type LarkApprovalInstanceStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "DELETED"
  | "REVERTED";

export interface ProposalDocumentSummary {
  id: string;
  proposalPackageId: string;
  documentType: ProposalDocumentTypeCode;
  version: number;
  title: string;
  storageProvider: string;
  storageKey?: string;
  externalUrl?: string;
  customerVisible: boolean;
  checksum?: string;
  createdAt: string;
}

export interface DealApprovalDecisionSummary {
  id: string;
  approvalRequestId: string;
  decision: DealApprovalDecisionValue;
  decidedByUserId?: string;
  comment?: string;
  larkTaskId?: string;
  decidedAt: string;
}

export interface DealApprovalRequestSummary {
  id: string;
  proposalPackageId: string;
  opportunityId: string;
  requestType: DealApprovalRequestType;
  status: DealApprovalRequestStatus;
  requiredRoleCode: string;
  assignedToUserId?: string;
  severity: string;
  reason: string;
  larkApprovalInstanceCode?: string;
  submittedAt?: string;
  decidedAt?: string;
  decisions?: DealApprovalDecisionSummary[];
}

export interface ProposalGateCheckResponse {
  proposalPackageId: string;
  proposalSentReady: boolean;
  contractingReady: boolean;
  missingDocuments: ProposalDocumentTypeCode[];
  pendingApprovalRequestIds: string[];
  failures: string[];
}

export interface ProposalPackageSummary {
  id: string;
  accountId: string;
  accountName: string;
  opportunityId: string;
  opportunityTitle: string;
  packageType: ProposalPackageTypeCode;
  status: ProposalPackageStatus;
  version: number;
  title: string;
  currency: string;
  proposedAmount?: number;
  discountPercent?: number;
  paymentTermSummary?: string;
  scopeRiskLevel: ScopeRiskLevel;
  customerVisible: boolean;
  submittedAt?: string;
  approvedAt?: string;
  sentAt?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalPackageDetail extends ProposalPackageSummary {
  documents: ProposalDocumentSummary[];
  approvalRequests: DealApprovalRequestSummary[];
  gateCheck: ProposalGateCheckResponse;
}

export interface CreateProposalPackageInput {
  opportunityId: string;
  packageType: ProposalPackageTypeCode;
  title?: string;
  currency?: string;
  proposedAmount?: number;
  discountPercent?: number;
  paymentTermSummary?: string;
  scopeRiskLevel?: ScopeRiskLevel;
  customerVisible?: boolean;
}

export interface UpdateProposalPackageInput {
  title?: string;
  currency?: string;
  proposedAmount?: number;
  discountPercent?: number;
  paymentTermSummary?: string;
  scopeRiskLevel?: ScopeRiskLevel;
  customerVisible?: boolean;
  status?: ProposalPackageStatus;
}

export interface AddProposalDocumentInput {
  documentType: ProposalDocumentTypeCode;
  version?: number;
  title: string;
  storageProvider?: string;
  storageKey?: string;
  externalUrl?: string;
  customerVisible?: boolean;
  checksum?: string;
}

export const CONTRACT_STATUSES = [
  { code: "draft", label: "Draft" },
  { code: "internal_review", label: "Internal review" },
  { code: "ready_for_signature", label: "Ready for signature" },
  { code: "sent_for_signature", label: "Sent for signature" },
  { code: "signed", label: "Signed" },
  { code: "active", label: "Active" },
  { code: "voided", label: "Voided" },
  { code: "expired", label: "Expired" }
] as const;

export const CONTRACT_SIGNATURE_STATUSES = [
  { code: "not_ready", label: "Not ready" },
  { code: "ready", label: "Ready" },
  { code: "sent", label: "Sent" },
  { code: "signed", label: "Signed" },
  { code: "voided", label: "Voided" },
  { code: "expired", label: "Expired" }
] as const;

export const CONTRACT_DOCUMENT_TYPES = [
  { code: "contract_pdf", label: "Contract PDF" },
  { code: "signed_contract", label: "Signed contract" },
  { code: "appendix", label: "Appendix" },
  { code: "sow", label: "SOW" },
  { code: "payment_schedule", label: "Payment schedule" },
  { code: "legal_review", label: "Legal review" },
  { code: "other", label: "Other" }
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number]["code"];
export type ContractSignatureStatus = (typeof CONTRACT_SIGNATURE_STATUSES)[number]["code"];
export type ContractDocumentTypeCode = (typeof CONTRACT_DOCUMENT_TYPES)[number]["code"];

export interface ContractDocumentSummary {
  id: string;
  contractId: string;
  documentType: ContractDocumentTypeCode;
  version: number;
  title: string;
  storageProvider: string;
  storageKey?: string;
  externalUrl?: string;
  customerVisible: boolean;
  checksum?: string;
  signedAt?: string;
  createdAt: string;
}

export interface ContractSummary {
  id: string;
  accountId: string;
  accountName: string;
  opportunityId?: string;
  opportunityTitle?: string;
  projectId?: string;
  projectName?: string;
  proposalPackageId?: string;
  proposalPackageTitle?: string;
  code: string;
  title: string;
  status: ContractStatus;
  signatureStatus: ContractSignatureStatus;
  currency: string;
  contractValue?: number;
  effectiveDate?: string;
  expiresAt?: string;
  signedAt?: string;
  signedByName?: string;
  signedByEmail?: string;
  customerVisible: boolean;
  allowedRoles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContractDetail extends ContractSummary {
  documents: ContractDocumentSummary[];
  signatureReady: boolean;
  readinessFailures: string[];
}

export interface CreateContractInput {
  accountId: string;
  opportunityId?: string;
  projectId?: string;
  proposalPackageId?: string;
  code?: string;
  title: string;
  currency?: string;
  contractValue?: number;
  effectiveDate?: string;
  expiresAt?: string;
  customerVisible?: boolean;
  allowedRoles?: string[];
}

export interface AddContractDocumentInput {
  documentType: ContractDocumentTypeCode;
  version?: number;
  title: string;
  storageProvider?: string;
  storageKey?: string;
  externalUrl?: string;
  customerVisible?: boolean;
  checksum?: string;
}

export interface SubmitContractSignatureInput {
  note?: string;
}

export interface MarkContractSignedInput {
  signedAt?: string;
  signedByName: string;
  signedByEmail?: string;
  signedDocumentId?: string;
}

export interface VoidContractInput {
  reason: string;
}

export const PAYMENT_SCHEDULE_STATUSES = [
  { code: "draft", label: "Draft" },
  { code: "active", label: "Active" },
  { code: "superseded", label: "Superseded" },
  { code: "cancelled", label: "Cancelled" }
] as const;

export const PAYMENT_MILESTONE_STATUSES = [
  { code: "planned", label: "Planned" },
  { code: "ready_for_finance_review", label: "Ready for finance review" },
  { code: "ready_to_invoice", label: "Ready to invoice" },
  { code: "invoiced", label: "Invoiced" },
  { code: "partially_paid", label: "Partially paid" },
  { code: "paid", label: "Paid" },
  { code: "overdue", label: "Overdue" },
  { code: "disputed", label: "Disputed" },
  { code: "waived", label: "Waived" },
  { code: "cancelled", label: "Cancelled" }
] as const;

export const PAYMENT_TRIGGER_TYPES = [
  { code: "contract_signing", label: "Contract signing" },
  { code: "kickoff", label: "Kickoff" },
  { code: "delivery_stage", label: "Delivery stage" },
  { code: "acceptance", label: "Acceptance" },
  { code: "calendar_date", label: "Calendar date" },
  { code: "monthly_retainer", label: "Monthly retainer" },
  { code: "manual", label: "Manual" },
  { code: "other", label: "Other" }
] as const;

export const INVOICE_STATUSES = [
  { code: "draft", label: "Draft" },
  { code: "issued", label: "Issued" },
  { code: "sent", label: "Sent" },
  { code: "cancelled", label: "Cancelled" },
  { code: "voided", label: "Voided" }
] as const;

export const INVOICE_PAYMENT_STATUSES = [
  { code: "unpaid", label: "Unpaid" },
  { code: "partially_paid", label: "Partially paid" },
  { code: "paid", label: "Paid" },
  { code: "overdue", label: "Overdue" },
  { code: "disputed", label: "Disputed" },
  { code: "written_off", label: "Written off" }
] as const;

export const AR_FOLLOW_UP_STATUSES = [
  { code: "open", label: "Open" },
  { code: "snoozed", label: "Snoozed" },
  { code: "resolved", label: "Resolved" },
  { code: "cancelled", label: "Cancelled" }
] as const;

export const PAYMENT_EVIDENCE_TYPES = [
  { code: "invoice_file", label: "Invoice file" },
  { code: "payment_receipt", label: "Payment receipt" },
  { code: "bank_transfer", label: "Bank transfer" },
  { code: "customer_confirmation", label: "Customer confirmation" },
  { code: "acceptance_evidence", label: "Acceptance evidence" },
  { code: "exception_approval", label: "Exception approval" },
  { code: "other", label: "Other" }
] as const;

export type PaymentScheduleStatus = (typeof PAYMENT_SCHEDULE_STATUSES)[number]["code"];
export type PaymentMilestoneStatus = (typeof PAYMENT_MILESTONE_STATUSES)[number]["code"];
export type PaymentTriggerTypeCode = (typeof PAYMENT_TRIGGER_TYPES)[number]["code"];
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]["code"];
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number]["code"];
export type ArFollowUpStatus = (typeof AR_FOLLOW_UP_STATUSES)[number]["code"];
export type PaymentEvidenceTypeCode = (typeof PAYMENT_EVIDENCE_TYPES)[number]["code"];

export interface PaymentEvidenceSummary {
  id: string;
  milestoneId?: string;
  invoiceId?: string;
  accountId: string;
  evidenceType: PaymentEvidenceTypeCode;
  title: string;
  storageProvider: string;
  storageKey?: string;
  externalUrl?: string;
  customerVisible: boolean;
  createdAt: string;
}

export interface ArFollowUpSummary {
  id: string;
  milestoneId: string;
  invoiceId?: string;
  accountId: string;
  ownerUserId?: string;
  ownerDisplayName?: string;
  status: ArFollowUpStatus;
  reason: string;
  nextActionAt?: string;
  resolvedAt?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceSummary {
  id: string;
  milestoneId: string;
  accountId: string;
  contractId?: string;
  projectId?: string;
  code: string;
  status: InvoiceStatus;
  paymentStatus: InvoicePaymentStatus;
  currency: string;
  amount?: number;
  paidAmount?: number;
  issuedAt?: string;
  sentAt?: string;
  dueAt?: string;
  paidAt?: string;
  externalInvoiceNo?: string;
  customerVisible: boolean;
  storageProvider: string;
  storageKey?: string;
  externalUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoicePaymentSummary {
  id: string;
  invoiceId: string;
  milestoneId: string;
  accountId: string;
  projectId?: string;
  currency: string;
  amount: number;
  paidAt: string;
  evidenceType?: PaymentEvidenceTypeCode;
  evidenceTitle?: string;
  storageProvider?: string;
  storageKey?: string;
  externalUrl?: string;
  note?: string;
  createdAt: string;
}

export interface PaymentMilestoneSummary {
  id: string;
  scheduleId: string;
  accountId: string;
  contractId?: string;
  projectId?: string;
  code: string;
  sequence: number;
  label: string;
  triggerType: PaymentTriggerTypeCode;
  triggerRef?: string;
  percentage?: number;
  amount?: number;
  dueAt?: string;
  invoiceReadyAt?: string;
  invoicedAt?: string;
  paidAt?: string;
  status: PaymentMilestoneStatus;
  invoiceStatus: InvoiceStatus;
  paymentStatus: InvoicePaymentStatus;
  financeOwnerUserId?: string;
  financeOwnerDisplayName?: string;
  overdueOwnerUserId?: string;
  overdueOwnerDisplayName?: string;
  customerVisible: boolean;
  internalNote?: string;
  customerNote?: string;
  createdAt: string;
  updatedAt: string;
  invoices?: InvoiceSummary[];
  arFollowUps?: ArFollowUpSummary[];
  evidence?: PaymentEvidenceSummary[];
}

export interface PaymentScheduleSummary {
  id: string;
  accountId: string;
  accountName: string;
  contractId?: string;
  contractCode?: string;
  opportunityId?: string;
  opportunityTitle?: string;
  projectId?: string;
  projectName?: string;
  proposalPackageId?: string;
  proposalPackageTitle?: string;
  code: string;
  title: string;
  status: PaymentScheduleStatus;
  currency: string;
  totalAmount?: number;
  paidAmount?: number;
  outstandingAmount?: number;
  overdueAmount?: number;
  customerVisible: boolean;
  allowedRoles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentScheduleDetail extends PaymentScheduleSummary {
  milestones: PaymentMilestoneSummary[];
}

export interface PaymentScheduleMilestoneInput {
  code?: string;
  sequence?: number;
  label: string;
  triggerType?: PaymentTriggerTypeCode;
  triggerRef?: string;
  percentage?: number;
  amount?: number;
  dueAt?: string;
  financeOwnerUserId?: string;
  overdueOwnerUserId?: string;
  customerVisible?: boolean;
  internalNote?: string;
  customerNote?: string;
}

export interface CreatePaymentScheduleInput {
  accountId: string;
  contractId?: string;
  opportunityId?: string;
  projectId?: string;
  proposalPackageId?: string;
  code?: string;
  title: string;
  status?: PaymentScheduleStatus;
  currency?: string;
  totalAmount?: number;
  customerVisible?: boolean;
  allowedRoles?: string[];
  milestones?: PaymentScheduleMilestoneInput[];
}

export type AddPaymentMilestoneInput = PaymentScheduleMilestoneInput;

export interface AddPaymentEvidenceInput {
  evidenceType: PaymentEvidenceTypeCode;
  title: string;
  storageProvider?: string;
  storageKey?: string;
  externalUrl?: string;
  customerVisible?: boolean;
}

export interface MarkMilestoneReadyForFinanceInput {
  note?: string;
  evidence?: AddPaymentEvidenceInput;
}

export interface ApproveMilestoneInvoiceReadinessInput {
  readyByException?: boolean;
  reason?: string;
}

export interface CreateInvoiceInput {
  code?: string;
  amount?: number;
  dueAt?: string;
  issuedAt?: string;
  sentAt?: string;
  externalInvoiceNo?: string;
  customerVisible?: boolean;
  storageProvider?: string;
  storageKey?: string;
  externalUrl?: string;
}

export interface RecordInvoicePaymentInput {
  paidAmount: number;
  paidAt?: string;
  note?: string;
  evidence?: AddPaymentEvidenceInput;
}

export interface CreateArFollowUpInput {
  invoiceId?: string;
  ownerUserId?: string;
  reason: string;
  nextActionAt?: string;
  note?: string;
}

export interface ResolveArFollowUpInput {
  note?: string;
  resolvedAt?: string;
}

export interface ArAgingSummaryItem {
  accountId: string;
  accountName: string;
  milestoneId: string;
  invoiceId?: string;
  code: string;
  label: string;
  currency: string;
  outstandingAmount?: number;
  dueAt?: string;
  daysOverdue: number;
  paymentStatus: InvoicePaymentStatus;
  nextActionAt?: string;
}

export interface ArAgingSummaryResponse {
  data: ArAgingSummaryItem[];
  meta: {
    principal: string;
    rowScope: string;
    generatedAt: string;
    source: "postgresql";
  };
}

export interface SubmitProposalReviewInput {
  reason?: string;
}

export interface RecordApprovalDecisionInput {
  decision: DealApprovalDecisionValue;
  comment?: string;
  larkTaskId?: string;
}

export interface ProposalApprovalCallbackInput {
  larkApprovalInstanceCode: string;
  status: LarkApprovalInstanceStatus;
  comment?: string;
  larkTaskId?: string;
}

export interface SendProposalToCustomerInput {
  note?: string;
}

export interface TicketSummary {
  id: string;
  accountId: string;
  projectId?: string;
  requesterUserId?: string;
  code: string;
  title: string;
  description?: string;
  category?: string;
  source?: string;
  ownerQueue?: string;
  priority: string;
  status: string;
  firstResponseDueAt?: string;
  resolutionDueAt?: string;
  customerVisibleNote?: string;
  internalNote?: string;
  resolutionSummary?: string;
  resolutionType?: string;
  closureReason?: string;
  confirmationState?: string;
  reopenCount?: number;
  escalationOwnerUserId?: string;
  escalationReason?: string;
  recoveryAction?: string;
  nextUpdateAt?: string;
  requestedAction?: string;
  customerOwner?: string;
  customerDueAt?: string;
  resolutionSlaPausedAt?: string;
  convertedChangeRequestId?: string;
  createdAt?: string;
  updatedAt?: string;
  statusHistory?: TicketStatusHistorySummary[];
}

export interface TicketStatusHistorySummary {
  id: string;
  ticketId: string;
  accountId: string;
  projectId?: string;
  fromStatus?: string;
  toStatus: string;
  changedByUserId?: string;
  reason?: string;
  customerVisibleNote?: string;
  internalNote?: string;
  createdAt: string;
}

export interface CreateTicketInput {
  accountId: string;
  projectId?: string;
  requesterUserId?: string;
  source: string;
  category: string;
  priority: string;
  title: string;
  description: string;
  customerVisibleSummary: string;
  internalNote?: string;
  idempotencyKey?: string;
}

export interface UpdateTicketInput {
  status?: string;
  priority?: string;
  category?: string;
  ownerQueue?: string;
  customerVisibleNote?: string;
  internalNote?: string;
  transitionReason?: string;
  requestedAction?: string;
  customerOwner?: string;
  customerDueAt?: string;
  escalationOwnerUserId?: string;
  escalationReason?: string;
  recoveryAction?: string;
  nextUpdateAt?: string;
  resolutionSummary?: string;
  resolutionType?: string;
  closureReason?: string;
  confirmationState?: string;
  convertedChangeRequestId?: string;
}

export interface ArtifactSummary {
  id: string;
  accountId: string;
  projectId?: string;
  code: string;
  name: string;
  artifactType: string;
  customerVisible: boolean;
  allowedRoles: string[];
}

export type FileObjectStatus = "active" | "revoked" | "deleted" | "quarantined";
export type FileScanStatus = "clean" | "pending" | "failed" | "blocked";
export type FileVisibility = "internal" | "customer";

export interface FileObjectSummary {
  id: string;
  accountId: string;
  projectId?: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  storageProvider: string;
  ownerType: string;
  ownerId?: string;
  customerVisible: boolean;
  internalOnly: boolean;
  allowedRoles: string[];
  scanStatus: FileScanStatus;
  status: FileObjectStatus;
  createdAt: string;
  revokedAt?: string;
  deletedAt?: string;
}

export interface UploadFileInput {
  accountId: string;
  projectId?: string;
  fileName: string;
  contentType: string;
  base64Data: string;
  ownerType?: string;
  ownerId?: string;
  customerVisible?: boolean;
  internalOnly?: boolean;
  allowedRoles?: string[];
  storageProvider?: "local" | "lark_drive";
}

export interface CreateFileDownloadGrantInput {
  expiresInSeconds?: number;
}

export interface FileDownloadGrantSummary {
  fileObjectId: string;
  signedUrl: string;
  expiresAt: string;
}

export interface TaskCommentSummary {
  id: string;
  taskId: string;
  accountId: string;
  projectId?: string;
  parentCommentId?: string;
  body: string;
  visibility: FileVisibility;
  status: string;
  larkTaskGuid?: string;
  larkCommentId?: string;
  syncStatus: string;
  syncError?: string;
  createdByUserId?: string;
  createdByDisplayName?: string;
  createdByAvatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCommentSummary {
  id: string;
  projectId: string;
  accountId: string;
  parentCommentId?: string;
  body: string;
  visibility: FileVisibility;
  status: string;
  syncStatus: string;
  syncError?: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskCommentInput {
  body: string;
  visibility?: FileVisibility;
  parentCommentId?: string;
  larkTaskGuid?: string;
}

export interface CreateProjectCommentInput {
  body: string;
  visibility?: FileVisibility;
  parentCommentId?: string;
}

export interface TaskAttachmentSummary {
  id: string;
  taskId: string;
  accountId: string;
  projectId?: string;
  fileObjectId: string;
  commentId?: string;
  larkTaskGuid?: string;
  larkAttachmentToken?: string;
  syncStatus: string;
  syncError?: string;
  file: FileObjectSummary;
  createdByUserId?: string;
  createdAt: string;
}

export interface ProjectAttachmentSummary {
  id: string;
  projectId: string;
  accountId: string;
  fileObjectId: string;
  commentId?: string;
  syncStatus: string;
  syncError?: string;
  file: FileObjectSummary;
  createdByUserId?: string;
  createdAt: string;
}

export interface CreateTaskAttachmentInput {
  fileObjectId: string;
  commentId?: string;
  larkTaskGuid?: string;
}

export interface CreateProjectAttachmentInput {
  fileObjectId: string;
  commentId?: string;
}

export interface ResourceListResponse<T> {
  data: T[];
  meta: {
    principal: string;
    rowScope: string;
    hiddenFields: string[];
    pagination?: ResourceListPaginationMeta;
  };
}

export interface ResourceListPaginationMeta {
  limit: number;
  offset: number;
  returned: number;
  total: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ExportResponse<T> {
  data: T[];
  meta: {
    exportedBy: string;
    resource: Resource;
    rowCount: number;
  };
}

export interface DownloadResponse {
  artifactId: string;
  signedUrl: string;
  expiresAt: string;
}

export interface AuthSessionResponse {
  token: string;
  expiresAt: string;
  principal: PrincipalContext;
}

export interface LarkAuthorizeUrlResponse {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

export interface LarkOAuthCallbackResponse extends AuthSessionResponse {
  returnTo: string;
}

export interface AdminRevokeSessionsResponse {
  revokedSessions: number;
  userId: string;
  grantVersion: string;
}

export type AdminAccessMemberStatus = "active" | "suspended";
export type AdminAccessMemberType = "internal" | "portal";

export interface AdminAccessMemberSummary {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  departmentCode?: string;
  larkOpenId?: string;
  larkTenantKey?: string;
  hasResourceProfile: boolean;
  resourceDisplayRole?: string;
  resourceSkills: string[];
  resourceWeeklyCapacityMinutes?: number;
  resourceBillableTargetPercent?: number;
  subjectType: AdminAccessMemberType;
  status: AdminAccessMemberStatus;
  tenantKey: string;
  workspaceId?: string;
  roleCodes: string[];
  accountIds: string[];
  accountNames: string[];
  projectIds: string[];
  projectNames: string[];
  projectMemberCount?: number;
  assignedTaskCount?: number;
  ownedTaskCount?: number;
  timeEntryCount?: number;
  activeSessionCount: number;
  lastSeenAt?: string;
  createdAt: string;
}

export interface AdminAccessMembersResponse {
  data: AdminAccessMemberSummary[];
  meta: {
    tenantKey: string;
    total: number;
  };
}

export interface AdminAccessMemberResponse {
  data: AdminAccessMemberSummary;
  meta: {
    tenantKey: string;
  };
}

export type AdminInvitationStatus = PortalInvitationStatus;

export interface AdminInvitationSummary {
  id: string;
  invitedEmail: string;
  requestedEmail?: string;
  accountId?: string;
  accountName?: string;
  projectId?: string;
  projectName?: string;
  roleCode: string;
  scope: "customer_account" | "customer_project";
  status: AdminInvitationStatus;
  reviewReason?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminInvitationsResponse {
  data: AdminInvitationSummary[];
  meta: {
    tenantKey: string;
    total: number;
  };
}

export interface AdminDeactivateMemberResponse {
  userId: string;
  status: AdminAccessMemberStatus;
  endedRoleBindings: number;
  revokedSessions: number;
  grantVersion: string;
  roleVersion: string;
}

export interface AdminResendInvitationResponse extends CreatePortalInvitationResponse {}

export type AdminPolicyAuditSource = "audit_event" | "policy_decision";

export interface AdminPolicyAuditEntry {
  id: string;
  source: AdminPolicyAuditSource;
  actorUserId?: string;
  actorDisplayName?: string;
  action: string;
  resource: string;
  resourceId?: string;
  decision?: PolicyDecision;
  reason?: string;
  requestId: string;
  createdAt: string;
}

export interface AdminPolicyAuditResponse {
  data: AdminPolicyAuditEntry[];
  meta: {
    tenantKey: string;
    total: number;
  };
}

export type PortalInvitationStatus =
  | "pending"
  | "review_required"
  | "accepted"
  | "revoked"
  | "expired"
  | "rejected";

export interface CreatePortalInvitationResponse {
  id: string;
  invitedEmail: string;
  status: PortalInvitationStatus;
  expiresAt: string;
  magicLink: string;
}

export type InternalRoleCode = "FOUNDER_GM" | "WORKSPACE_ADMIN" | "WORKSPACE_USER" | "SALES_OWNER" | "DELIVERY_LEAD" | "FINANCE_ADMIN";

export interface CreateInternalUserInput {
  email: string;
  displayName: string;
  roleCode: InternalRoleCode;
  tenantKey?: string;
  workspaceId?: string;
  workspaceKey?: string;
  departmentCode?: string;
  accountId?: string;
  projectId?: string;
}

export interface CreateInternalUserResponse {
  id: string;
  email: string;
  displayName: string;
  roleCode: InternalRoleCode;
  subjectType: "internal_user";
  status: "active";
  tenantKey: string;
  workspaceId: string;
  workspaceKey: string;
  loginUrl: string;
}

export interface PortalInvitationActivationResponse {
  status: "accepted" | "review_required";
  invitationId: string;
  invitedEmail: string;
  requestedEmail: string;
  reason?: string;
  session?: AuthSessionResponse;
}

export interface PortalInvitationReviewResponse {
  id: string;
  status: "accepted";
  invitedEmail: string;
  requestedEmail: string;
}

export interface LarkEventIngestionResponse {
  ok: boolean;
  eventId?: string;
  eventType?: string;
  status?: "received" | "duplicate" | "ignored";
}

export interface DashboardSummaryResponse {
  data: {
    accounts: number;
    opportunities: number;
    projects: number;
    tickets: number;
    artifacts: number;
  };
  drillDown: Array<{
    resource: Resource;
    count: number;
    href: string;
  }>;
  meta: {
    principal: string;
    rowScope: string;
    policy: string;
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Workforce & Project Analytics (spec 33-workforce-project-analytics)
 * Canonical contracts shared by the Nest API, the Next BFF and the /analytics
 * UI. Every response carries the definitions version so chart, table and CSV
 * always agree on KPI semantics.
 * ──────────────────────────────────────────────────────────────────────────── */

export const ANALYTICS_DEFINITIONS_VERSION = "wpa-v3.2026-09-21";
export const ANALYTICS_TIMEZONE = "Asia/Ho_Chi_Minh";
export const ANALYTICS_MAX_RANGE_DAYS = 366;
export const ANALYTICS_SMALL_COHORT_THRESHOLD = 3;

export type AnalyticsGrain = "day" | "week" | "month";
export type AnalyticsCompareMode = "none" | "previous";
export type AnalyticsMetricState = "available" | "partial" | "unavailable";
export type AnalyticsRowScope =
  | "workspace"
  | "managed_projects"
  | "self"
  | "related_accounts"
  | "financial_aggregate";

export type AnalyticsMetricKey =
  | "actualMinutes"
  | "reviewedApprovedMinutes"
  | "legacyApprovedMinutes"
  | "submittedMinutes"
  | "rejectedMinutes"
  | "billableRatio"
  | "capacityMinutes"
  | "actualUtilization"
  | "plannedUtilization"
  | "scheduledMinutes"
  | "scheduleVarianceMinutes"
  | "allocationMinutes"
  | "estimateMinutes"
  | "projectsTouched"
  | "taskCompletionRate"
  | "onTimeCompletionRate"
  | "dueDateCoverage"
  | "estimateVarianceMinutes"
  | "medianCycleTimeDays"
  | "overdueTasks"
  | "overdueEstimateMinutes"
  | "blockedTasks"
  | "overbookedPeople"
  | "reworkShare";

export type AnalyticsMetricUnit = "minutes" | "percent" | "count" | "days" | "ratio";

export interface AnalyticsMetricDefinition {
  key: AnalyticsMetricKey;
  label: string;
  formula: string;
  numerator: string;
  denominator: string;
  exclusions: string;
  rounding: string;
  source: string;
  unit: AnalyticsMetricUnit;
}

/**
 * KPI dictionary. Actual work includes every recorded time entry except
 * explicitly rejected legacy records. Estimate, scheduled planning and
 * allocation remain separate and are never merged into actual hours.
 */
export const ANALYTICS_METRIC_DEFINITIONS: Record<AnalyticsMetricKey, AnalyticsMetricDefinition> = {
  actualMinutes: {
    key: "actualMinutes",
    label: "Giờ thực tế đã ghi nhận",
    formula: "SUM(TaskTimeEntry.minutes) WHERE approvalStatus <> 'rejected'",
    numerator: "all recorded minutes attributed by startAt ?? workDate",
    denominator: "—",
    exclusions: "explicitly rejected legacy records",
    rounding: "integer minutes",
    source: "TaskTimeEntry",
    unit: "minutes"
  },
  reviewedApprovedMinutes: {
    key: "reviewedApprovedMinutes",
    label: "Giờ thực tế đã ghi nhận (tương thích cũ)",
    formula: "Deprecated alias of actualMinutes",
    numerator: "all recorded minutes attributed by startAt ?? workDate",
    denominator: "—",
    exclusions: "explicitly rejected legacy records",
    rounding: "integer minutes",
    source: "TaskTimeEntry",
    unit: "minutes"
  },
  legacyApprovedMinutes: {
    key: "legacyApprovedMinutes",
    label: "Giờ lịch sử chưa phân loại (tương thích cũ)",
    formula: "Deprecated compatibility breakdown",
    numerator: "legacy status minutes",
    denominator: "—",
    exclusions: "reviewed rows",
    rounding: "integer minutes",
    source: "TaskTimeEntry",
    unit: "minutes"
  },
  submittedMinutes: {
    key: "submittedMinutes",
    label: "Giờ chờ xử lý (tương thích cũ)",
    formula: "Deprecated compatibility breakdown",
    numerator: "submitted minutes",
    denominator: "—",
    exclusions: "approved/rejected rows",
    rounding: "integer minutes",
    source: "TaskTimeEntry",
    unit: "minutes"
  },
  rejectedMinutes: {
    key: "rejectedMinutes",
    label: "Giờ không hợp lệ (tương thích cũ)",
    formula: "Deprecated compatibility breakdown",
    numerator: "excluded legacy minutes",
    denominator: "—",
    exclusions: "approved/submitted rows",
    rounding: "integer minutes",
    source: "TaskTimeEntry",
    unit: "minutes"
  },
  billableRatio: {
    key: "billableRatio",
    label: "Tỷ lệ billable",
    formula: "billable recorded minutes / actualMinutes",
    numerator: "billable recorded minutes",
    denominator: "actualMinutes; 0 → N/A",
    exclusions: "explicitly rejected legacy records",
    rounding: "0.1 percentage point",
    source: "TaskTimeEntry",
    unit: "percent"
  },
  capacityMinutes: {
    key: "capacityMinutes",
    label: "Capacity",
    formula: "SUM(effective capacity periods prorated to business-day overlap); weekly fallback scaled by weekdays only when a profile explicitly provides it",
    numerator: "prorated available minutes",
    denominator: "—",
    exclusions: "users without capacity period or explicit weekly capacity → missing coverage, never 0 or a fixed default",
    rounding: "integer minutes",
    source: "ResourceCapacityPeriod + WorkspaceMemberProfile",
    unit: "minutes"
  },
  actualUtilization: {
    key: "actualUtilization",
    label: "Utilization thực tế",
    formula: "actualMinutes / capacity minutes",
    numerator: "recorded actual minutes",
    denominator: "capacity minutes; missing/0 → N/A",
    exclusions: "users without known capacity are excluded from the denominator and counted in coverage",
    rounding: "0.1 percentage point",
    source: "TaskTimeEntry + capacity",
    unit: "percent"
  },
  plannedUtilization: {
    key: "plannedUtilization",
    label: "Utilization theo allocation",
    formula: "allocation planned minutes (overlap prorated) / capacity minutes",
    numerator: "allocation minutes",
    denominator: "capacity minutes; missing/0 → N/A",
    exclusions: "released/cancelled allocations",
    rounding: "0.1 percentage point",
    source: "ResourceAllocation + capacity",
    unit: "percent"
  },
  scheduledMinutes: {
    key: "scheduledMinutes",
    label: "Giờ đã xếp lịch (planning blocks)",
    formula: "SUM(TaskPlanningBlock.plannedMinutes × overlap fraction)",
    numerator: "prorated planned minutes",
    denominator: "—",
    exclusions: "cancelled blocks",
    rounding: "integer minutes",
    source: "TaskPlanningBlock",
    unit: "minutes"
  },
  scheduleVarianceMinutes: {
    key: "scheduleVarianceMinutes",
    label: "Chênh lệch so với giờ đã xếp",
    formula: "actualMinutes − scheduledMinutes in the selected date range",
    numerator: "recorded actual minutes minus prorated scheduled planning minutes",
    denominator: "—",
    exclusions: "cancelled planning blocks; explicitly rejected legacy time entries",
    rounding: "integer minutes",
    source: "TaskTimeEntry + TaskPlanningBlock",
    unit: "minutes"
  },
  allocationMinutes: {
    key: "allocationMinutes",
    label: "Giờ allocation",
    formula: "SUM(ResourceAllocation.plannedMinutes × overlap fraction)",
    numerator: "prorated allocation minutes",
    denominator: "—",
    exclusions: "RELEASED/CANCELLED allocations",
    rounding: "integer minutes",
    source: "ResourceAllocation",
    unit: "minutes"
  },
  estimateMinutes: {
    key: "estimateMinutes",
    label: "Task estimate",
    formula: "SUM(ProjectTask.estimateMinutes) for eligible leaf tasks in scope",
    numerator: "estimate minutes",
    denominator: "—",
    exclusions: "parent tasks, archived/cancelled tasks",
    rounding: "integer minutes",
    source: "ProjectTask",
    unit: "minutes"
  },
  projectsTouched: {
    key: "projectsTouched",
    label: "Dự án có hoạt động",
    formula: "COUNT(DISTINCT projectId) with reviewed approved work OR assigned task activity OR effective allocation in range",
    numerator: "distinct projects",
    denominator: "—",
    exclusions: "projects outside the authorized row scope",
    rounding: "integer",
    source: "TaskTimeEntry + ProjectTask + ResourceAllocation",
    unit: "count"
  },
  taskCompletionRate: {
    key: "taskCompletionRate",
    label: "Tỷ lệ task hoàn thành trong kỳ",
    formula: "completed eligible leaf tasks / eligible leaf tasks in scope",
    numerator: "eligible leaf tasks completed in range",
    denominator: "eligible leaf tasks in scope; 0 → N/A; any completed-status task missing completedAt makes the rate unavailable",
    exclusions: "parent tasks, archived and cancelled tasks; missing completion timestamps are surfaced as incomplete coverage",
    rounding: "0.1 percentage point",
    source: "ProjectTask",
    unit: "percent"
  },
  onTimeCompletionRate: {
    key: "onTimeCompletionRate",
    label: "Hoàn thành đúng hạn",
    formula: "tasks with completedAt <= dueAt / tasks completed in range having both dates",
    numerator: "on-time completions",
    denominator: "completions with both dueAt and completedAt; 0 → N/A",
    exclusions: "tasks missing dueAt (reported via dueDateCoverage)",
    rounding: "0.1 percentage point",
    source: "ProjectTask",
    unit: "percent"
  },
  dueDateCoverage: {
    key: "dueDateCoverage",
    label: "Độ phủ due date",
    formula: "completed tasks having dueAt / completed tasks in range",
    numerator: "completions with dueAt",
    denominator: "completions in range; 0 → N/A",
    exclusions: "—",
    rounding: "0.1 percentage point",
    source: "ProjectTask",
    unit: "percent"
  },
  estimateVarianceMinutes: {
    key: "estimateVarianceMinutes",
    label: "Chênh lệch estimate",
    formula: "actualMinutes − estimate minutes for eligible tasks with estimate > 0",
    numerator: "actual − estimate",
    denominator: "estimate (percentage form only when estimate > 0)",
    exclusions: "tasks with estimate 0 are excluded from percentage form",
    rounding: "integer minutes",
    source: "TaskTimeEntry + ProjectTask",
    unit: "minutes"
  },
  medianCycleTimeDays: {
    key: "medianCycleTimeDays",
    label: "Cycle time trung vị",
    formula: "median(completedAt − startedAt) for tasks completed in range having both dates",
    numerator: "median days",
    denominator: "—",
    exclusions: "tasks missing startedAt or completedAt",
    rounding: "0.1 day",
    source: "ProjectTask",
    unit: "days"
  },
  overdueTasks: {
    key: "overdueTasks",
    label: "Task quá hạn",
    formula: "COUNT(open eligible tasks with dueAt < asOf)",
    numerator: "overdue open tasks",
    denominator: "—",
    exclusions: "completed/cancelled/archived tasks",
    rounding: "integer",
    source: "ProjectTask",
    unit: "count"
  },
  overdueEstimateMinutes: {
    key: "overdueEstimateMinutes",
    label: "Estimate của task quá hạn",
    formula: "SUM(estimateMinutes) of overdue open eligible tasks",
    numerator: "estimate minutes",
    denominator: "—",
    exclusions: "same as overdueTasks",
    rounding: "integer minutes",
    source: "ProjectTask",
    unit: "minutes"
  },
  blockedTasks: {
    key: "blockedTasks",
    label: "Task đang blocked",
    formula: "COUNT(open eligible tasks with status='blocked')",
    numerator: "blocked tasks",
    denominator: "—",
    exclusions: "archived/cancelled",
    rounding: "integer",
    source: "ProjectTask",
    unit: "count"
  },
  overbookedPeople: {
    key: "overbookedPeople",
    label: "Người bị overbook",
    formula: "COUNT(users with allocation minutes > capacity minutes in range)",
    numerator: "overbooked users",
    denominator: "users with known capacity (coverage reported)",
    exclusions: "users without known capacity are excluded and counted as missing coverage",
    rounding: "integer",
    source: "ResourceAllocation + capacity",
    unit: "count"
  },
  reworkShare: {
    key: "reworkShare",
    label: "Tỷ trọng rework",
    formula: "recorded workType='rework' minutes / actualMinutes",
    numerator: "rework minutes",
    denominator: "actualMinutes; 0 → N/A",
    exclusions: "unavailable until the work-type vocabulary is normalized; reported partial with the observed vocabulary",
    rounding: "0.1 percentage point",
    source: "TaskTimeEntry",
    unit: "percent"
  }
};

export interface AnalyticsMetricCoverage {
  covered: number;
  total: number;
  description?: string;
}

export interface AnalyticsMetricValue {
  key: AnalyticsMetricKey;
  state: AnalyticsMetricState;
  value: number | null;
  numerator?: number | null;
  denominator?: number | null;
  coverage?: AnalyticsMetricCoverage;
  previousValue?: number | null;
  deltaPercent?: number | null;
  warnings?: string[];
}

export interface AnalyticsSeriesBucket {
  bucketStart: string;
  bucketLabel: string;
  actualMinutes: number;
  /** @deprecated Compatibility alias; use actualMinutes. */
  reviewedApprovedMinutes: number;
  legacyApprovedMinutes: number;
  submittedMinutes: number;
  billableMinutes: number;
  scheduledMinutes: number;
  allocationMinutes: number;
  capacityMinutes: number | null;
  tasksCompleted: number;
}

export interface AnalyticsSavedView {
  id: string;
  name: string;
  searchState: string;
  updatedAt: string;
}

export type AnalyticsBreakdownBy = "user" | "project" | "department" | "team";

export interface AnalyticsBreakdownRow {
  id: string;
  label: string;
  kind: AnalyticsBreakdownBy;
  href?: string;
  pseudonymized?: boolean;
  suppressed?: boolean;
  memberCount?: number;
  accountLabel?: string;
  status?: string;
  metrics: Partial<Record<AnalyticsMetricKey, number | null>>;
  states?: Partial<Record<AnalyticsMetricKey, AnalyticsMetricState>>;
}

export interface AnalyticsQuality {
  usersMissingDepartment: number;
  usersMissingTeam: number;
  usersMissingCapacity: number;
  membershipCoverage: AnalyticsMetricCoverage;
  unassignedActualMinutes: number;
  legacyApprovedMinutes: number;
  excludedTimeEntryRows: number;
  suppressedGroups: number;
  workTypeVocabulary: string[];
}

export interface AnalyticsFilterOption {
  id: string;
  label: string;
  count?: number;
  parentId?: string;
}

export interface AnalyticsTaskTypeBreakdown {
  layer1Id: string;
  layer1Label: string;
  layer2Id: string;
  layer2Label: string;
  actualMinutes: number;
  percentage: number;
}

export interface AnalyticsFilterOptions {
  departments: AnalyticsFilterOption[];
  teams: AnalyticsFilterOption[];
  users: AnalyticsFilterOption[];
  accounts: AnalyticsFilterOption[];
  projects: AnalyticsFilterOption[];
  projectStatuses: AnalyticsFilterOption[];
  taskStatuses: AnalyticsFilterOption[];
  workTypes: AnalyticsFilterOption[];
  taskTypeLayer1: AnalyticsFilterOption[];
  taskTypeLayer2: AnalyticsFilterOption[];
}

export interface WorkforceProjectsAnalyticsFilters {
  from: string;
  to: string;
  timezone: string;
  grain: AnalyticsGrain;
  compare: AnalyticsCompareMode;
  departmentIds: string[];
  teamIds: string[];
  userIds: string[];
  accountIds: string[];
  projectIds: string[];
  projectStatuses: string[];
  taskStatuses: string[];
  workTypes: string[];
  taskTypeLayer1Ids: string[];
  taskTypeLayer2Ids: string[];
  billable: "all" | "billable" | "non_billable";
}

export interface WorkforceProjectsSummaryMeta {
  generatedAt: string;
  asOf: string;
  range: { from: string; to: string };
  compareRange?: { from: string; to: string };
  timezone: string;
  grain: AnalyticsGrain;
  definitionsVersion: string;
  rowScope: AnalyticsRowScope;
  policy: string;
  hiddenFields: string[];
  freshness: "live";
  warnings: string[];
  suppressedGroups: number;
  principal: string;
  source: "postgresql";
  filters: WorkforceProjectsAnalyticsFilters;
}

export interface WorkforceProjectsSummaryResponse {
  meta: WorkforceProjectsSummaryMeta;
  totals: AnalyticsMetricValue[];
  series: AnalyticsSeriesBucket[];
  compareSeries?: AnalyticsSeriesBucket[];
  breakdowns: {
    users: AnalyticsBreakdownRow[];
    projects: AnalyticsBreakdownRow[];
    departments: AnalyticsBreakdownRow[];
    teams: AnalyticsBreakdownRow[];
  };
  taskTypeBreakdowns: AnalyticsTaskTypeBreakdown[];
  quality: AnalyticsQuality;
  filterOptions: AnalyticsFilterOptions;
}

/**
 * Single-snapshot export payload. Unlike the paginated breakdown endpoint,
 * every authorized row for the filtered result is returned in one response.
 */
export interface WorkforceProjectsExportResponse {
  meta: WorkforceProjectsSummaryMeta;
  totals: AnalyticsMetricValue[];
  series: AnalyticsSeriesBucket[];
  compareSeries?: AnalyticsSeriesBucket[];
  breakdowns: {
    users: AnalyticsBreakdownRow[];
    projects: AnalyticsBreakdownRow[];
    departments: AnalyticsBreakdownRow[];
    teams: AnalyticsBreakdownRow[];
  };
  taskTypeBreakdowns: AnalyticsTaskTypeBreakdown[];
  quality: AnalyticsQuality;
}

export const ANALYTICS_BREAKDOWN_SORT_KEYS = [
  "label",
  "actualMinutes",
  "reviewedApprovedMinutes",
  "scheduledMinutes",
  "scheduleVarianceMinutes",
  "allocationMinutes",
  "estimateMinutes",
  "estimateVarianceMinutes",
  "taskCompletionRate",
  "onTimeCompletionRate",
  "overdueTasks",
  "capacityMinutes",
  "actualUtilization"
] as const;

export type AnalyticsBreakdownSortKey = (typeof ANALYTICS_BREAKDOWN_SORT_KEYS)[number];

export interface WorkforceProjectsBreakdownResponse {
  meta: WorkforceProjectsSummaryMeta & {
    by: AnalyticsBreakdownBy;
    sort: AnalyticsBreakdownSortKey;
    direction: "asc" | "desc";
    limit: number;
    totalRows: number;
  };
  rows: AnalyticsBreakdownRow[];
  totals: Partial<Record<AnalyticsMetricKey, number | null>>;
  nextCursor?: string;
}


export interface ProjectMemberDirectoryResponse {
  data: Array<{ userId: string; displayName: string; email: string; avatarUrl?: string; status: "active"; roleCodes: string[] }>;
  meta: { pagination: ResourceListPaginationMeta; permissions: { canManage: boolean; canLogForOthers: boolean }; principalUserId: string };
}
export interface TaskAssignmentHistoryResponse {
  data: Array<{ id: string; changedByUserId: string | null; changedAt: string;
    before: { ownerUserId: string | null; assigneeUserId: string | null };
    after: { ownerUserId: string | null; assigneeUserId: string | null } }>;
  meta: { pagination: ResourceListPaginationMeta };
}

export type WorkspaceReminderSlotCode = "morning_plan" | "pm_follow_up" | "evening_actual";

export interface WorkspaceReminderSlot {
  slot: WorkspaceReminderSlotCode;
  time: string;
  label: string;
  enabled: boolean;
}

export interface WorkspaceReminderPolicy {
  enabled: boolean;
  timezone: string;
  weekdaysOnly: boolean;
  slots: WorkspaceReminderSlot[];
  updatedAt?: string;
}

export interface AdminOverviewAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  href?: string;
}

export interface AdminOverviewResponse {
  data: {
    workspace: { id: string; name: string; timezone: string };
    metrics: {
      activeDayOffs: number;
      upcomingDayOffs: number;
      overdueTasks: number;
      openTasks: number;
    };
    alerts: AdminOverviewAlert[];
    reminderPolicy: WorkspaceReminderPolicy;
  };
}

export type AdminAlertType = "delay_risk" | "over_estimate" | "waiting_task" | "missing_estimate" | "missing_actual" | "missing_deadline" | "missing_mapping";

export interface AdminAlertDetailRow {
  id: string;
  type: AdminAlertType;
  severity: "info" | "warning" | "critical";
  project: { id: string; code: string; name: string };
  estimateMinutes: number;
  actualMinutes: number;
  varianceMinutes: number;
  affectedTaskCount: number;
  detail: string;
  taskIds: string[];
  href: string;
}

export interface AdminAlertsResponse {
  data: AdminAlertDetailRow[];
  meta: {
    total: number;
    generatedAt: string;
    counts: Partial<Record<AdminAlertType, number>>;
  };
}

export interface UpdateWorkspaceReminderPolicyInput {
  enabled?: boolean;
  weekdaysOnly?: boolean;
  slots: Array<{ slot: WorkspaceReminderSlotCode; time: string; enabled: boolean }>;
}

export interface WorkspaceReminderRecipientOption {
  id: string;
  displayName: string;
  teamIds: string[];
}

export interface WorkspaceReminderTeamOption {
  id: string;
  name: string;
  memberCount: number;
}

export interface WorkspaceReminderRecipientsResponse {
  data: {
    users: WorkspaceReminderRecipientOption[];
    teams: WorkspaceReminderTeamOption[];
  };
}

export interface SendWorkspaceReminderInput {
  localDate: string;
  slot: WorkspaceReminderSlotCode;
  userId?: string;
  teamId?: string;
}

export interface SendWorkspaceReminderResponse {
  data: {
    sent: boolean;
    localDate: string;
    slot: WorkspaceReminderSlotCode;
    recipientCount: number;
    recipientNames: string[];
  };
}
