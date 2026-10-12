import { describe, expect, it } from "vitest";
import {
  CONTRACT_ITEM_TYPE_LABELS, contractItemTypeLabel, defaultContractItemId, isLostDealProject, lockedContractItemFields,
  resolveTaskContractItem, summarizeLostDealPreSale
} from "./contract-item";

const root = { id: "root", kind: "ROOT", sortOrder: 10 };
const appendix = { id: "appendix", kind: "APPENDIX", sortOrder: 20 };
const changeRequest = { id: "cr", kind: "CHANGE_REQUEST", sortOrder: 5 };

describe("contract type catalogue (D-22)", () => {
  it("has exactly Trọn gói, Theo giờ, Nội bộ — no Retainer", () => {
    expect(Object.values(CONTRACT_ITEM_TYPE_LABELS)).toEqual(["Trọn gói", "Theo giờ", "Nội bộ"]);
    expect(contractItemTypeLabel("RETAINER")).toBe("Chờ phân loại");
    expect(contractItemTypeLabel(null)).toBe("Chờ phân loại");
  });
});

describe("defaultContractItemId (D-06)", () => {
  it("a project with one line item gets it automatically", () => {
    expect(defaultContractItemId([appendix])).toBe("appendix");
  });
  it("several line items default to the root item, whatever the order", () => {
    expect(defaultContractItemId([changeRequest, appendix, root])).toBe("root");
  });
  it("no line item yet means Chưa có hạng mục (D-07)", () => {
    expect(defaultContractItemId([])).toBeNull();
  });
});

describe("resolveTaskContractItem (D-01, D-05, D-06)", () => {
  const base = { isSubtask: false, activeItems: [root, appendix], canAssign: false };

  it("auto-assigns the only line item when nothing is requested", () => {
    expect(resolveTaskContractItem({ ...base, activeItems: [root] })).toEqual({ value: "root", moved: false });
  });
  it("a sub-task repeats its parent whatever is requested", () => {
    expect(resolveTaskContractItem({ ...base, isSubtask: true, parentItemId: "appendix", requestedItemId: "root", canAssign: true }))
      .toEqual({ value: "appendix", moved: false });
  });
  it("anyone may create with the default item; another item needs PM (Admin)", () => {
    expect(resolveTaskContractItem({ ...base, requestedItemId: "root" }).value).toBe("root");
    expect(resolveTaskContractItem({ ...base, requestedItemId: "appendix" })).toMatchObject({ forbidden: true, value: null });
    expect(resolveTaskContractItem({ ...base, requestedItemId: "appendix", canAssign: true })).toEqual({ value: "appendix", moved: false });
  });
  it("a task that has no item yet is filled with the default on save", () => {
    expect(resolveTaskContractItem({ ...base, currentItemId: null })).toEqual({ value: "root", moved: false });
  });
  it("saving without touching the item keeps it", () => {
    expect(resolveTaskContractItem({ ...base, currentItemId: "appendix" })).toEqual({ value: "appendix", moved: false });
    expect(resolveTaskContractItem({ ...base, currentItemId: "appendix", requestedItemId: "appendix" })).toEqual({ value: "appendix", moved: false });
  });
  it("moving a task is blocked for a non-PM", () => {
    expect(resolveTaskContractItem({ ...base, currentItemId: "root", requestedItemId: "appendix", reason: "CR-01" }))
      .toMatchObject({ forbidden: true, value: "root", moved: false });
  });
  it("moving a task needs a reason even for the PM", () => {
    const result = resolveTaskContractItem({ ...base, currentItemId: "root", requestedItemId: "appendix", canAssign: true, reason: "  " });
    expect(result).toMatchObject({ value: "root", moved: false });
    expect(result.error).toContain("lý do");
    expect(result.forbidden).toBeUndefined();
  });
  it("the PM moves a task with a reason", () => {
    expect(resolveTaskContractItem({ ...base, currentItemId: "root", requestedItemId: "appendix", canAssign: true, reason: "Việc thuộc phụ lục 01" }))
      .toEqual({ value: "appendix", moved: true });
  });
  it("an item of another project or an archived one is rejected", () => {
    expect(resolveTaskContractItem({ ...base, currentItemId: "root", requestedItemId: "elsewhere", canAssign: true, reason: "x" }).error).toBeTruthy();
  });
});

