import { describe, expect, it } from "vitest";
import {
  LAYER2_MISMATCH_LABEL, TASK_TYPE_LAYER1_LABELS, TASK_TYPE_LAYER1_OPTIONS, TASK_TYPE_LAYER2_LABELS, TASK_TYPE_LAYER2_OPTIONS,
  defaultSelectedLayer2, isLayer2ReasonRequired, layer2OptionsForTask, taskTypeLabel, taskTypeLayer1Label, taskTypeLayer2Label
} from "./task-classification";
import * as api from "../../../api/src/modules/delivery-handoff/task-classification";

describe("task classification labels", () => {
  it("Layer 1 is exactly Pre-sale, Delivery, PM (rules 4.1)", () => {
    expect(TASK_TYPE_LAYER1_LABELS).toEqual({ PRE_SALE: "Pre-sale", DELIVERY: "Delivery", PM: "PM" });
    expect(TASK_TYPE_LAYER1_OPTIONS.map((option) => option.label)).toEqual(["Pre-sale", "Delivery", "PM"]);
  });

  it("Layer 2 is exactly the three Vietnamese names of rules 4.2; the day-off value and the old names are gone", () => {
    expect(TASK_TYPE_LAYER2_LABELS).toEqual({ CUSTOMER_PROJECT: "Dự án tính phí", TICKET_MAINTENANCE: "Ticket/bảo trì", INTERNAL_PROJECT: "Nội bộ" });
    expect(Object.values(TASK_TYPE_LAYER2_LABELS)).not.toContain("Project khách hàng");
    expect(taskTypeLayer2Label("DAY_OFF_COMPANY")).toBe("Chờ phân loại");
  });

  it("an empty or unknown value reads Chờ phân loại", () => {
    expect(taskTypeLayer1Label(undefined)).toBe("Chờ phân loại");
    expect(taskTypeLayer2Label(null)).toBe("Chờ phân loại");
    expect(taskTypeLayer2Label("toString")).toBe("Chờ phân loại");
    expect(taskTypeLabel("DELIVERY", undefined)).toBe("Delivery / Chờ phân loại");
    expect(taskTypeLabel("PM", "TICKET_MAINTENANCE")).toBe("PM / Ticket/bảo trì");
  });

  it("offers the three Layer 2 values on a time log, minus the impossible Pre-sale × Ticket/bảo trì; pre-selects the task's value", () => {
    expect(TASK_TYPE_LAYER2_OPTIONS.map((option) => option.label)).toEqual(["Dự án tính phí", "Ticket/bảo trì", "Nội bộ"]);
    expect(layer2OptionsForTask("PRE_SALE").map((option) => option.value)).toEqual(["CUSTOMER_PROJECT", "INTERNAL_PROJECT"]);
    expect(layer2OptionsForTask("DELIVERY")).toHaveLength(3);
    expect(defaultSelectedLayer2("TICKET_MAINTENANCE")).toBe("TICKET_MAINTENANCE");
    expect(defaultSelectedLayer2(undefined)).toBe("");
    expect(LAYER2_MISMATCH_LABEL).toBe(api.LAYER2_MISMATCH_LABEL);
    for (const layer1 of ["PRE_SALE", "DELIVERY", "PM"]) {
      expect(layer2OptionsForTask(layer1).map((option) => option.value)).toEqual(TASK_TYPE_LAYER2_OPTIONS.map((option) => option.value).filter((layer2) => api.isValidTaskTypePair(layer1, layer2)));
    }
  });

  it("is identical to the API's catalogue", () => {
    expect(TASK_TYPE_LAYER1_LABELS).toEqual(api.TASK_TYPE_LAYER1_LABELS);
    expect(TASK_TYPE_LAYER2_LABELS).toEqual(api.TASK_TYPE_LAYER2_LABELS);
    expect(taskTypeLayer1Label(null)).toBe(api.TASK_TYPE_PENDING_LABEL);
  });

  it("asks for a reason only when the API refuses a Layer 2 change because of G7", () => {
    expect(isLayer2ReasonRequired(409, "Dự án đã qua G7 nên P&L dự án đã đóng: chỉ Admin mới được sửa Lớp 2 của giờ log và phải ghi lý do.")).toBe(true);
    expect(isLayer2ReasonRequired(409, "Kỳ chi phí đã khóa.")).toBe(false);
    expect(isLayer2ReasonRequired(403, "Chỉ người ghi giờ, PM dự án hoặc Admin mới được sửa Lớp 2 của giờ log. G7")).toBe(false);
  });
});
