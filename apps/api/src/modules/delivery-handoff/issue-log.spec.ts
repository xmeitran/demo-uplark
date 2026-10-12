import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  allowedActions,
  assertRequiredOnCreate,
  countsTowardProjectAtRisk,
  issueLogAgeDays,
  issueLogCode,
  issueLogDueState,
  issueLogWarnings,
  parseIssueLogType,
  planTransition,
  sanitizeExtension,
  type IssueLogActor,
  type IssueLogRecordState
} from "./issue-log";

const none: IssueLogActor = { userId: "usr-x", isAdmin: false, isPm: false, isBd: false, isMember: false };
const member: IssueLogActor = { ...none, userId: "usr-member", isMember: true };
const owner: IssueLogActor = { ...none, userId: "usr-owner", isMember: true };
const pm: IssueLogActor = { ...none, userId: "usr-pm", isPm: true, isMember: true };
const admin: IssueLogActor = { ...none, userId: "usr-admin", isAdmin: true, isPm: true };
const bd: IssueLogActor = { ...none, userId: "usr-bd", isBd: true, isMember: true };
const now = new Date("2026-10-12T03:00:00.000Z");

const issue = (patch: Partial<IssueLogRecordState> = {}): IssueLogRecordState => ({ id: "r1", code: "ISS-001", type: "issue", status: "pending", severity: "medium", ownerUserId: "usr-owner", extension: { actualImpact: "Trễ 2 ngày" }, ...patch });
const cr = (crStep: string, status: string, extension: Record<string, unknown> = {}): IssueLogRecordState => ({ id: "c1", code: "CR-001", type: "change_request", status, crStep, extension });
const names = (record: IssueLogRecordState, actor: IssueLogActor) => allowedActions(record, actor).map((action) => action.action);

describe("issue log types and codes", () => {
  it("accepts the four types and maps legacy categories", () => {
    expect(parseIssueLogType("Blocker")).toBe("blocker");
    expect(parseIssueLogType("change_request")).toBe("change_request");
    expect(parseIssueLogType("Operational")).toBe("risk");
    expect(() => parseIssueLogType("Whatever")).toThrow(BadRequestException);
  });

  it("formats codes with the prefix of the type", () => {
    expect(issueLogCode("blocker", 1)).toBe("BLK-001");
    expect(issueLogCode("risk", 12)).toBe("RSK-012");
    expect(issueLogCode("issue", 3)).toBe("ISS-003");
    expect(issueLogCode("change_request", 1234)).toBe("CR-1234");
  });
});

describe("required fields per type (V-24)", () => {
  it("names what each type is missing", () => {
    expect(() => assertRequiredOnCreate("blocker", { type: "blocker", status: "pending", extension: {} })).toThrow(/Nguyên nhân/);
    expect(() => assertRequiredOnCreate("issue", { type: "issue", status: "pending", extension: {} })).toThrow(/Tác động đã xảy ra/);
    expect(() => assertRequiredOnCreate("risk", { type: "risk", status: "pending", likelihood: "", extension: {} })).toThrow(/Khả năng xảy ra/);
    expect(() => assertRequiredOnCreate("change_request", { type: "change_request", status: "new", extension: { requesterName: "Chị Lan" } })).toThrow(/Kênh tiếp nhận, Lý do thay đổi/);
    expect(() => assertRequiredOnCreate("risk", { type: "risk", status: "pending", likelihood: "High", extension: {} })).not.toThrow();
  });

  it("keeps only defined fields, validates their kind and guards commercial ones (V-32)", () => {
    expect(sanitizeExtension("blocker", { causeSide: "customer", unblockDueAt: "2026-10-20T00:00:00Z", junk: 1 }, member).extension).toEqual({ causeSide: "customer", unblockDueAt: "2026-10-20" });
    expect(() => sanitizeExtension("blocker", { causeSide: "nobody" }, member)).toThrow(BadRequestException);
    expect(() => sanitizeExtension("change_request", { estimatedEffortMd: "nhiều" }, pm)).toThrow(/phải là số/);
    expect(() => sanitizeExtension("change_request", { feeOption: "T&M" }, member)).toThrow(ForbiddenException);
    expect(sanitizeExtension("change_request", { feeOption: "T&M", actualEffortMd: 9 }, bd).extension).toEqual({ feeOption: "T&M" });
    expect(sanitizeExtension("risk", { likelihood: "High", response: "Thêm người" }, member)).toEqual({ extension: {}, columns: { likelihood: "High", response: "Thêm người" } });
  });
});

