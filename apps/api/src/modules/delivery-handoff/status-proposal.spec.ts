import { describe, expect, it } from "vitest";
import { PROJECT_GATE_CODES } from "@b2b-crm/contracts";
import { PROJECT_STATUS_CATALOGUE, PROJECT_STATUS_CODES } from "./project-status";
import { canDecideStatusProposal, computeProjectStatus, planStatusSync, type ProjectStatusFacts } from "./status-proposal";

/** Gates with the given statuses; every other gate is not submitted. */
function gates(statuses: Record<string, string> = {}) {
  return PROJECT_GATE_CODES.map((code) => ({ code, status: statuses[code] ?? "not_submitted" }));
}
function facts(overrides: Partial<ProjectStatusFacts> = {}): ProjectStatusFacts {
  return { currentStatus: "planning", gates: gates(), pilotHasTimeLog: false, onboardHasTimeLog: false, openIssueCodes: [], overdueTaskCount: 0, highDelayWarningCount: 0, holdIsCustomerWait: false, ...overrides };
}
const approved = (...codes: string[]) => Object.fromEntries(codes.map((code) => [code, "approved"]));
const status = (overrides: Partial<ProjectStatusFacts>) => computeProjectStatus(facts(overrides))?.status;

describe("status the rules imply, one case per status (5.1)", () => {
  it("Lên kế hoạch: just created, in Milestone 1", () => {
    expect(computeProjectStatus(facts())).toMatchObject({ status: "planning", automatic: false });
  });

  it("Đang triển khai: G1 approved (or opened by exception), through Milestone 2", () => {
    expect(computeProjectStatus(facts({ gates: gates(approved("G1")) }))).toMatchObject({ status: "active", basis: "G1 đã duyệt", automatic: false });
    expect(status({ gates: gates({ G1: "exception" }) })).toBe("active");
    expect(status({ gates: gates(approved("G1", "G2", "G3", "G4")) })).toBe("active");
    expect(status({ gates: gates({ G1: "submitted" }) })).toBe("planning");
  });

  it("Đang chạy thử: stage Pilot has its first time log", () => {
    expect(computeProjectStatus(facts({ gates: gates(approved("G1", "G2", "G3", "G4")), pilotHasTimeLog: true }))).toMatchObject({ status: "pilot", basis: "Stage Pilot bắt đầu có giờ log" });
  });

  it("Đang mở rộng sử dụng: stage Onboard has its first time log", () => {
    expect(status({ gates: gates(approved("G1", "G2", "G3", "G4", "G5")), pilotHasTimeLog: true, onboardHasTimeLog: true })).toBe("onboarding");
  });

  it("Chờ duyệt nghiệm thu: the acceptance minutes are submitted", () => {
    expect(status({ gates: gates({ ...approved("G1", "G2", "G3", "G4", "G5", "G6"), G7: "submitted" }), pilotHasTimeLog: true, onboardHasTimeLog: true })).toBe("in_review");
  });

  it("Tạm dừng: waiting for the customer at G1, G2, G4 or G7, with the pre-filled reason", () => {
    for (const code of ["G1", "G2", "G4", "G7"]) {
      expect(computeProjectStatus(facts({ gates: gates({ [code]: "awaiting_customer" }) }))).toMatchObject({ status: "on_hold", basis: `Chờ khách xác nhận tại ${code}`, suggestedReason: `Chờ khách xác nhận tại ${code}`, automatic: false });
    }
  });

  it("Tạm dừng agreed by both sides stays until a person ends it; a customer-wait hold ends with the confirmation", () => {
    expect(status({ currentStatus: "on_hold", gates: gates(approved("G1")), holdIsCustomerWait: false })).toBe("on_hold");
    expect(status({ currentStatus: "on_hold", gates: gates(approved("G1")), holdIsCustomerWait: true })).toBe("active");
  });

  it("Có rủi ro: an open Blocker/Risk/Issue, an overdue task, or a high delay warning", () => {
    expect(computeProjectStatus(facts({ openIssueCodes: ["BLK-001", "ISS-002"] }))).toMatchObject({ status: "at_risk", suggestedReason: "Blocker/Risk/Issue đang mở: BLK-001, ISS-002" });
    const overdue = computeProjectStatus(facts({ overdueTaskCount: 3 }));
    expect(overdue).toMatchObject({ status: "at_risk", basis: "3 task Quá hạn" });
    // V-18: an overdue task is not a blocker, so the confirmer has to type the action.
    expect(overdue?.suggestedReason).toBeUndefined();
    expect(status({ highDelayWarningCount: 1 })).toBe("at_risk");
  });

  it("Đã hoàn thành: G7 approved, kept through Optimize — automatic", () => {
    expect(computeProjectStatus(facts({ gates: gates(approved("G1", "G2", "G3", "G4", "G5", "G6", "G7")), pilotHasTimeLog: true, onboardHasTimeLog: true }))).toMatchObject({ status: "completed", automatic: true });
    // A gate opened by exception is passed (gates.ts isGatePassed) — the same meaning the P&L close uses, so the project completes.
    expect(computeProjectStatus(facts({ gates: gates({ ...approved("G1"), G7: "exception" }) }))).toMatchObject({ status: "completed", automatic: true, baseBasis: "G7 mở theo ngoại lệ" });
    expect(status({ gates: gates({ ...approved("G1", "G7"), G8: "exception" }) })).toBe("maintenance");
  });

  it("Đang bảo trì: G8 approved and handed over to CS — automatic", () => {
    expect(computeProjectStatus(facts({ gates: gates(approved(...PROJECT_GATE_CODES)) }))).toMatchObject({ status: "maintenance", automatic: true });
  });

  it("Đã đóng: final, nothing overrides it", () => {
    expect(status({ currentStatus: "closed", openIssueCodes: ["BLK-001"], gates: gates({ G1: "awaiting_customer" }) })).toBe("closed");
  });

  it("covers every status of the catalogue", () => {
    const seen = new Set([
      status({}), status({ gates: gates(approved("G1")) }), status({ pilotHasTimeLog: true }), status({ onboardHasTimeLog: true }), status({ gates: gates({ G7: "submitted" }) }),
      status({ gates: gates({ G2: "awaiting_customer" }) }), status({ overdueTaskCount: 1 }), status({ gates: gates(approved("G7")) }), status({ gates: gates(approved("G8")) }), status({ currentStatus: "closed" })
    ]);
    expect([...seen].sort()).toEqual([...PROJECT_STATUS_CODES].sort());
  });
});

