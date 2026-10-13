import { describe, expect, it } from "vitest";
import { baselineCauseLabel, baselineDiffLine } from "./baseline-view";

describe("baseline block", () => {
  it("writes one readable line per changed row", () => {
    expect(baselineDiffLine({ entity: "task", id: "t1", name: "Khảo sát", change: "changed", fields: [{ field: "Giờ dự kiến (phút)", before: 480, after: 960 }] })).toBe("Task Khảo sát: Giờ dự kiến 8 giờ → 16 giờ");
    expect(baselineDiffLine({ entity: "task", id: "t2", name: "Đào tạo", change: "added" })).toBe("Task Đào tạo: thêm mới");
    expect(baselineDiffLine({ entity: "stage", id: "s1", name: "Build", change: "changed", fields: [{ field: "Ngày kết thúc", before: null, after: "2026-10-15T00:00:00.000Z" }] })).toMatch(/^Stage Build: Ngày kết thúc — → \d{2}\/\d{2}\/2026$/);
    expect(baselineCauseLabel({ causeType: "gate", causeCode: "G1" })).toBe("Điểm chốt G1");
    // A version an old change request wrote keeps a readable cause.
    expect(baselineCauseLabel({ causeType: "change_request", causeCode: "CR-001" })).toBe("Yêu cầu thay đổi (dữ liệu cũ) CR-001");
    expect(baselineCauseLabel({ causeType: "stage_extension" })).toBe("Gia hạn stage");
  });
});
