import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, adminSectionFromHash } from "./admin-sections";

describe("admin sections", () => {
  it("does not expose the removed milestone configuration section", () => {
    expect(ADMIN_SECTIONS).not.toContain("milestones");
  });

  it("falls back to overview when an old milestone hash is opened", () => {
    expect(adminSectionFromHash("#milestones")).toBe("overview");
  });

  it("keeps supported section hashes working", () => {
    expect(adminSectionFromHash("#pnl-config")).toBe("pnl-config");
  });
});
