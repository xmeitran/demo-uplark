import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearchText } from "./crm-select-search";

describe("normalizeSearchText", () => {
  it("strips Vietnamese diacritics, including đ, and lower-cases", () => {
    expect(normalizeSearchText("  Nguyễn Thị Huyền ")).toBe("nguyen thi huyen");
    expect(normalizeSearchText("Đỗ Đức Dũng")).toBe("do duc dung");
  });
});

describe("matchesSearch", () => {
  it("matches without accents in either the query or the text", () => {
    expect(matchesSearch("huyen", "Nguyễn Thị Huyền")).toBe(true);
    expect(matchesSearch("Huyền", "nguyen thi huyen")).toBe(true);
    expect(matchesSearch("hung", "Nguyễn Thị Huyền")).toBe(false);
  });

  it("searches every field passed and treats an empty query as a match", () => {
    expect(matchesSearch("dezon.vn", "Huyền", undefined, "huyen@dezon.vn")).toBe(true);
    expect(matchesSearch("   ", "Huyền")).toBe(true);
  });
});