describe("lockedContractItemFields (D-22)", () => {
  const current = { contractType: "FIXED_PRICE", valueAmount: 100 };
  it("nothing is locked before hours or an invoice exist", () => {
    expect(lockedContractItemFields(current, { contractType: "INTERNAL", valueAmount: 5 }, { hasTimeEntries: false, hasIssuedInvoice: false })).toEqual([]);
  });
  it("type and base value lock once hours are logged or an invoice is issued", () => {
    expect(lockedContractItemFields(current, { contractType: "INTERNAL", valueAmount: 5 }, { hasTimeEntries: true, hasIssuedInvoice: false })).toEqual(["loại hợp đồng", "giá trị gốc"]);
    expect(lockedContractItemFields(current, { valueAmount: 5 }, { hasTimeEntries: false, hasIssuedInvoice: true })).toEqual(["giá trị gốc"]);
  });
  it("unchanged values and other fields pass; filling a never-set type or value is not a change", () => {
    expect(lockedContractItemFields(current, { contractType: "FIXED_PRICE", valueAmount: 100 }, { hasTimeEntries: true, hasIssuedInvoice: true })).toEqual([]);
    expect(lockedContractItemFields({ contractType: null, valueAmount: null }, { contractType: "TIME_AND_MATERIAL", valueAmount: 9 }, { hasTimeEntries: true, hasIssuedInvoice: true })).toEqual([]);
  });
});

describe("lost-deal Pre-sale (D-07, decision 5)", () => {
  const closedLost = [{ toStatus: "closed", closeReasonCode: "lost_deal", changedAt: "2026-09-20T00:00:00Z" }];

  it("a project is a lost deal only while Closed with its latest close reason Thua deal", () => {
    expect(isLostDealProject("closed", closedLost)).toBe(true);
    expect(isLostDealProject("active", closedLost)).toBe(false);
    expect(isLostDealProject("closed", [{ toStatus: "closed", closeReasonCode: "client_stopped", changedAt: "2026-09-20T00:00:00Z" }])).toBe(false);
    expect(isLostDealProject("closed", [...closedLost, { toStatus: "active", changedAt: "2026-09-25T00:00:00Z" }, { toStatus: "closed", closeReasonCode: "internal_cancel", changedAt: "2026-10-01T00:00:00Z" }])).toBe(false);
  });

  it("sums minutes per month and per project under the label Chi phí Pre-sale at company level", () => {
    const a = { projectId: "a", projectCode: "A", projectName: "Deal A" };
    const b = { projectId: "b", projectCode: "B", projectName: "Deal B" };
    expect(summarizeLostDealPreSale([
      { ...a, workDate: "2026-09-03T00:00:00Z", minutes: 60 },
      { ...b, workDate: "2026-08-30T00:00:00Z", minutes: 30 },
      { ...a, workDate: new Date("2026-09-10T00:00:00Z"), minutes: 90 },
      { ...b, workDate: "2026-09-11T00:00:00Z", minutes: 15 }
    ])).toEqual({
      label: "Chi phí Pre-sale",
      level: "company",
      totalMinutes: 195,
      months: [
        { month: "2026-08", minutes: 30, projects: [{ ...b, minutes: 30 }] },
        { month: "2026-09", minutes: 165, projects: [{ ...a, minutes: 150 }, { ...b, minutes: 15 }] }
      ]
    });
  });

  it("no lost deals gives an empty, still labelled summary", () => {
    expect(summarizeLostDealPreSale([])).toEqual({ label: "Chi phí Pre-sale", level: "company", totalMinutes: 0, months: [] });
  });
});
