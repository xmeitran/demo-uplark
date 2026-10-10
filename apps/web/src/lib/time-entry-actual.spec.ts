import { describe, expect, it } from "vitest";
import { isActualTimeEntry } from "./time-entry-actual";

describe("isActualTimeEntry", () => {
  it.each(["rejected", "cancelled", "planned", "REJECTED", " Planned "])("excludes %s", (approvalStatus) => {
    expect(isActualTimeEntry({ approvalStatus })).toBe(false);
  });

  it.each(["approved", "submitted", "pending", "", undefined, null])("counts %s as actual", (approvalStatus) => {
    expect(isActualTimeEntry({ approvalStatus })).toBe(true);
  });

  it("counts an entry without the field as actual", () => {
    expect(isActualTimeEntry({})).toBe(true);
  });
});
