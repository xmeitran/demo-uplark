import { describe, expect, it } from "vitest";
import { normalizeNodeStatus } from "./timesheet-status";

describe("live timesheet status mapping", () => {
  it.each(["waiting", "pending", "on_hold"])("maps %s to Đang chờ", (status) => {
    expect(normalizeNodeStatus(status)).toBe("waiting");
  });

  it("keeps completed aliases as Đã hoàn thành", () => {
    expect(normalizeNodeStatus("done")).toBe("completed");
  });
});
