import { describe, expect, it } from "vitest";
import { baselineCauseLabel, baselineDiffLine, parseCsvRows } from "./baseline-view";

describe("baseline block", () => {
  it("writes one readable line per changed row", () => {
    expect(baselineDiffLine({ entity: "task", id: "t1", name: "Khảo sát", change: "changed", fields: [{ field: "Giờ dự kiến (phút)", before: 480, after: 960 }] })).toBe("Task Khảo sát: Giờ dự kiến 8 giờ → 16 giờ");
    expect(baselineDiffLine({ entity: "lineItem", id: "i2", name: "CR-001", change: "added" })).toBe("Hạng mục CR-001: thêm mới");
    expect(baselineDiffLine({ entity: "stage", id: "s1", name: "Build", change: "changed", fields: [{ field: "Ngày kết thúc", before: null, after: "2026-10-15T00:00:00.000Z" }] })).toMatch(/^Stage Build: Ngày kết thúc — → \d{2}\/\d{2}\/2026$/);
    expect(baselineCauseLabel({ causeType: "change_request", causeCode: "CR-001" })).toBe("Yêu cầu thay đổi CR-001");
    expect(baselineCauseLabel({ causeType: "stage_extension" })).toBe("Gia hạn stage");
  });
});

describe("CR Log file → rows", () => {
  it("reads quoted cells, doubled quotes, semicolon files and skips blank lines", () => {
    expect(parseCsvRows('﻿Mã CR,Tiêu đề,Trạng thái CR\r\nCR-001,"Thêm báo cáo, ""tồn kho""",Open\r\n\r\nCR-002,Đổi luồng,Approved\n')).toEqual([
      { "Mã CR": "CR-001", "Tiêu đề": 'Thêm báo cáo, "tồn kho"', "Trạng thái CR": "Open" },
      { "Mã CR": "CR-002", "Tiêu đề": "Đổi luồng", "Trạng thái CR": "Approved" }
    ]);
    expect(parseCsvRows("Mã CR;Tiêu đề\nCR-003;A, B")).toEqual([{ "Mã CR": "CR-003", "Tiêu đề": "A, B" }]);
  });
});
