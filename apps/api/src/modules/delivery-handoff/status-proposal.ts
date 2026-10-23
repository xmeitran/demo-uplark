/**
 * The project status the rules imply (5.1, V-17…V-19). Pure: computeProjectStatus turns facts into a status,
 * planStatusSync decides what to do with it — apply it (the two statuses the document marks "Hệ thống tự chuyển")
 * or store it as a proposal a person confirms. Persistence is in gates.service.ts.
 */
import { isGatePassed } from "./gates";
import { PROJECT_STATUS_CATALOGUE, normalizeProjectStatus, type ProjectStatusCode } from "./project-status";

export interface ProjectStatusFacts {
  currentStatus: unknown;
  /** G1–G8 of the project; null for a project on a hand-built framework (its position is not known). */
  gates: ReadonlyArray<{ code: string; status: string }> | null;
  /** Hand-built framework only (no G1–G8): its own milestones, so approving them still moves the project. */
  milestones?: { total: number; approved: number; started: boolean } | null;
  /** Stage Pilot / Onboard already has a time log. */
  pilotHasTimeLog: boolean;
  onboardHasTimeLog: boolean;
  /** Codes of open Blocker / Risk / Issue records. Change requests never count (5.1). */
  openIssueCodes: readonly string[];
  /** Codes of open customer-side Blockers that name what they block (V-26). */
  customerBlockerCodes?: readonly string[];
  overdueTaskCount: number;
  /** Open high-severity delay warnings ("cảnh báo nguy cơ chậm mức Cao"). */
  highDelayWarningCount: number;
  /** The project is Tạm dừng because of a customer wait (not because both sides agreed to pause). */
  holdIsCustomerWait: boolean;
}

export interface ComputedProjectStatus {
  status: ProjectStatusCode;
  /** "Căn cứ" of `status`. */
  basis: string;
  /** Status by position / gates alone, before Có rủi ro and Tạm dừng are laid over it; null when unknown. */
  base: ProjectStatusCode | null;
  baseBasis: string;
  /** The document applies it without confirmation. */
  automatic: boolean;
  suggestedReason?: string;
}

/** "Hệ thống tự chuyển" in table 5.1. */
export const AUTOMATIC_PROJECT_STATUSES: readonly ProjectStatusCode[] = ["completed", "maintenance"];
/** Reason prefixes of a status the system's rule set: applied by itself, or proposed and confirmed by a person. */
export const AUTOMATIC_REASON = "Hệ thống tự chuyển";
export const CONFIRMED_SYSTEM_REASON = "Xác nhận đề xuất hệ thống";
/** Reason prefix of a Tạm dừng caused by a customer wait; planStatusSync and the service recognise the hold by it. */
export const CUSTOMER_WAIT_REASON = "Chờ khách xác nhận tại";
/** Reason prefix of a Tạm dừng proposed for a customer-side Blocker (V-26); the hold ends with the Blocker, like a customer wait. */
export const CUSTOMER_BLOCKER_REASON = "Blocker phía khách chặn tiến độ";

/** V-26: the Blocker is the customer's to remove and names the task or milestone it stops. */
export function isProgressBlockingCustomerBlocker(record: { type: string; extension?: unknown }): boolean {
  const extension = (record.extension && typeof record.extension === "object" ? record.extension : {}) as Record<string, unknown>;
  return record.type === "blocker" && extension.causeSide === "customer" && String(extension.blockedItem ?? "").trim() !== "";
}

