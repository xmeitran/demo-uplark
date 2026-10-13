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
const now = new Date("2026-10-12T03:00:00.000Z");

const issue = (patch: Partial<IssueLogRecordState> = {}): IssueLogRecordState => ({ id: "r1", code: "ISS-001", type: "issue", status: "pending", severity: "medium", ownerUserId: "usr-owner", extension: { actualImpact: "Trễ 2 ngày" }, ...patch });
/** A row of the retired type "change_request": still stored, never offered an action or a warning. */
const legacyCr = { id: "c1", code: "CR-001", type: "change_request", status: "assessing", extension: {} } as unknown as IssueLogRecordState;
const names = (record: IssueLogRecordState, actor: IssueLogActor) => allowedActions(record, actor).map((action) => action.action);

describe("issue log types and codes", () => {
  it("accepts the three types and maps legacy categories; change_request is no longer a type", () => {
    expect(parseIssueLogType("Blocker")).toBe("blocker");
    expect(() => parseIssueLogType("change_request")).toThrow(/Blocker, Risk hoặc Issue/);
    expect(parseIssueLogType("Operational")).toBe("risk");
    expect(() => parseIssueLogType("Whatever")).toThrow(BadRequestException);
  });

  it("formats codes with the prefix of the type", () => {
    expect(issueLogCode("blocker", 1)).toBe("BLK-001");
    expect(issueLogCode("risk", 12)).toBe("RSK-012");
    expect(issueLogCode("issue", 3)).toBe("ISS-003");
  });
});

describe("required fields per type (V-24)", () => {
  it("names what each type is missing", () => {
    expect(() => assertRequiredOnCreate("blocker", { type: "blocker", status: "pending", extension: {} })).toThrow(/Nguyên nhân/);
    expect(() => assertRequiredOnCreate("issue", { type: "issue", status: "pending", extension: {} })).toThrow(/Tác động đã xảy ra/);
    expect(() => assertRequiredOnCreate("risk", { type: "risk", status: "pending", likelihood: "", extension: {} })).toThrow(/Khả năng xảy ra/);
    expect(() => assertRequiredOnCreate("risk", { type: "risk", status: "pending", likelihood: "High", extension: {} })).not.toThrow();
  });

  it("keeps only defined fields and validates their kind", () => {
    expect(sanitizeExtension("blocker", { causeSide: "customer", unblockDueAt: "2026-10-20T00:00:00Z", junk: 1, feeOption: "T&M" }).extension).toEqual({ causeSide: "customer", unblockDueAt: "2026-10-20" });
    expect(() => sanitizeExtension("blocker", { causeSide: "nobody" })).toThrow(BadRequestException);
    expect(sanitizeExtension("risk", { likelihood: "High", response: "Thêm người" })).toEqual({ extension: {}, columns: { likelihood: "High", response: "Thêm người" } });
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

  it("reclassifies only between Blocker, Risk and Issue; a change request is not a target, and an old one has no action", () => {
    expect(() => planTransition(issue(), pm, { action: "reclassify", targetType: "change_request" } as any)).toThrow(/Blocker, Risk hoặc Issue/);
    expect(() => planTransition(issue(), pm, { action: "reclassify", targetType: "risk" })).toThrow(/Khả năng xảy ra/);
    expect(planTransition(issue(), pm, { action: "reclassify", targetType: "risk", extension: { likelihood: "High" } })).toMatchObject({ newType: "risk", toStatus: "pending" });
    expect(() => planTransition(issue(), owner, { action: "reclassify", targetType: "risk" })).toThrow(ForbiddenException);
    expect(names(legacyCr, admin)).toEqual([]);
    expect(() => planTransition(legacyCr, admin, { action: "cancel", note: "x" })).toThrow();
  });
});

describe("due state, age and warnings", () => {
  it("derives Chưa đặt hạn / Trong hạn / Quá hạn by Vietnam date and freezes at closing", () => {
    expect(issueLogDueState(issue(), now)).toBe("no_due");
    expect(issueLogDueState(issue({ dueAt: new Date("2026-10-12T00:00:00.000Z") }), now)).toBe("on_time");
    expect(issueLogDueState(issue({ dueAt: new Date("2026-10-11T00:00:00.000Z") }), now)).toBe("overdue");
    expect(issueLogDueState(issue({ dueAt: new Date("2026-10-11T00:00:00.000Z"), closedAt: new Date("2026-10-10T03:00:00.000Z") }), now)).toBe("on_time");
    expect(issueLogAgeDays(issue({ createdAt: new Date("2026-10-09T03:00:00.000Z") }), now)).toBe(3);
  });

  it("raises BRI-01/02/03 for open Blocker/Risk/Issue and nothing once handled", () => {
    const record = { ...issue({ dueAt: new Date("2026-10-01T00:00:00.000Z"), severity: "critical" }), id: "r1", code: "ISS-001" };
    expect(issueLogWarnings(record, now).map((warning) => warning.dedupeKey)).toEqual(["BRI-01:r1", "BRI-02:r1", "BRI-03:r1"]);
    expect(issueLogWarnings({ ...record, dueAt: null, severity: "low" }, now).map((warning) => warning.typeCode)).toEqual(["BRI-01"]);
    expect(issueLogWarnings({ ...record, status: "resolved" }, now)).toEqual([]);
    expect(issueLogWarnings({ ...record, status: "accepted" }, now)).toEqual([]);
  });

  it("a stored change request raises no warning and is never a project risk", () => {
    expect(issueLogWarnings({ ...legacyCr, id: "c1", code: "CR-001", dueAt: new Date("2026-10-01T00:00:00.000Z") }, now)).toEqual([]);
    expect(countsTowardProjectAtRisk(legacyCr)).toBe(false);
    expect(countsTowardProjectAtRisk(issue())).toBe(true);
    expect(countsTowardProjectAtRisk(issue({ status: "accepted" }))).toBe(false);
  });
});
