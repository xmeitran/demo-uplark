import { describe, expect, it } from "vitest";
import { formatProjectDateRange, uiProjectDateToIso } from "./project-date";

describe("project date serialization", () => {
  it("keeps date-only input on the same calendar day", () => {
    expect(uiProjectDateToIso("2026-07-15")?.slice(0, 10)).toBe("2026-07-15");
  });

  it("fails closed for invalid or empty values", () => {
    expect(uiProjectDateToIso("TBD")).toBeNull();
    expect(uiProjectDateToIso("not-a-date")).toBeNull();
  });
});

describe("project hierarchy date range presentation", () => {
  it("renders start and due dates in chronological order", () => {
    expect(formatProjectDateRange("Jul 1, 2026", "Jul 31, 2026")).toBe("Jul 1, 2026 đến Jul 31, 2026");
  });

  it("renders a start-only range without inventing a due date", () => {
    expect(formatProjectDateRange("Jul 1, 2026", undefined)).toBe("Từ Jul 1, 2026");
  });

  it("renders a due-only range without inventing a start date", () => {
    expect(formatProjectDateRange(undefined, "Jul 31, 2026")).toBe("Đến Jul 31, 2026");
  });

  it("uses the requested surface fallback when both dates are absent", () => {
    expect(formatProjectDateRange(undefined, undefined)).toBe("Not set");
    expect(formatProjectDateRange("TBD", "Not set", "TBD")).toBe("TBD");
    expect(formatProjectDateRange("Invalid Date", "Invalid Date")).toBe("Not set");
  });

  it("preserves already-formatted display values", () => {
    expect(formatProjectDateRange("01/07/2026", "31/07/2026")).toBe("01/07/2026 đến 31/07/2026");
  });
});