describe("precedence when several conditions hold (5.1)", () => {
  const everything: Partial<ProjectStatusFacts> = { gates: gates({ ...approved("G1", "G2", "G3", "G5", "G6", "G8"), G4: "awaiting_customer", G7: "approved" }), pilotHasTimeLog: true, onboardHasTimeLog: true, openIssueCodes: ["RSK-001"] };

  it("follows Đã đóng > Có rủi ro > Tạm dừng > Đang bảo trì > Đã hoàn thành > position", () => {
    expect(status({ ...everything, currentStatus: "closed" })).toBe("closed");
    expect(status(everything)).toBe("at_risk");
    expect(status({ ...everything, openIssueCodes: [] })).toBe("on_hold");
    const noWait = { ...everything, openIssueCodes: [], gates: gates(approved(...PROJECT_GATE_CODES)) };
    expect(status(noWait)).toBe("maintenance");
    expect(status({ ...noWait, gates: gates(approved("G1", "G2", "G3", "G4", "G5", "G6", "G7")) })).toBe("completed");
    expect(status({ ...noWait, gates: gates({ ...approved("G1", "G2", "G3", "G4", "G5", "G6"), G7: "submitted" }) })).toBe("in_review");
    expect(status({ ...noWait, gates: gates(approved("G1", "G2", "G3", "G4", "G5")) })).toBe("onboarding");
    expect(status({ ...noWait, onboardHasTimeLog: false, gates: gates(approved("G1", "G2", "G3", "G4")) })).toBe("pilot");
    expect(status({ ...noWait, onboardHasTimeLog: false, pilotHasTimeLog: false, gates: gates(approved("G1")) })).toBe("active");
    expect(status({ ...noWait, onboardHasTimeLog: false, pilotHasTimeLog: false, gates: gates() })).toBe("planning");
  });

  it("agrees with priorityRank of the status catalogue", () => {
    const order = ["closed", "at_risk", "on_hold", "maintenance", "completed", "in_review", "onboarding", "pilot", "active", "planning"] as const;
    expect([...PROJECT_STATUS_CODES].sort((left, right) => PROJECT_STATUS_CATALOGUE[left].priorityRank - PROJECT_STATUS_CATALOGUE[right].priorityRank)).toEqual([...order]);
  });

  it("once the risk is cleared the project goes to what the remaining order says, not to the status before", () => {
    const cleared = facts({ currentStatus: "at_risk", gates: gates(approved("G1", "G2", "G3", "G4")), pilotHasTimeLog: true });
    expect(planStatusSync("at_risk", computeProjectStatus(cleared)).propose).toMatchObject({ proposedStatus: "pilot" });
  });

  it("says nothing about a project on a hand-built framework unless it is at risk", () => {
    expect(computeProjectStatus(facts({ currentStatus: "in_progress", gates: null }))).toBeNull();
    expect(computeProjectStatus(facts({ currentStatus: "in_progress", gates: null, openIssueCodes: ["BLK-001"] }))).toMatchObject({ status: "at_risk", base: null });
  });
});

