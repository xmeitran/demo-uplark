import { describe, expect, it } from "vitest";
import {
  deriveTaskTypeLayer2, isValidTaskTypePair, resolveTaskTypeLayer1, taskTypeLayer1Label, taskTypeLayer2Label,
  TASK_TYPE_LAYER1_LABELS, TASK_TYPE_LAYER2_LABELS, TASK_TYPE_PENDING_LABEL
} from "./task-classification";
import { PILOT_PROJECT_MILESTONE_TEMPLATE } from "./stage-template";

describe("catalogues (rules 4.1, 4.2, D-09)", () => {
  it("Layer 1 has exactly Pre-sale, Delivery, PM", () => {
    expect(TASK_TYPE_LAYER1_LABELS).toEqual({ PRE_SALE: "Pre-sale", DELIVERY: "Delivery", PM: "PM" });
  });

  it("Layer 2 has exactly three Vietnamese values; day off, Họp and Khác are gone", () => {
    expect(TASK_TYPE_LAYER2_LABELS).toEqual({ CUSTOMER_PROJECT: "Dự án tính phí", TICKET_MAINTENANCE: "Ticket/bảo trì", INTERNAL_PROJECT: "Nội bộ" });
    expect(taskTypeLayer2Label("DAY_OFF_COMPANY")).toBe(TASK_TYPE_PENDING_LABEL);
  });

  it("an empty or unknown value reads Chờ phân loại, never a default", () => {
    expect(taskTypeLayer1Label(null)).toBe("Chờ phân loại");
    expect(taskTypeLayer1Label("SALES")).toBe("Chờ phân loại");
    expect(taskTypeLayer2Label(undefined)).toBe("Chờ phân loại");
  });
});

describe("deriveTaskTypeLayer2 (table 4.2, D-04)", () => {
  it.each([
    ["DX Internal Worklog project", { projectType: "internal_worklog", afterPnlClose: null }, "INTERNAL_PROJECT"],
    ["DX Internal Worklog ignores the stage position", { projectType: "Internal Worklog", afterPnlClose: true }, "INTERNAL_PROJECT"],
    ["customer project, task before the P&L close gate", { projectType: "delivery", afterPnlClose: false }, "CUSTOMER_PROJECT"],
    ["customer project, Milestone 4 onward (after the gate)", { projectType: "delivery", afterPnlClose: true }, "TICKET_MAINTENANCE"],
    ["any other customer project type", { projectType: "implementation", afterPnlClose: false }, "CUSTOMER_PROJECT"]
  ] as const)("%s", (_row, context, expected) => {
    expect(deriveTaskTypeLayer2(context)).toBe(expected);
  });

  it.each([
    ["task without a project", { projectType: null, afterPnlClose: false }],
    ["customer project stage with no known position against the gate", { projectType: "delivery", afterPnlClose: null }],
    ["customer project stage position not sent", { projectType: "delivery", afterPnlClose: undefined }],
    // Rows 4 and 5 (internal with mandays vs. internal free of charge) differ only by the line item's type.
    ["internal project whose line item has no type yet", { projectType: "internal", afterPnlClose: false, contractType: null }],
    ["internal project without a line item, after the gate", { projectType: "internal", afterPnlClose: true }],
    ["billable internal project, stage position unknown", { projectType: "internal", afterPnlClose: null, contractType: "FIXED_PRICE" }]
  ] as const)("Chờ phân loại: %s", (_row, context) => {
    expect(deriveTaskTypeLayer2(context)).toBeNull();
  });

  // Every row of table 4.2 with the contract line item in play.
  it.each([
    ["row 1: DX Internal Worklog, whatever the item", { projectType: "internal_worklog", afterPnlClose: false, contractType: "FIXED_PRICE" }, "INTERNAL_PROJECT"],
    ["row 2: customer project, Trọn gói item, before the gate", { projectType: "delivery", afterPnlClose: false, contractType: "FIXED_PRICE" }, "CUSTOMER_PROJECT"],
    ["row 2: customer project, Theo giờ item, before the gate", { projectType: "delivery", afterPnlClose: false, contractType: "TIME_AND_MATERIAL" }, "CUSTOMER_PROJECT"],
    ["row 2: customer project, item type not set yet (both billable types agree)", { projectType: "delivery", afterPnlClose: false, contractType: null }, "CUSTOMER_PROJECT"],
    ["row 3: customer project, Milestone 4 onward, Trọn gói item", { projectType: "delivery", afterPnlClose: true, contractType: "FIXED_PRICE" }, "TICKET_MAINTENANCE"],
    ["row 3: decided by stage position, not by item type (no Retainer)", { projectType: "delivery", afterPnlClose: true, contractType: "TIME_AND_MATERIAL" }, "TICKET_MAINTENANCE"],
    ["row 4: internal UpBase project with mandays (Trọn gói)", { projectType: "internal", afterPnlClose: false, contractType: "FIXED_PRICE" }, "CUSTOMER_PROJECT"],
    ["row 4: internal UpBase project with mandays (Theo giờ)", { projectType: "internal", afterPnlClose: false, contractType: "TIME_AND_MATERIAL" }, "CUSTOMER_PROJECT"],
    ["row 5: internal project free of charge (Nội bộ item)", { projectType: "internal", afterPnlClose: false, contractType: "INTERNAL" }, "INTERNAL_PROJECT"],
    ["row 5: a Nội bộ item wins over the stage position", { projectType: "internal", afterPnlClose: true, contractType: "INTERNAL" }, "INTERNAL_PROJECT"],
    ["row 5: a Nội bộ item inside a customer project", { projectType: "delivery", afterPnlClose: false, contractType: "INTERNAL" }, "INTERNAL_PROJECT"]
  ] as const)("%s", (_row, context, expected) => {
    expect(deriveTaskTypeLayer2(context)).toBe(expected);
  });
});