describe("Blocker / Risk / Issue lifecycle (5.4, V-31)", () => {
  it("only offers the transitions of the current state to the right people", () => {
    expect(names(issue(), member)).toEqual([]);
    expect(names(issue(), owner)).toEqual(["start", "escalate"]);
    expect(names(issue(), pm)).toEqual(["start", "reclassify", "escalate"]);
    expect(names(issue({ status: "in_progress" }), owner)).toEqual(["propose_resolve", "escalate"]);
    expect(names(issue({ status: "in_progress" }), pm)).toEqual(["resolve", "accept", "escalate"]);
    expect(names(issue({ status: "resolved" }), pm)).toEqual([]);
    expect(names(issue({ status: "resolved" }), admin)).toEqual(["cancel"]);
    expect(names(issue({ status: "cancelled" }), admin)).toEqual([]);
  });

  it("cannot skip Đang xử lý or be resolved by someone who is not the PM", () => {
    expect(() => planTransition(issue(), pm, { action: "resolve", resolutionEvidence: "x" })).toThrow(BadRequestException);
    expect(() => planTransition(issue({ status: "in_progress" }), owner, { action: "resolve", resolutionEvidence: "x" })).toThrow(ForbiddenException);
  });

  it("needs an owner to start", () => {
    expect(() => planTransition(issue({ ownerUserId: null }), pm, { action: "start" })).toThrow(/Người chịu trách nhiệm/);
    const plan = planTransition(issue({ ownerUserId: null }), pm, { action: "start", ownerUserId: "usr-owner" });
    expect(plan.data).toMatchObject({ status: "in_progress", ownerUserId: "usr-owner" });
  });

  it("resolves only with evidence: the owner reports, the PM confirms", () => {
    const working = issue({ status: "in_progress" });
    expect(() => planTransition(working, owner, { action: "propose_resolve" })).toThrow(/Bằng chứng xử lý/);
    const proposed = planTransition(working, owner, { action: "propose_resolve", resolutionEvidence: "https://lark/doc" }, now);
    expect(proposed.data).toMatchObject({ status: "in_progress", resolutionEvidence: "https://lark/doc", resolutionProposedAt: now });
    expect(() => planTransition(working, pm, { action: "resolve" })).toThrow(/Bằng chứng xử lý/);
    const confirmed = planTransition({ ...working, resolutionEvidence: "https://lark/doc", resolutionProposedAt: now }, pm, { action: "resolve" }, now);
    expect(confirmed.data).toMatchObject({ status: "resolved", closedAt: now });
  });

  it("accepts only after both the PM and a leader agreed, with reason and impact area", () => {
    const working = issue({ status: "in_progress" });
    expect(() => planTransition(working, pm, { action: "accept", note: "Không đáng xử lý" })).toThrow(/Loại ảnh hưởng/);
    const first = planTransition(working, pm, { action: "accept", note: "Không đáng xử lý", impactArea: "cost" });
    expect(first.data).toMatchObject({ status: "in_progress", acceptPmUserId: "usr-pm", impactArea: "cost" });
    const afterPm = { ...working, acceptPmUserId: "usr-pm", impactArea: "cost" };
    expect(names(afterPm, pm)).not.toContain("accept");
    expect(planTransition(afterPm, admin, { action: "accept", note: "Đồng ý" }, now).data).toMatchObject({ status: "accepted", acceptLeaderUserId: "usr-admin", closedAt: now });
    // One admin alone is not two people.
    const alone = planTransition(working, admin, { action: "accept", note: "x", impactArea: "scope" });
    expect(alone.data).toMatchObject({ status: "in_progress", acceptLeaderUserId: "usr-admin" });
  });

  it("escalates by impact area: resource/delivery to Dx Director, the rest to BD Lead", () => {
    expect(() => planTransition(issue(), pm, { action: "escalate", impactArea: "resource" })).toThrow(/Lý do/);
    expect(planTransition(issue(), pm, { action: "escalate", impactArea: "resource", note: "Thiếu dev" }).data.escalationLevel).toBe("dx_director");
    const toBd = planTransition(issue(), owner, { action: "escalate", impactArea: "customer_commitment", note: "Trễ go-live" });
    expect(toBd.data.escalationLevel).toBe("bd_lead");
    expect(toBd.hooks).toContain("notifyEscalation");
  });

  it("is cancelled with a reason by an admin only, never deleted", () => {
    expect(() => planTransition(issue(), pm, { action: "cancel", note: "Nhập nhầm" })).toThrow(ForbiddenException);
    expect(() => planTransition(issue(), admin, { action: "cancel" })).toThrow(/Lý do/);
    expect(planTransition(issue(), admin, { action: "cancel", note: "Nhập nhầm" }, now).data).toMatchObject({ status: "cancelled", cancelReason: "Nhập nhầm", closedAt: now });
  });

  it("lets the PM classify a pending record as a change request, entering at CR-02 with the CR fields", () => {
    expect(() => planTransition(issue(), pm, { action: "reclassify", targetType: "change_request" })).toThrow(/Người yêu cầu/);
    const plan = planTransition(issue(), pm, { action: "reclassify", targetType: "change_request", extension: { requesterName: "Chị Lan", intakeChannel: "email", changeReason: "Thêm báo cáo" } });
    expect(plan).toMatchObject({ newType: "change_request", toStatus: "assessing", toStep: "CR-02", stepSlaDays: 1 });
    expect(() => planTransition(issue(), owner, { action: "reclassify", targetType: "risk" })).toThrow(ForbiddenException);
  });
});

