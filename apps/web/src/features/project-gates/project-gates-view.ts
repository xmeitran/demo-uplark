/**
 * View helpers of the "Điểm chốt G1–G8" panel: which fields each action asks for and how a gate is summarised.
 * The rules themselves are in the API (delivery-handoff/gates.ts); the API re-validates everything sent from here.
 */
import type { ProjectGateAction, ProjectGateActionInput, ProjectGateDefinition, ProjectGateStatus, ProjectGateSummary } from "@b2b-crm/contracts";

export type GateActionFieldKey = "reason" | "conditionOwnerUserId" | "conditionDueAt" | "customerConfirmedBy" | "customerConfirmedAt" | "customerEvidence" | "goLiveDate";

export interface GateActionField {
  key: GateActionFieldKey;
  label: string;
  kind: "textarea" | "text" | "date" | "member";
  required: boolean;
  placeholder?: string;
}

/** The fields an action asks for; mandatory ones mirror V-11, V-13, V-14 and V-16. */
export function gateActionFields(action: ProjectGateAction, definition: Pick<ProjectGateDefinition, "goLiveDate" | "customerEvidence">, gate?: Pick<ProjectGateSummary, "goLiveDate">): GateActionField[] {
  const goLive: GateActionField[] = definition.goLiveDate ? [{ key: "goLiveDate", label: "Ngày Go-live", kind: "date", required: action !== "submit" && !gate?.goLiveDate }] : [];
  switch (action) {
    case "submit":
      return [{ key: "reason", label: "Ghi chú hồ sơ", kind: "textarea", required: false }, ...goLive];
    case "approve":
      return goLive;
    case "reject":
      return [{ key: "reason", label: "Lý do từ chối và phần cần làm lại", kind: "textarea", required: true }];
    case "approve_conditional":
      return [
        { key: "reason", label: "Phần tồn đọng (ghi vào sổ vấn đề)", kind: "textarea", required: true },
        { key: "conditionOwnerUserId", label: "Người chịu trách nhiệm tồn đọng", kind: "member", required: true },
        { key: "conditionDueAt", label: "Hạn xử lý tồn đọng", kind: "date", required: true },
        ...goLive
      ];
    case "confirm_payment":
      return [{ key: "reason", label: "Ghi chú (thông tin thu tiền từ BD)", kind: "textarea", required: false }];
    case "confirm_customer":
      return [
        { key: "customerConfirmedBy", label: "Người xác nhận phía khách hàng", kind: "text", required: true, placeholder: "Họ tên, chức danh" },
        { key: "customerConfirmedAt", label: "Ngày khách xác nhận", kind: "date", required: false },
        { key: "customerEvidence", label: "Bằng chứng (đường dẫn email / biên bản đã tải lên)", kind: "textarea", required: true, placeholder: definition.customerEvidence }
      ];
    case "exception":
      return [{ key: "reason", label: "Lý do mở theo ngoại lệ", kind: "textarea", required: true }];
  }
}

export function missingGateActionFields(fields: readonly GateActionField[], values: Partial<Record<GateActionFieldKey, string>>): string[] {
  return fields.filter((field) => field.required && !String(values[field.key] ?? "").trim()).map((field) => field.label);
}

/** Body of POST …/gates/:id/actions: only the fields the action has, blanks left out. */
export function gateActionInput(action: ProjectGateAction, fields: readonly GateActionField[], values: Partial<Record<GateActionFieldKey, string>>): ProjectGateActionInput {
  const input: ProjectGateActionInput = { action };
  for (const field of fields) {
    const value = String(values[field.key] ?? "").trim();
    if (value) input[field.key] = value;
  }
  return input;
}

export function gateStatusTone(status: ProjectGateStatus): string {
  if (status === "approved") return "bg-emerald-50 text-emerald-700";
  if (status === "exception") return "bg-violet-50 text-violet-700";
  if (status === "rejected") return "bg-rose-50 text-rose-700";
  if (status === "awaiting_customer") return "bg-amber-50 text-amber-700";
  if (status === "submitted") return "bg-sky-50 text-sky-700";
  return "bg-slate-100 text-slate-600";
}

/** One line for the customer-confirmation column. */
export function customerConfirmationLabel(gate: Pick<ProjectGateSummary, "definition" | "status" | "customerConfirmedAt" | "customerDueAt" | "customerOverdue">): string {
  if (!gate.definition.customerConfirmation) return "Không yêu cầu";
  if (gate.customerConfirmedAt) return "Khách đã xác nhận";
  if (gate.status === "awaiting_customer") return gate.customerOverdue ? "Chờ khách xác nhận – quá hạn phản hồi" : "Chờ khách xác nhận";
  if (gate.status === "exception") return "Bỏ qua theo ngoại lệ";
  return "Sau khi PM duyệt nội bộ";
}

export function gatesPassedCount(gates: ReadonlyArray<Pick<ProjectGateSummary, "status">>): number {
  return gates.filter((gate) => gate.status === "approved" || gate.status === "exception").length;
}

/** Every document type the project's gates ask for, for the upload dialog's type picker. */
export function gateDocumentTypeOptions(gates: ReadonlyArray<Pick<ProjectGateSummary, "definition">>): string[] {
  return [...new Set(gates.flatMap((gate) => gate.definition.requiredDocumentTypes))];
}