describe("matrix 4.3", () => {
  it("only Pre-sale x Ticket/bảo trì is invalid", () => {
    for (const layer1 of ["PRE_SALE", "DELIVERY", "PM", null]) {
      for (const layer2 of ["CUSTOMER_PROJECT", "TICKET_MAINTENANCE", "INTERNAL_PROJECT", null]) {
        expect(isValidTaskTypePair(layer1, layer2)).toBe(!(layer1 === "PRE_SALE" && layer2 === "TICKET_MAINTENANCE"));
      }
    }
  });
});

describe("resolveTaskTypeLayer1 (D-02)", () => {
  const top = { isSubtask: false, canOverride: false };

  it("a framework task inherits its stage's value", () => {
    expect(resolveTaskTypeLayer1({ ...top, requested: undefined, stageLayer1: "DELIVERY" })).toEqual({ value: "DELIVERY", overridden: false });
    expect(resolveTaskTypeLayer1({ ...top, requested: "DELIVERY", stageLayer1: "DELIVERY" })).toEqual({ value: "DELIVERY", overridden: false });
  });

  it("a sub-task repeats its parent whatever is requested", () => {
    expect(resolveTaskTypeLayer1({ isSubtask: true, canOverride: true, requested: "PM", parentLayer1: "PRE_SALE", stageLayer1: "DELIVERY" }))
      .toEqual({ value: "PRE_SALE", overridden: false });
    expect(resolveTaskTypeLayer1({ isSubtask: true, canOverride: true, requested: "PM", parentLayer1: null, stageLayer1: "DELIVERY" }))
      .toEqual({ value: null, overridden: false });
  });

  it("a different value is an override that needs the right", () => {
    expect(resolveTaskTypeLayer1({ ...top, requested: "PM", stageLayer1: "DELIVERY" })).toEqual({ value: "DELIVERY", overridden: false });
    expect(resolveTaskTypeLayer1({ ...top, canOverride: true, requested: "PM", stageLayer1: "DELIVERY" })).toEqual({ value: "PM", overridden: true });
  });

  it("without a stage value the person adding the task fills it in; nothing requested stays Chờ phân loại", () => {
    expect(resolveTaskTypeLayer1({ ...top, requested: "PM", stageLayer1: null })).toEqual({ value: "PM", overridden: false });
    expect(resolveTaskTypeLayer1({ ...top, requested: undefined, stageLayer1: null })).toEqual({ value: null, overridden: false });
    expect(resolveTaskTypeLayer1({ ...top, requested: "SALES", stageLayer1: null })).toEqual({ value: null, overridden: false });
  });
});

describe("built-in template TPL-001", () => {
  it("every stage carries a Layer 1 and its position against the P&L close gate; only Milestone 4 is after it", () => {
    const stages = PILOT_PROJECT_MILESTONE_TEMPLATE.flatMap((milestone, index) => milestone.stages.map((stage) => ({ milestone: index + 1, ...stage })));
    expect(stages.map((stage) => [stage.stageKey, stage.taskTypeLayer1, stage.afterPnlClose])).toEqual([
      ["intake", "PRE_SALE", false], ["validate", "PRE_SALE", false],
      ["design", "DELIVERY", false], ["build", "DELIVERY", false], ["deployment_preparation", "DELIVERY", false],
      ["pilot", "DELIVERY", false], ["onboard", "DELIVERY", false], ["acceptance", "PM", false],
      ["optimize", "DELIVERY", true], ["handover", "PM", true]
    ]);
    expect(stages.filter((stage) => stage.afterPnlClose).every((stage) => stage.milestone === 4)).toBe(true);
    // No template stage sits in the invalid cell of matrix 4.3.
    expect(stages.every((stage) => isValidTaskTypePair(stage.taskTypeLayer1, deriveTaskTypeLayer2({ projectType: "delivery", afterPnlClose: stage.afterPnlClose })))).toBe(true);
  });
});
