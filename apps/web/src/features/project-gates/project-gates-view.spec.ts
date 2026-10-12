import { describe, expect, it } from "vitest";
import { PROJECT_GATE_ACTIONS, PROJECT_GATE_CATALOGUE } from "@b2b-crm/contracts";
import { customerConfirmationLabel, gateActionFields, gateActionInput, gateDocumentTypeOptions, gatesPassedCount, missingGateActionFields } from "./project-gates-view";

const { G1, G3, G8 } = PROJECT_GATE_CATALOGUE;
const requiredKeys = (action: (typeof PROJECT_GATE_ACTIONS)[number], definition = G3, gate?: { goLiveDate?: string }) =>
  gateActionFields(action, definition, gate).filter((field) => field.required).map((field) => field.key);

describe("gate action forms ask for the mandatory fields", () => {
  it("reject and exception need a reason; conditional approval needs the outstanding part, an owner and a due date", () => {
    expect(requiredKeys("reject")).toEqual(["reason"]);
    expect(requiredKeys("exception")).toEqual(["reason"]);
    expect(requiredKeys("approve_conditional")).toEqual(["reason", "conditionOwnerUserId", "conditionDueAt"]);
    expect(requiredKeys("submit")).toEqual([]);
    expect(requiredKeys("approve")).toEqual([]);
  });

  it("customer confirmation needs who confirmed and the evidence; the date is optional", () => {
    expect(requiredKeys("confirm_customer", G1)).toEqual(["customerConfirmedBy", "customerEvidence"]);
    expect(gateActionFields("confirm_customer", G1).map((field) => field.key)).toEqual(["customerConfirmedBy", "customerConfirmedAt", "customerEvidence"]);
  });

  it("G8 asks for the Go-live date when approving unless it was given with the submission", () => {
    expect(requiredKeys("approve", G8)).toEqual(["goLiveDate"]);
    expect(requiredKeys("approve", G8, { goLiveDate: "2026-11-02" })).toEqual([]);
    expect(gateActionFields("submit", G8).find((field) => field.key === "goLiveDate")?.required).toBe(false);
  });

  it("lists what is missing and sends only filled fields", () => {
    const fields = gateActionFields("approve_conditional", G3);
    expect(missingGateActionFields(fields, { reason: "Còn 2 task", conditionOwnerUserId: " " })).toEqual(["Người chịu trách nhiệm tồn đọng", "Hạn xử lý tồn đọng"]);
    expect(gateActionInput("approve_conditional", fields, { reason: " Còn 2 task ", conditionOwnerUserId: "usr-1", conditionDueAt: "2026-10-20", customerEvidence: "ignored" }))
      .toEqual({ action: "approve_conditional", reason: "Còn 2 task", conditionOwnerUserId: "usr-1", conditionDueAt: "2026-10-20" });
  });
});

describe("gate summaries", () => {
  it("describes the customer step", () => {
    expect(customerConfirmationLabel({ definition: G3, status: "submitted", customerOverdue: false })).toBe("Không yêu cầu");
    expect(customerConfirmationLabel({ definition: G1, status: "submitted", customerOverdue: false })).toBe("Sau khi PM duyệt nội bộ");
    expect(customerConfirmationLabel({ definition: G1, status: "awaiting_customer", customerOverdue: false })).toBe("Chờ khách xác nhận");
    expect(customerConfirmationLabel({ definition: G1, status: "awaiting_customer", customerOverdue: true })).toContain("quá hạn");
    expect(customerConfirmationLabel({ definition: G1, status: "approved", customerConfirmedAt: "2026-10-12T00:00:00.000Z", customerOverdue: false })).toBe("Khách đã xác nhận");
  });

  it("counts opened gates and collects the document types to offer on upload", () => {
    expect(gatesPassedCount([{ status: "approved" }, { status: "exception" }, { status: "awaiting_customer" }, { status: "not_submitted" }])).toBe(2);
    expect(gateDocumentTypeOptions([{ definition: G1 }, { definition: G3 }])).toEqual(["Proposal", "Biên bản đóng scope", "Đường dẫn hệ thống", "Test case"]);
  });
});