describe("proposal or automatic transition (V-17, V-19)", () => {
  it("proposes a positional status and waits for confirmation", () => {
    expect(planStatusSync("planning", computeProjectStatus(facts({ gates: gates(approved("G1")) })))).toEqual({ apply: [], propose: { proposedStatus: "active", basis: "G1 đã duyệt" } });
  });

  it("proposes nothing when the project already has the implied status", () => {
    expect(planStatusSync("in_progress", computeProjectStatus(facts({ currentStatus: "in_progress", gates: gates(approved("G1")) })))).toEqual({ apply: [] });
  });

  it("proposes Tạm dừng while the customer has not confirmed, and leaving it once they have", () => {
    const waiting = computeProjectStatus(facts({ gates: gates({ G1: "awaiting_customer" }) }));
    expect(planStatusSync("planning", waiting).propose).toEqual({ proposedStatus: "on_hold", basis: "Chờ khách xác nhận tại G1", suggestedReason: "Chờ khách xác nhận tại G1" });
    const confirmed = computeProjectStatus(facts({ currentStatus: "on_hold", holdIsCustomerWait: true, gates: gates(approved("G1")) }));
    expect(planStatusSync("on_hold", confirmed)).toEqual({ apply: [], propose: { proposedStatus: "active", basis: "G1 đã duyệt" } });
  });

  it("applies Đã hoàn thành automatically when G7 is approved, also out of a customer-wait hold", () => {
    const g7 = gates(approved("G1", "G2", "G3", "G4", "G5", "G6", "G7"));
    expect(planStatusSync("in_review", computeProjectStatus(facts({ currentStatus: "in_review", gates: g7 })))).toEqual({ apply: [{ to: "completed", reason: "Hệ thống tự chuyển: G7 đã duyệt" }] });
    expect(planStatusSync("on_hold", computeProjectStatus(facts({ currentStatus: "on_hold", holdIsCustomerWait: true, gates: g7 }))).apply.map((step) => step.to)).toEqual(["completed"]);
  });

  it("applies Đang bảo trì automatically when G8 is approved", () => {
    const plan = planStatusSync("completed", computeProjectStatus(facts({ currentStatus: "completed", gates: gates(approved(...PROJECT_GATE_CODES)) })));
    expect(plan).toEqual({ apply: [{ to: "maintenance", reason: "Hệ thống tự chuyển: G8 đã duyệt, đã bàn giao CS" }] });
  });

  it("moves to Đã hoàn thành first and then proposes Có rủi ro when an issue is open at G7", () => {
    const computed = computeProjectStatus(facts({ currentStatus: "in_review", gates: gates(approved("G1", "G2", "G3", "G4", "G5", "G6", "G7")), openIssueCodes: ["ISS-004"] }));
    const plan = planStatusSync("in_review", computed);
    expect(plan.apply.map((step) => step.to)).toEqual(["completed"]);
    expect(plan.propose).toMatchObject({ proposedStatus: "at_risk" });
  });

  it("never moves a closed project, and never steps back from Đang bảo trì to Đã hoàn thành by itself", () => {
    expect(planStatusSync("closed", computeProjectStatus(facts({ currentStatus: "closed", gates: gates(approved("G7")) })))).toEqual({ apply: [] });
    expect(planStatusSync("maintenance", computeProjectStatus(facts({ currentStatus: "maintenance", gates: gates(approved("G7")) })))).toEqual({ apply: [] });
  });

  it("leaves a hold both sides agreed on alone, even when G7 is approved", () => {
    expect(planStatusSync("on_hold", computeProjectStatus(facts({ currentStatus: "on_hold", gates: gates(approved("G7")) })))).toEqual({ apply: [] });
  });

  it("does not repeat a declined proposal until its basis changes", () => {
    const computed = computeProjectStatus(facts({ openIssueCodes: ["BLK-001"] }));
    expect(planStatusSync("planning", computed, { proposedStatus: "at_risk", basis: "Blocker/Risk/Issue đang mở: BLK-001" })).toEqual({ apply: [] });
    expect(planStatusSync("planning", computeProjectStatus(facts({ openIssueCodes: ["BLK-001", "BLK-002"] })), { proposedStatus: "at_risk", basis: "Blocker/Risk/Issue đang mở: BLK-001" }).propose).toMatchObject({ proposedStatus: "at_risk" });
  });

  it("lets the PIC / PM or an Admin decide, not a regular member", () => {
    expect(canDecideStatusProposal({ isPm: true, isAdmin: false })).toBe(true);
    expect(canDecideStatusProposal({ isPm: false, isAdmin: true })).toBe(true);
    expect(canDecideStatusProposal({ isPm: false, isAdmin: false })).toBe(false);
  });
});
