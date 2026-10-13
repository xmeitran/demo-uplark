import { describe, expect, it } from "vitest";
import { csvIn, csvList, vietnamDayRange } from "./list-filters";

describe("list filters", () => {
  it("reads csv, repeated and single values; trims, dedupes and caps", () => {
    expect(csvList("a, b,,a")).toEqual(["a", "b"]);
    expect(csvList(["a,b", "c"])).toEqual(["a", "b", "c"]);
    expect(csvList(undefined)).toEqual([]);
    expect(csvList("a,b,c", 2)).toEqual(["a", "b"]);
    expect(csvIn("")).toBeUndefined();
    expect(csvIn("x")).toEqual({ in: ["x"] });
  });

  it("turns inclusive Vietnam days into a half-open UTC range", () => {
    expect(vietnamDayRange("", undefined)).toBeUndefined();
    expect(vietnamDayRange("2026-10-01", "2026-10-01")).toEqual({ gte: new Date("2026-09-30T17:00:00.000Z"), lt: new Date("2026-10-01T17:00:00.000Z") });
    expect(vietnamDayRange(undefined, "2026-10-01")).toEqual({ lt: new Date("2026-10-01T17:00:00.000Z") });
    expect(() => vietnamDayRange("01/10/2026", "")).toThrow();
  });
});