function positionStatus(facts: ProjectStatusFacts): { base: ProjectStatusCode | null; baseBasis: string } {
  if (!facts.gates) {
    const own = facts.milestones;
    if (!own?.total) return { base: null, baseBasis: "" };
    if (own.approved >= own.total) return { base: "completed", baseBasis: `Cả ${own.total} milestone của dự án đã được duyệt` };
    // Hand-built milestones carry no Pilot / Onboard / acceptance stage: one the PM set by hand stays (no "Đang triển khai" nag).
    const current = normalizeProjectStatus(facts.currentStatus);
    if (current === "pilot" || current === "onboarding" || current === "in_review") return { base: current, baseBasis: "Trạng thái PM đặt cho dự án tự dựng milestone" };
    // No count in the basis: it becomes the status reason, which would go stale with the next approval.
    if (own.approved > 0) return { base: "active", baseBasis: "Còn milestone chưa được duyệt" };
    return own.started ? { base: "active", baseBasis: "Dự án đã bắt đầu thực hiện" } : { base: "planning", baseBasis: "Chưa milestone nào bắt đầu" };
  }
  const status = (code: string) => facts.gates?.find((gate) => gate.code === code)?.status;
  // One meaning of "passed" (isGatePassed): approved, or opened by the audited exception.
  if (isGatePassed(status("G8"))) return { base: "maintenance", baseBasis: status("G8") === "approved" ? "G8 đã duyệt, đã bàn giao CS" : "G8 mở theo ngoại lệ, đã bàn giao CS" };
  if (isGatePassed(status("G7"))) return { base: "completed", baseBasis: status("G7") === "approved" ? "G7 đã duyệt" : "G7 mở theo ngoại lệ" };
  if (status("G7") === "submitted" || status("G7") === "awaiting_customer") return { base: "in_review", baseBasis: "Biên bản nghiệm thu đã nộp, đang chờ duyệt" };
  if (facts.onboardHasTimeLog) return { base: "onboarding", baseBasis: "Stage Onboard bắt đầu có giờ log" };
  if (facts.pilotHasTimeLog) return { base: "pilot", baseBasis: "Stage Pilot bắt đầu có giờ log" };
  const g1 = status("G1");
  if (g1 === "approved" || g1 === "exception") return { base: "active", baseBasis: g1 === "approved" ? "G1 đã duyệt" : "G1 mở theo ngoại lệ" };
  return { base: "planning", baseBasis: "Dự án đang ở Milestone 1" };
}

/**
 * Precedence of 5.1: Đã đóng, Có rủi ro, Tạm dừng, Đang bảo trì / Đã hoàn thành, then the status by position.
 * Returns null when the rules have nothing to say (unknown position and no risk).
 */
export function computeProjectStatus(facts: ProjectStatusFacts): ComputedProjectStatus | null {
  const current = normalizeProjectStatus(facts.currentStatus);
  const { base, baseBasis } = positionStatus(facts);
  const result = (status: ProjectStatusCode, basis: string, suggestedReason?: string): ComputedProjectStatus => ({
    status, basis, base, baseBasis, automatic: AUTOMATIC_PROJECT_STATUSES.includes(status), ...(suggestedReason ? { suggestedReason } : {})
  });

  if (current === "closed") return result("closed", "Đã đóng là trạng thái cuối, không bị điều kiện nào đè");

  // V-26: "Blocker phía khách (đề xuất Tạm dừng nếu chặn tiến độ)". The specific rule decides what is proposed for
  // such a record instead of the general "Có rủi ro"; it is still only a proposal a person confirms.
  if (facts.customerBlockerCodes?.length) {
    const basis = `${CUSTOMER_BLOCKER_REASON}: ${facts.customerBlockerCodes.join(", ")}`;
    return result("on_hold", basis, basis);
  }

  const risks: string[] = [];
  if (facts.openIssueCodes.length) risks.push(`Blocker/Risk/Issue đang mở: ${facts.openIssueCodes.join(", ")}`);
  if (facts.overdueTaskCount > 0) risks.push(`${facts.overdueTaskCount} task Quá hạn`);
  if (facts.highDelayWarningCount > 0) risks.push(`${facts.highDelayWarningCount} cảnh báo nguy cơ chậm mức Cao`);
  // V-18: Có rủi ro needs an action or a blocker. Open records are the blocker; overdue tasks alone need a typed action.
  if (risks.length) return result("at_risk", risks.join("; "), facts.openIssueCodes.length ? risks[0] : undefined);

  const waiting = facts.gates?.find((gate) => gate.status === "awaiting_customer");
  if (waiting) return result("on_hold", `${CUSTOMER_WAIT_REASON} ${waiting.code}`, `${CUSTOMER_WAIT_REASON} ${waiting.code}`);
  // A pause both sides agreed on ends only when a person says so.
  if (current === "on_hold" && !facts.holdIsCustomerWait) return result("on_hold", "Hai bên thống nhất tạm dừng");

  return base ? result(base, baseBasis) : null;
}