describe("change request steps (8.2)", () => {
  const base = { requesterName: "Chị Lan", intakeChannel: "email", changeReason: "Thêm báo cáo" };

  it("walks CR-01 → CR-09 on the Case 1 branch, asking each step for its output", () => {
    let record = cr("CR-01", "new", base);
    const step = (actor: IssueLogActor, action: string, extension: Record<string, unknown> = {}, more: Record<string, unknown> = {}) => {
      const plan = planTransition(record, actor, { action, extension, ...more } as any, now);
      record = { ...record, ...plan.data, extension: plan.extension } as IssueLogRecordState;
      return plan;
    };
    expect(step(pm, "advance")).toMatchObject({ toStep: "CR-02", toStatus: "assessing", stepSlaDays: undefined });
    expect(() => planTransition(record, pm, { action: "advance" })).toThrow(/Baseline liên quan/);
    expect(step(pm, "advance", { baselineRef: "B1" })).toMatchObject({ toStep: "CR-03", stepSlaDays: 3, hooks: ["onChangeRequestClassified"] });
    expect(() => planTransition(record, member, { action: "advance", extension: { technicalImpact: "Sửa module báo cáo" } })).toThrow(/Effort dự kiến/);
    expect(step(member, "advance", { technicalImpact: "Sửa module báo cáo", estimatedEffortMd: 5, timelineImpactDays: 3, resourceImpact: "1 dev" })).toMatchObject({ toStep: "CR-04", stepSlaDays: 2 });
    expect(() => planTransition(record, member, { action: "advance" })).toThrow(ForbiddenException);
    expect(step(pm, "advance", { proposedTimeline: "Thêm 1 tuần", newAcceptanceCriteria: "Báo cáo chạy đúng" })).toMatchObject({ toStep: "CR-G1", toStatus: "assessing" });
    expect(step(pm, "advance", { commercialCase: "case_1", caseBasis: "Trong khung giá PM" })).toMatchObject({ toStep: "CR-05A", toStatus: "assessing" });
    expect(step(pm, "advance", { costImpact: "5 MD", feeOption: "T&M" })).toMatchObject({ toStep: "CR-06", toStatus: "customer_approval" });
    expect(step(pm, "advance")).toMatchObject({ toStep: "CR-07", toStatus: "customer_approval" });
    // V-29: no approval without evidence.
    expect(names(record, pm)).toEqual(["approve", "request_revision", "reject", "defer"]);
    expect(() => planTransition(record, pm, { action: "approve", extension: { customerApprovedAt: "2026-10-12" } })).toThrow(/Bằng chứng duyệt/);
    expect(step(pm, "approve", { approvalEvidence: "email 12/10", customerApprovedAt: "2026-10-12", customerApproverName: "Anh Nam" })).toMatchObject({ toStep: "CR-07C", toStatus: "approved", hooks: ["onChangeRequestApproved"] });
    expect(step(member, "advance")).toMatchObject({ toStep: "CR-08A", toStatus: "implementing", stepSlaDays: 2 });
    expect(step(member, "advance")).toMatchObject({ toStep: "CR-08B", hooks: ["onChangeRequestSolutionVersion"] });
    // "Phiên bản baseline mới" is computed (V-30): it is not asked for, and a typed value is ignored.
    const toImplementation = step(pm, "advance", { newBaselineVersion: "typed by hand" });
    expect(toImplementation).toMatchObject({ toStep: "CR-08C", stepSlaDays: null, hooks: ["onChangeRequestBaselineUpdate"] });
    expect(toImplementation.extension.newBaselineVersion).toBeUndefined();
    expect(() => planTransition(record, pm, { action: "advance" })).toThrow(/Bằng chứng đóng/);
    expect(step(pm, "advance", { closeEvidence: "Biên bản UAT" })).toMatchObject({ toStep: "CR-09", toStatus: "closed", hooks: ["computeChangeRequestActualEffort"] });
    expect(record.closedAt).toBe(now);
    expect(names(record, pm)).toEqual([]);
  });

  it("routes Case 2 through commercial review, which the project's BD may complete", () => {
    const atGate = cr("CR-G1", "assessing", base);
    expect(planTransition(atGate, pm, { action: "advance", extension: { commercialCase: "case_2", caseBasis: "Khách Enterprise" } })).toMatchObject({ toStep: "CR-05B", toStatus: "commercial_review" });
    const review = cr("CR-05B", "commercial_review", { ...base, commercialCase: "case_2" });
    expect(names(review, member)).toEqual([]);
    expect(() => planTransition(review, bd, { action: "advance", extension: { costImpact: "10 MD", feeOption: "Phụ lục" } })).toThrow(/Ảnh hưởng HĐ/);
    expect(planTransition(review, bd, { action: "advance", extension: { costImpact: "10 MD", feeOption: "Phụ lục", contractImpact: "Phụ lục 02" } })).toMatchObject({ toStep: "CR-06", toStatus: "customer_approval" });
  });

  it("ends with a reason on Không phải CR, Từ chối and Hoãn; a revision goes back to assessment", () => {
    expect(() => planTransition(cr("CR-02", "assessing", base), pm, { action: "not_cr" })).toThrow(/Lý do/);
    expect(planTransition(cr("CR-02", "assessing", base), pm, { action: "not_cr", note: "Là lỗi", convertTo: "issue" }, now)).toMatchObject({ toStatus: "not_cr", convertTo: "issue" });
    expect(() => planTransition(cr("CR-03", "assessing", base), pm, { action: "not_cr", note: "x" })).toThrow(BadRequestException);
    const waiting = cr("CR-07", "customer_approval", { ...base, commercialCase: "case_2" });
    expect(() => planTransition(waiting, pm, { action: "reject" })).toThrow(/Lý do/);
    expect(planTransition(waiting, bd, { action: "reject", note: "Khách không đồng ý phí" }, now)).toMatchObject({ toStatus: "rejected", hooks: ["onChangeRequestStageClosed"] });
    expect(planTransition(waiting, pm, { action: "defer", note: "Khách hoãn sang quý sau" }, now).data).toMatchObject({ status: "deferred", closedAt: now });
    expect(planTransition(waiting, pm, { action: "request_revision", note: "Giảm phạm vi", targetStep: "CR-04" })).toMatchObject({ toStep: "CR-04", toStatus: "assessing" });
    expect(planTransition(waiting, pm, { action: "request_revision", note: "Giảm phí", targetStep: "CR-05" })).toMatchObject({ toStep: "CR-05B", toStatus: "commercial_review" });
  });
});

