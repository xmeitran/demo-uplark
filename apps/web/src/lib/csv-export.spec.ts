import { describe, expect, it } from "vitest";
import { createCsv } from "./csv-export";

describe("safe CSV export", () => {
  it("escapes quotes and new lines", () => {
    expect(createCsv(["Name"], [["A, \"quoted\"\nvalue"]])).toBe('"Name"\r\n"A, ""quoted""\nvalue"');
  });

  it("neutralizes spreadsheet formulas", () => {
    const csv = createCsv(
      ["=unsafe header"],
      [["=2+2"], ["+SUM(A1:A2)"], ["-1"], ["@cmd"], ["  =HYPERLINK(\"https://example.invalid\")"], ["\t@SUM(A1:A2)"]]
    );
    expect(csv).toContain('"\'=2+2"');
    expect(csv).toContain('"\'  =HYPERLINK(""https://example.invalid"")"');
    expect(csv).toContain('"\'\t@SUM(A1:A2)"');
    expect(csv.startsWith('"\'=unsafe header"\r\n')).toBe(true);
    expect(createCsv(["Value"], [["safe"]])).toContain('"safe"');
  });
});
