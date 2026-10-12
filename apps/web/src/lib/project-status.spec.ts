import { describe, expect, it } from "vitest";
import * as api from "../../../api/src/modules/delivery-handoff/project-status";
import {
  PROJECT_CLOSE_REASONS, PROJECT_STATUS_ALIASES, PROJECT_STATUS_CATALOGUE, PROJECT_STATUS_CODES, PROJECT_STATUS_COLOR_FAMILY, PROJECT_STATUS_OPTIONS,
  normalizeProjectStatus, projectStatusLabel, projectStatusOrder, resolveProjectStatus
} from "./project-status";

describe("project status catalogue (web mirror of the API)", () => {
  it("is identical to the API catalogue, alias table and close reasons", () => {
    expect(PROJECT_STATUS_CODES).toEqual(api.PROJECT_STATUS_CODES);
    expect(PROJECT_STATUS_CATALOGUE).toEqual(api.PROJECT_STATUS_CATALOGUE);
    expect(PROJECT_STATUS_ALIASES).toEqual(api.PROJECT_STATUS_ALIASES);
    expect(PROJECT_CLOSE_REASONS).toEqual(api.PROJECT_CLOSE_REASONS);
  });

  it("maps legacy aliases onto the ten canonical codes", () => {
    expect(normalizeProjectStatus("in_progress")).toBe("active");
    expect(normalizeProjectStatus("On Hold")).toBe("on_hold");
    expect(normalizeProjectStatus("paused")).toBe("on_hold");
    expect(normalizeProjectStatus("acceptance")).toBe("in_review");
    expect(normalizeProjectStatus("Nghiệm thu")).toBe("in_review");
    expect(normalizeProjectStatus("done")).toBe("completed");
    expect(normalizeProjectStatus("discovery")).toBe("planning");
    expect(normalizeProjectStatus("Khảo sát")).toBe("planning");
    expect(normalizeProjectStatus("blocked")).toBe("at_risk");
    expect(normalizeProjectStatus("pilot")).toBe("pilot");
    expect(normalizeProjectStatus("onboard")).toBe("onboarding");
    expect(normalizeProjectStatus("maintenance")).toBe("maintenance");
    for (const stored of ["cancelled", "closed", "archived"]) expect(normalizeProjectStatus(stored)).toBe("closed");
    // A label reads back as its own code, so label-valued UI state round-trips.
    for (const option of PROJECT_STATUS_OPTIONS) expect(normalizeProjectStatus(option.label)).toBe(option.code);
  });

  it("prefers the API statusCode over the raw status", () => {
    expect(resolveProjectStatus({ statusCode: "on_hold", status: "in_progress" })).toBe("on_hold");
    expect(resolveProjectStatus({ status: "onboarding" })).toBe("onboarding");
  });

  it("shows Vietnamese labels and never defaults an unknown or missing status", () => {
    expect(resolveProjectStatus({ status: "hold on" })).toBeNull();
    expect(resolveProjectStatus({})).toBeNull();
    expect(projectStatusLabel(null)).toBe("Chưa xác định");
    expect(projectStatusLabel("in_review")).toBe("Chờ duyệt nghiệm thu");
    expect(PROJECT_STATUS_OPTIONS.map((option) => option.label)).toEqual([
      "Lên kế hoạch", "Đang triển khai", "Đang chạy thử", "Đang mở rộng sử dụng", "Chờ duyệt nghiệm thu",
      "Tạm dừng", "Có rủi ro", "Đã hoàn thành", "Đang bảo trì", "Đã đóng"
    ]);
  });

  it("sorts by catalogue order with unknown last, and reuses the six colour families plus a neutral closed", () => {
    expect(["Đã đóng", "???", "Tạm dừng", "in_progress", "Lên kế hoạch"].sort((a, b) => projectStatusOrder(a) - projectStatusOrder(b))).toEqual(["Lên kế hoạch", "in_progress", "Tạm dừng", "Đã đóng", "???"]);
    expect(PROJECT_STATUS_COLOR_FAMILY).toMatchObject({ pilot: "active", onboarding: "active", maintenance: "completed", closed: "closed" });
  });
});