describe("due state, age and warnings", () => {
  it("derives Chưa đặt hạn / Trong hạn / Quá hạn by Vietnam date and freezes at closing", () => {
    expect(issueLogDueState(issue(), now)).toBe("no_due");
    expect(issueLogDueState(issue({ dueAt: new Date("2026-10-12T00:00:00.000Z") }), now)).toBe("on_time");
    expect(issueLogDueState(issue({ dueAt: new Date("2026-10-11T00:00:00.000Z") }), now)).toBe("overdue");
    expect(issueLogDueState(issue({ dueAt: new Date("2026-10-11T00:00:00.000Z"), closedAt: new Date("2026-10-10T03:00:00.000Z") }), now)).toBe("on_time");
    expect(issueLogDueState({ ...cr("CR-03", "assessing"), stepDueAt: new Date("2026-10-09T16:59:59.999Z") }, now)).toBe("overdue");
    expect(issueLogAgeDays(issue({ createdAt: new Date("2026-10-09T03:00:00.000Z") }), now)).toBe(3);
  });

  it("raises BRI-01/02/03 for open Blocker/Risk/Issue and nothing once handled", () => {
    const record = { ...issue({ dueAt: new Date("2026-10-01T00:00:00.000Z"), severity: "critical" }), id: "r1", code: "ISS-001" };
    expect(issueLogWarnings(record, now).map((warning) => warning.dedupeKey)).toEqual(["BRI-01:r1", "BRI-02:r1", "BRI-03:r1"]);
    expect(issueLogWarnings({ ...record, dueAt: null, severity: "low" }, now).map((warning) => warning.typeCode)).toEqual(["BRI-01"]);
    expect(issueLogWarnings({ ...record, status: "resolved" }, now)).toEqual([]);
    expect(issueLogWarnings({ ...record, status: "accepted" }, now)).toEqual([]);
  });

  it("raises YC-01 per overdue step and never treats a change request as a project risk", () => {
    const request = { ...cr("CR-03", "assessing"), id: "c1", code: "CR-001", stepDueAt: new Date("2026-10-09T16:59:59.999Z") };
    expect(issueLogWarnings(request, now)).toMatchObject([{ dedupeKey: "YC-01:c1:CR-03", typeCode: "YC-01" }]);
    expect(issueLogWarnings({ ...request, stepDueAt: new Date("2026-10-20T16:59:59.999Z") }, now)).toEqual([]);
    expect(countsTowardProjectAtRisk(request)).toBe(false);
    expect(countsTowardProjectAtRisk(issue())).toBe(true);
    expect(countsTowardProjectAtRisk(issue({ status: "accepted" }))).toBe(false);
  });
});