export interface StatusSyncPlan {
  /** Automatic transitions, in order; each gets a ProjectStatusHistory row. */
  apply: Array<{ to: ProjectStatusCode; reason: string }>;
  /** The proposal that should be pending afterwards, if any. */
  propose?: { proposedStatus: ProjectStatusCode; basis: string; suggestedReason?: string };
}

function mayAutoApply(current: ProjectStatusCode | null, to: ProjectStatusCode) {
  // Never automatically step back from Đang bảo trì to Đã hoàn thành. A Có rủi ro stays until a person lifts it: the way
  // back is proposed, not forced (a hand-set Có rủi ro used to be undone in the same request). A hold both sides agreed on
  // is already kept by computeProjectStatus; a customer-wait hold ends by itself.
  return current !== "closed" && current !== to && !(current === "maintenance" && to === "completed") && current !== "at_risk";
}

/**
 * `lastDeclined` is the most recent declined proposal: the same status on the same basis is not proposed again
 * until the basis changes. `currentSetBySystem`: the current status came from an automatic transition, not a person.
 */
export function planStatusSync(currentStatus: unknown, computed: ComputedProjectStatus | null, lastDeclined?: { proposedStatus: string; basis: string } | null, currentSetBySystem = false): StatusSyncPlan {
  const plan: StatusSyncPlan = { apply: [] };
  let current = normalizeProjectStatus(currentStatus);
  if (!computed || current === "closed") return plan;
  const auto = (to: ProjectStatusCode, basis: string) => {
    plan.apply.push({ to, reason: `${AUTOMATIC_REASON}: ${basis}` });
    current = to;
  };

  // The rule behind an automatic Đã hoàn thành / Đang bảo trì no longer holds (a milestone was added or reopened):
  // the system takes back its own transition. One a person set stays theirs.
  if (currentSetBySystem && current && AUTOMATIC_PROJECT_STATUSES.includes(current) && computed.base && !AUTOMATIC_PROJECT_STATUSES.includes(computed.base)) {
    auto(computed.base, `Không còn đủ điều kiện ${statusProposalLabel(current)} — ${computed.baseBasis}`);
  }

  // Chốt 23/10: the position decides Đã hoàn thành / Đang bảo trì (every milestone approved, G7 / G8) even while an issue
  // or overdue task is open: the risk stays a Có rủi ro proposal the PM confirms or declines, so a decline no longer
  // leaves the project on a stale earlier status. A hold both sides agreed on still wins.
  const agreedHold = current === "on_hold" && computed.status === "on_hold";
  if (computed.base && AUTOMATIC_PROJECT_STATUSES.includes(computed.base) && !agreedHold && mayAutoApply(current, computed.base)) {
    auto(computed.base, computed.baseBasis);
  }
  if (computed.status === current) return plan;
  if (computed.automatic) {
    if (mayAutoApply(current, computed.status)) {
      auto(computed.status, computed.basis);
      return plan;
    }
    // From Có rủi ro, Đã hoàn thành / Đang bảo trì is proposed below; nothing else steps back.
    if (current !== "at_risk") return plan;
  }
  // Counts in the basis ("2 task Quá hạn" → "3 task Quá hạn") are not a new reason to ask again.
  const sameReason = (a: string, b: string) => a.replace(/\d+/g, "#") === b.replace(/\d+/g, "#");
  if (lastDeclined && lastDeclined.proposedStatus === computed.status && sameReason(lastDeclined.basis, computed.basis)) return plan;
  plan.propose = { proposedStatus: computed.status, basis: computed.basis, ...(computed.suggestedReason ? { suggestedReason: computed.suggestedReason } : {}) };
  return plan;
}

/** 5.1 "Ai đặt hoặc xác nhận": the PIC / PM of the project or an Admin (PM, Leader). */
export function canDecideStatusProposal(actor: { isPm: boolean; isAdmin: boolean }): boolean {
  return actor.isPm || actor.isAdmin;
}

export function statusProposalLabel(status: string): string {
  return PROJECT_STATUS_CATALOGUE[status as ProjectStatusCode]?.label ?? status;
}
