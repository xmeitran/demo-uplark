import { describe, expect, it } from "vitest";
import {
  PROJECT_CLOSE_REASONS,
  PROJECT_STATUS_ALIASES,
  PROJECT_STATUS_CATALOGUE,
  PROJECT_STATUS_CODES,
  canCloseProject,
  canReopenProject,
  isKnownProjectStatus,
  isProjectClosed,
  normalizeProjectStatus,
  projectStatusFilterValues,
  projectStatusLabel,
  validateProjectStatusChange
} from "./project-status";

describe("project status catalogue", () => {
  it("has ten statuses with the document's labels, in catalogue order", () => {
    expect(PROJECT_STATUS_CODES.map((code) => PROJECT_STATUS_CATALOGUE[code].label)).toEqual([
      "Lên kế hoạch", "Đang triển khai", "Đang chạy thử", "Đang mở rộng sử dụng", "Chờ duyệt nghiệm thu",
      "Tạm dừng", "Có rủi ro", "Đã hoàn thành", "Đang bảo trì", "Đã đóng"
    ]);
    expect(PROJECT_STATUS_CODES.map((code) => PROJECT_STATUS_CATALOGUE[code].order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(PROJECT_STATUS_CODES.every((code) => PROJECT_STATUS_CATALOGUE[code].code === code)).toBe(true);
  });

  it("ranks precedence as closed > at risk > on hold > maintenance/completed > position statuses", () => {
    const byRank = [...PROJECT_STATUS_CODES].sort((a, b) => PROJECT_STATUS_CATALOGUE[a].priorityRank - PROJECT_STATUS_CATALOGUE[b].priorityRank);
    expect(byRank).toEqual(["closed", "at_risk", "on_hold", "maintenance", "completed", "in_review", "onboarding", "pilot", "active", "planning"]);
  });

  it("requires a reason only for on hold, at risk and closed", () => {
    expect(PROJECT_STATUS_CODES.filter((code) => PROJECT_STATUS_CATALOGUE[code].reasonRequired)).toEqual(["on_hold", "at_risk", "closed"]);
    expect(PROJECT_STATUS_CATALOGUE.on_hold.reasonLabel).toBe("Lý do tạm dừng");
    expect(Object.values(PROJECT_CLOSE_REASONS)).toEqual(["Thua deal", "Khách dừng hợp tác", "Hết hạn bảo trì", "Hủy nội bộ"]);
  });

  it("maps legacy aliases onto the canonical codes (9.3)", () => {
    const cases: Record<string, string> = {
      Planning: "planning", "Khảo sát": "planning", discovery: "planning",
      Active: "active", "Đang chạy": "active", in_progress: "active",
      "In review": "in_review", "Nghiệm thu": "in_review", acceptance: "in_review",
      "On Hold": "on_hold", pause: "on_hold", paused: "on_hold",
      "At risk": "at_risk", blocked: "at_risk",
      "Hoàn thành": "completed", completed: "completed", done: "completed",
      pilot: "pilot", onboarding: "onboarding", onboard: "onboarding", maintenance: "maintenance",
      cancelled: "closed", closed: "closed", archived: "closed"
    };
    for (const [stored, code] of Object.entries(cases)) expect(normalizeProjectStatus(stored), stored).toBe(code);
    // Every Vietnamese label is itself readable.
    for (const code of PROJECT_STATUS_CODES) expect(normalizeProjectStatus(PROJECT_STATUS_CATALOGUE[code].label)).toBe(code);
    // No stored value belongs to two codes.
    const all = Object.values(PROJECT_STATUS_ALIASES).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("rejects values outside the catalogue", () => {
    expect(["", "hold on", undefined, "something_else"].some(isKnownProjectStatus)).toBe(false);
    expect(projectStatusLabel("something_else")).toBeUndefined();
    expect(projectStatusLabel("in_progress")).toBe("Đang triển khai");
  });

  it("expands a status filter to every stored alias", () => {
    expect(projectStatusFilterValues("active")).toEqual(PROJECT_STATUS_ALIASES.active);
    expect(projectStatusFilterValues("paused")).toEqual(PROJECT_STATUS_ALIASES.on_hold);
    expect(projectStatusFilterValues("Something Else")).toEqual(["something_else"]);
    expect(projectStatusFilterValues(null)).toBeNull();
  });
});

describe("validateProjectStatusChange", () => {
  it("requires a reason for on hold and an action/blocker for at risk", () => {
    expect(validateProjectStatusChange("in_progress", "on_hold", "  ").error).toContain("Tạm dừng");
    expect(validateProjectStatusChange("in_progress", "at_risk", undefined).error).toContain("Có rủi ro");
    expect(validateProjectStatusChange("in_progress", "on_hold", "Chờ khách hàng")).toEqual({ changed: true, from: "active", to: "on_hold" });
  });

  it("does not ask for a reason when the status is unchanged or needs none", () => {
    expect(validateProjectStatusChange("paused", "on_hold", "")).toEqual({ changed: false, from: "on_hold", to: "on_hold" });
    expect(validateProjectStatusChange("planning", "active", "")).toEqual({ changed: true, from: "planning", to: "active" });
    expect(validateProjectStatusChange("active", "pilot", "")).toEqual({ changed: true, from: "active", to: "pilot" });
    expect(validateProjectStatusChange("completed", "maintenance", "").error).toBeUndefined();
  });

  it("applies the same rule on create, where there is no previous status", () => {
    expect(validateProjectStatusChange(undefined, "on_hold", undefined).error).toBeTruthy();
    expect(validateProjectStatusChange(undefined, "at_risk", "Blocked by vendor").error).toBeUndefined();
    expect(validateProjectStatusChange(undefined, "planning", undefined)).toMatchObject({ changed: true, to: "planning" });
  });

  it("closing needs a close reason from the list; the note is optional", () => {
    expect(validateProjectStatusChange("active", "closed", "ghi chú").error).toContain("lý do đóng");
    expect(validateProjectStatusChange("active", "closed", "", "something").error).toBeTruthy();
    expect(validateProjectStatusChange("active", "closed", "", "lost_deal")).toEqual({ changed: true, from: "active", to: "closed" });
    expect(validateProjectStatusChange("in_progress", "cancelled", undefined, "internal_cancel").error).toBeUndefined();
  });

  it("closed is terminal: leaving it is a reopen that needs a reason", () => {
    expect(isProjectClosed("closed")).toBe(true);
    expect(isProjectClosed("archived")).toBe(true);
    expect(isProjectClosed("completed")).toBe(false);
    expect(validateProjectStatusChange("closed", "active", "").error).toContain("Mở lại");
    expect(validateProjectStatusChange("closed", "active", "Khách quay lại")).toEqual({ changed: true, from: "closed", to: "active" });
    expect(validateProjectStatusChange("closed", "closed", "")).toMatchObject({ changed: false });
  });
});

describe("who may close or reopen", () => {
  it("PM (project manager / admin) or BD may close", () => {
    expect(canCloseProject(["WORKSPACE_USER"], true)).toBe(true);
    expect(canCloseProject(["FOUNDER_GM"])).toBe(true);
    expect(canCloseProject(["WORKSPACE_ADMIN"])).toBe(true);
    expect(canCloseProject(["SALES_OWNER"])).toBe(true);
    expect(canCloseProject(["WORKSPACE_USER", "DELIVERY_LEAD", "FINANCE_ADMIN"])).toBe(false);
  });

  it("only an admin may reopen", () => {
    expect(canReopenProject(["FOUNDER_GM"])).toBe(true);
    expect(canReopenProject(["WORKSPACE_ADMIN"])).toBe(true);
    expect(canReopenProject(["SALES_OWNER", "DELIVERY_LEAD"])).toBe(false);
  });
});
