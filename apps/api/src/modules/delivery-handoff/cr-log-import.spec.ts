import { describe, expect, it } from "vitest";
import { highestCrNumber, importCrLog, mapCrLogRows, normalizeHeader } from "./cr-log-import";
import { fakePrisma } from "./fake-prisma.testing";
import { nextIssueLogCode } from "./issue-log.service";

const FILE = [
  { "Mã CR": "CR-007", "Tiêu đề": "Thêm báo cáo", "Mô tả": "Báo cáo tồn kho theo tuần", "Người yêu cầu": "Chị Hoa", "Ngày yêu cầu": "05/09/2026", "Trạng thái CR": "Assessing", "Ghi chú nội bộ": "x" },
  { "Mã CR": "cr-012", "Tiêu đề": "Đổi luồng duyệt", "Trạng thái CR": "Approved", "Quyết định KH": "Approved", "Trạng thái triển khai": "QA/UAT", "Trạng thái cuối": "Closed/Accepted", "Ngày đóng": "2026-10-01" },
  { "Mã CR": "CR-009", "Tiêu đề": "Thêm trường", "Trạng thái CR": "Awaiting Customer Approval", "Quyết định KH": "Pending" },
  { "Mã CR": "CR-010", "Tiêu đề": "Huỷ", "Trạng thái cuối": "Cancelled", "Ngày yêu cầu": 46_270 },
  { "Mã CR": "", "Tiêu đề": "Thiếu mã" },
  { "Mã CR": "CR-011", "Tiêu đề": "Trạng thái lạ", "Trạng thái CR": "Đang nghĩ" },
  { "Mã CR": "CR-007", "Tiêu đề": "Trùng mã" },
  { "Mã CR": "CR-013", "Tiêu đề": "Ngày sai", "Ngày yêu cầu": "hôm qua" },
  {}
];

describe("9.4 CR Log import: column mapping", () => {
  it("matches headers without case, accents or punctuation", () => {
    expect(["Mã CR", "TRẠNG THÁI CR", "Quyết định KH", "QA/UAT", "Người yêu cầu"].map(normalizeHeader)).toEqual(["ma cr", "trang thai cr", "quyet dinh kh", "qa uat", "nguoi yeu cau"]);
  });

  it("keeps the old code, collapses the four status columns per table 5.4 and reports what it cannot map", () => {
    const { mapped, rejected, unmappedColumns } = mapCrLogRows(FILE);
    expect(mapped.map((row) => [row.code, row.status, row.crStep])).toEqual([
      ["CR-007", "assessing", "CR-02"],
      ["CR-012", "closed", "CR-09"], // the most final column decides
      ["CR-009", "customer_approval", "CR-06"],
      ["CR-010", "deferred", null]
    ]);
    expect(mapped[0]).toMatchObject({ description: "Thêm báo cáo — Báo cáo tồn kho theo tuần", createdAt: new Date("2026-09-05T00:00:00.000Z"), closedAt: null, extension: { requesterName: "Chị Hoa", intakeChannel: "other" } });
    expect(mapped[1].closedAt).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    expect(mapped[3].createdAt?.toISOString().slice(0, 10)).toBe("2026-09-05"); // Excel serial date
    expect(rejected).toEqual([
      { row: 5, reason: "Thiếu mã CR." },
      { row: 6, code: "CR-011", reason: 'Trạng thái "Đang nghĩ" không có trong bảng quy đổi 5.4.' },
      { row: 7, code: "CR-007", reason: "Mã CR-007 lặp lại trong file." },
      { row: 8, code: "CR-013", reason: "Ngày không đọc được (dùng dd/mm/yyyy hoặc yyyy-mm-dd)." }
    ]);
    expect(unmappedColumns).toEqual(["Ghi chú nội bộ"]);
    expect(highestCrNumber(["CR-007", "CR-012", "ABC-99", "CR-x"])).toBe(12);
  });
});

describe("9.4 CR Log import: persistence", () => {
  const project = { id: "p1", accountId: "a1" };
  const ctx = (prisma: any, isAdmin = true) => ({ prisma, principal: { workspaceId: "w", subjectId: "admin", displayName: "Admin" } as any, actor: { userId: "admin", isAdmin, isPm: true, isBd: false, isMember: true }, now: new Date("2026-10-12T03:00:00.000Z") });

  it("is Admin only", async () => {
    await expect(importCrLog(ctx(fakePrisma().prisma, false), project, FILE)).rejects.toThrow(/Chỉ Admin/);
  });

  it("creates the records with their old codes, moves the counter past the highest number, and a re-import changes nothing", async () => {
    const { prisma, table } = fakePrisma({ projectRiskCounter: [{ projectId: "p1", prefix: "CR", last: 3 }] });
    const first = await importCrLog(ctx(prisma), project, FILE);
    expect(first).toMatchObject({ created: ["CR-007", "CR-012", "CR-009", "CR-010"], unchanged: [], counterLast: 12 });
    expect(first.rejected).toHaveLength(4);
    expect(table("projectRisk").find((row) => row.code === "CR-012")).toMatchObject({ type: "change_request", status: "closed", crStep: "CR-09", projectId: "p1", accountId: "a1" });
    expect(table("projectRiskEvent").every((event) => event.action === "migrated")).toBe(true);
    // The next request created in the system continues after the imported numbers.
    expect(await nextIssueLogCode(prisma, "p1", "change_request")).toBe("CR-013");

    table("projectRisk").find((row) => row.code === "CR-009")!.status = "approved"; // moved on in the system meanwhile
    const second = await importCrLog(ctx(prisma), project, FILE);
    expect(second).toMatchObject({ created: [], unchanged: ["CR-007", "CR-012", "CR-009", "CR-010"], counterLast: 13 });
    expect(table("projectRisk")).toHaveLength(4);
    expect(table("projectRisk").find((row) => row.code === "CR-009")!.status).toBe("approved");
  });
});
