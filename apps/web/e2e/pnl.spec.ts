import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import type {
  PnlCostItem, PnlCostItemsResponse, PnlDashboardProjectRow, PnlDashboardResponse, PnlFundsResponse, PnlHourReconciliation, PnlMeta,
  PnlParameterRow, PnlParametersResponse, PnlPeriodsResponse, PnlProjectMonthDetail, PnlProjectMonthDetailResponse, PnlProjectResponse, PnlResult,
  PnlSourceEntriesResponse, PnlStaffCostsResponse, PnlTemplatesResponse
} from "@b2b-crm/contracts";

/*
 * Tab P&L (routes /pnl, /pnl/[projectId], /pnl/hours, /pnl/costs?tab=…, /users/costs). Every /api/pnl/* call is mocked
 * with fixtures typed by packages/contracts/src/pnl.ts. The assertions follow the structure of the wireframes in
 * docs/yeu-cau-tab-pnl-hinh; project figures are Phụ lục B of the specification (DT 67.200.000, CP 30.970.000,
 * EBIT 36.230.000, biên 53,9%); the dashboard figures are those drawn on the mục 4 wireframe.
 */

const M = 1_000_000;
const H = 60;

const authUser = { id: "usr-pnl", name: "PnL QA", email: "pnl-qa@example.com", initials: "PQ", avatarColor: "#2563eb", role: "FOUNDER_GM" };

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installAuthenticatedBrowser(context: BrowserContext, page: Page, baseURL?: string) {
  const origin = new URL(baseURL ?? "http://127.0.0.1:3903").origin;
  await context.addCookies([{ name: "lcrm_session", value: "pnl-e2e-session", url: origin, httpOnly: true, secure: origin.startsWith("https:"), sameSite: "Lax" }]);
  await page.addInitScript((user) => { window.localStorage.setItem("crm_auth_user", JSON.stringify(user)); }, authUser);
  // Anything the shell asks for that a test does not care about gets an empty list, never the real API.
  await page.route("**/api/**", route => fulfillJson(route, { data: [], meta: {} }));
  await page.route("**/api/auth/me", route => fulfillJson(route, {
    subjectId: authUser.id, displayName: authUser.name, email: authUser.email, tenantKey: "qa", workspaceId: "twk-qa", roleCodes: ["FOUNDER_GM"]
  }));
}

// --- Fixtures -----------------------------------------------------------------

const meta = (moneyVisible = true): PnlMeta => ({
  generatedAt: "2026-10-12T01:30:00.000Z", currency: "VND", moneyVisible, canEdit: moneyVisible, canApprove: moneyVisible, canExport: moneyVisible
});
const official: PnlResult = { label: "official", labelText: "Chính thức", reasons: [] };
const provisional: PnlResult = {
  label: "provisional", labelText: "Tạm tính",
  reasons: [
    { code: "pending_cost_rate", label: "105,5 giờ chờ cost rate", minutes: 6330, userCount: 1, target: "staff_costs" },
    { code: "months_unlocked", label: "tháng 08, 09 chưa khóa", periodKeys: ["2026-08", "2026-09"], target: "periods" }
  ]
};
const reconciliation = (logged: number, included: number, pending: number, excluded: number): PnlHourReconciliation => ({
  loggedMinutes: logged, includedMinutes: included, pendingMinutes: pending, excludedMinutes: excluded, differenceMinutes: 0, balanced: true
});
/** Hides every money figure the way the API does for an Admin outside the cost permission group. */
const money = (visible: boolean, amount: number | null) => (visible ? amount : null);

function dashboardRow(id: string, pic: string, startedOn: string, acceptedOn: string | null, figures: [number, number, number] | null, result: PnlResult, visible: boolean): PnlDashboardProjectRow {
  const letter = id.slice(-1).toUpperCase();
  const [revenue, labor, other] = figures ?? [0, 30 * M, 5 * M];
  const accepted = acceptedOn !== null;
  return {
    projectId: id, projectCode: `DA-${letter}`, projectName: `Dự án ${letter}`, accountId: `acc-${letter}`, accountName: `Khách ${letter}`, projectType: "delivery",
    picUserId: `usr-${pic}`, picName: pic, startedOn, acceptedOn, acceptedOnEstimated: false,
    revenueAmount: accepted ? money(visible, revenue) : null, laborCostAmount: money(visible, labor), otherCostAmount: money(visible, other),
    totalCostAmount: money(visible, labor + other), ebitAmount: accepted ? money(visible, revenue - labor - other) : null,
    marginPercent: accepted ? money(visible, ((revenue - labor - other) / revenue) * 100) : null,
    result, adjustedAfterClose: false, costByAccountingGroup: {}, costByRoleGroup: {}, reconciliation: reconciliation(0, 0, 0, 0)
  };
}

function dashboardFixture(visible = true): PnlDashboardResponse {
  const totalResult: PnlResult = { ...provisional, labelText: "Tạm tính · 2 dự án" };
  return {
    data: {
      filter: {
        year: 2026, unit: "year", index: null, rule: "started_and_accepted", fromPeriodKey: "2026-01", toPeriodKey: "2026-12",
        countedProjectCount: 3, excludedTestProjectCount: 4,
        options: { years: [2026, 2025], projectTypes: [{ value: "delivery", label: "Khách hàng" }], accounts: [{ id: "acc-A", name: "Khách A" }], pics: [{ id: "usr-PM-1", name: "PM-1" }] },
        hint: "nên xem kỳ dài (6 tháng đến 1 năm) vì dự án thường kéo dài hơn 2 tháng"
      },
      totals: {
        projectCount: 3, revenueAmount: money(visible, 1240 * M), totalCostAmount: money(visible, 812 * M), laborCostAmount: money(visible, 690 * M), otherCostAmount: money(visible, 122 * M),
        ebitAmount: money(visible, 428 * M), marginPercent: money(visible, 34.5161), result: totalResult, provisionalProjectCount: 2, notComputableProjectCount: 0
      },
      pending: [
        { kind: "cost_rate", label: "105,5 giờ chờ cost rate", minutes: 6330, userCount: 1, target: "staff_costs" },
        { kind: "classification", label: "12 giờ thiếu hạng mục", minutes: 720, target: "pending_hours" },
        { kind: "fund_unallocated", label: "quỹ tháng 09 chưa chia", periodKeys: ["2026-09"], target: "funds" }
      ],
      costGroups: {
        accounting: [
          { key: "LABOR", label: "Chi phí nhân sự", amount: money(visible, 690 * M), sharePercent: 84.98 },
          { key: "FUND", label: "Quỹ chung", amount: money(visible, 52 * M), sharePercent: 6.4 },
          { key: "COMMISSION", label: "Hoa hồng", amount: money(visible, 62 * M), sharePercent: 7.64 },
          { key: "DIRECT", label: "Chi phí riêng", amount: money(visible, 8 * M), sharePercent: 0.99 }
        ],
        role: [
          { key: "DELIVERY", label: "Delivery/DX", amount: money(visible, 520 * M), sharePercent: 64.04 },
          { key: "PM", label: "PM", amount: money(visible, 96 * M), sharePercent: 11.82 },
          { key: "BD", label: "BD", amount: money(visible, 74 * M), sharePercent: 9.11 },
          { key: "FUND", label: "Quỹ chung", amount: money(visible, 52 * M), sharePercent: 6.4 },
          { key: "COMMISSION", label: "Hoa hồng", amount: money(visible, 62 * M), sharePercent: 7.64 },
          { key: "DIRECT", label: "Chi phí riêng", amount: money(visible, 8 * M), sharePercent: 0.99 }
        ]
      },
      accepted: {
        total: 3, page: 1, pageSize: 20,
        rows: [
          dashboardRow("prj-a", "PM-1", "2026-03-02", "2026-07-20", [420 * M, 236 * M, 41 * M], official, visible),
          dashboardRow("prj-b", "PM-2", "2026-02-10", "2026-08-14", [560 * M, 318 * M, 52 * M], provisional, visible),
          dashboardRow("prj-c", "PM-1", "2026-05-05", "2026-09-25", [260 * M, 136 * M, 29 * M], provisional, visible)
        ],
        totalRow: { revenueAmount: money(visible, 1240 * M), laborCostAmount: money(visible, 690 * M), otherCostAmount: money(visible, 122 * M), ebitAmount: money(visible, 428 * M), marginPercent: money(visible, 34.5161), result: totalResult },
        reconciliation: reconciliation(2140 * H, 1986 * H, 117.5 * H, 36.5 * H)
      },
      inProgress: { total: 7, page: 1, pageSize: 20, rows: [dashboardRow("prj-d", "PM-2", "2026-06-01", null, null, provisional, visible)] },
      companyCosts: {
        periodKeys: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"],
        staffCostAmount: money(visible, 838 * M), projectLaborAmount: money(visible, 690 * M),
        lines: [
          { key: "pre_sale", label: "Chi phí Pre-sale của deal thua", amount: money(visible, 18 * M), minutes: 90 * H, uncostedMinutes: 0, byMonth: [] },
          { key: "after_close", label: "Chi phí sau nghiệm thu", amount: money(visible, 24 * M), minutes: 120 * H, uncostedMinutes: 0, byMonth: [] },
          { key: "internal", label: "Chi phí nội bộ", amount: money(visible, 65 * M), minutes: 320 * H, uncostedMinutes: 0, byMonth: [] },
          { key: "unallocated", label: "Chi phí nhân sự chưa phân bổ", amount: money(visible, 41 * M), minutes: 0, uncostedMinutes: 0, byMonth: [] }
        ],
        overAllocatedAmount: money(visible, 0), balanced: true
      }
    },
    meta: meta(visible)
  };
}

/** Phụ lục B: Dự án A, tháng 08 và 09/2026. `scope` = the narrowed month range of the request, if any. */
function projectFixture(visible = true, scope: { from: string; to: string } | null = null): PnlProjectResponse {
  const whole = scope === null;
  const person = (userId: string | null, displayName: string, role: "DELIVERY" | "PM" | "BD" | null, planned: number, logged: number | null, included: number | null, cost: number | null, status: string | null) => ({
    userId, displayName, roleGroup: role, roleGroupLabel: role === "DELIVERY" ? "Delivery" : role, plannedMinutes: planned * H,
    loggedMinutes: logged === null ? null : logged * H, includedMinutes: included === null ? null : included * H, laborCostAmount: money(visible, cost),
    status: status === null ? null : { ok: status === "Đủ", label: status, missing: status === "Đủ" ? [] : [{ kind: "cost_rate" as const, label: "Thiếu cost rate", periodKey: "2026-09", target: "staff_costs" as const }] }
  });
  const missingCostRate = { kind: "cost_rate" as const, label: "Thiếu cost rate", minutes: 6330, periodKey: "2026-09", userIds: ["usr-b"], target: "staff_costs" as const };
  const pendingByReason = [{ reason: "missing_staff_cost" as const, label: "Chờ cost rate", minutes: 6330 }];
  return {
    data: {
      header: {
        projectId: "prj-a", projectCode: "DA-A", projectName: "Dự án A", accountId: "acc-A", accountName: "Khách A", projectType: "delivery", templateKey: "customer", templateName: "Khách hàng",
        picUserId: "usr-pm1", picName: "PM-1", projectStatus: "Đang triển khai", plannedStartOn: null, plannedEndOn: null, acceptedOn: null, acceptedOnEstimated: false, closeGate: "G7",
        isTestProject: false, recordState: "recognizing", recordStateLabel: "Đang ghi nhận", result: provisional,
        scope: { whole, fromPeriodKey: scope?.from ?? null, toPeriodKey: scope?.to ?? null, minPeriodKey: "2026-08", maxPeriodKey: "2026-09" }
      },
      totals: {
        plannedMinutes: 260 * H, loggedMinutes: 273.5 * H, loggedVsPlanPercent: 5.1923, monthsWithHours: 2,
        revenue: { amount: whole ? money(visible, 67_200_000) : null, basis: "contract", label: "Doanh thu", note: whole ? "giá trị HĐ, chưa G7" : "Chỉ xem ở Toàn dự án", wholeProjectOnly: !whole, missingReason: null },
        cost: { totalAmount: money(visible, 30_970_000), laborAmount: money(visible, 26_350_000), otherAmount: money(visible, 4_620_000) },
        ebit: { amount: whole ? money(visible, 36_230_000) : null, marginPercent: whole ? money(visible, 53.9137) : null, expected: true, label: "EBIT dự kiến", wholeProjectOnly: !whole, missingReason: null },
        costVsCap: null
      },
      people: [
        person("usr-a", "Nhân sự A", "DELIVERY", 120, 149, 149, 22_610_000, "Đủ"),
        person("usr-b", "Nhân sự B", "DELIVERY", 100, 105.5, 0, null, "Chờ cost rate T09"),
        person("usr-pm1", "PM-1", "PM", 16, 16, 16, 3_200_000, "Đủ"),
        person("usr-bd1", "BD-1", "BD", 3, 3, 3, 540_000, "Đủ"),
        person(null, "Chưa giao", null, 21, null, null, null, null)
      ],
      months: {
        whole: {
          loggedMinutes: 273.5 * H, includedMinutes: 168 * H, pendingMinutes: 105.5 * H, excludedMinutes: 0, excludedByReason: [], pendingByReason,
          laborCostAmount: money(visible, 26_350_000), otherCostAmount: money(visible, 4_620_000), fundCostAmount: money(visible, 1_260_000), directCostAmount: null, totalCostAmount: money(visible, 30_970_000),
          missing: [missingCostRate, { kind: "fund_unallocated", label: "Quỹ chưa chia", periodKey: "2026-09", target: "funds" }]
        },
        rows: [
          {
            periodKey: "2026-08", periodState: "awaiting_lock", periodStateLabel: "Chờ khóa", fromSnapshot: false, loggedMinutes: 139 * H, includedMinutes: 139 * H, pendingMinutes: 0, excludedMinutes: 0,
            excludedByReason: [], pendingByReason: [], laborCostAmount: money(visible, 21_340_000), otherCostAmount: money(visible, 1_260_000), fundCostAmount: money(visible, 1_260_000), directCostAmount: null,
            totalCostAmount: money(visible, 22_600_000), missing: []
          },
          {
            periodKey: "2026-09", periodState: "awaiting_lock", periodStateLabel: "Chờ khóa", fromSnapshot: false, loggedMinutes: 134.5 * H, includedMinutes: 29 * H, pendingMinutes: 105.5 * H, excludedMinutes: 0,
            excludedByReason: [], pendingByReason, laborCostAmount: money(visible, 5_010_000), otherCostAmount: null, fundCostAmount: null, directCostAmount: null,
            totalCostAmount: money(visible, 5_010_000), missing: [missingCostRate]
          }
        ],
        wholeProjectItems: [{ code: "CP.HOAHONG", label: "Hoa hồng", amount: whole ? money(visible, 3_360_000) : null, note: whole ? "Hoa hồng dự kiến" : "Chỉ xem ở Toàn dự án", expected: true }],
        afterClose: { visible: false, note: "Chưa qua G7 · hiện giờ và chi phí Milestone 4 theo tháng · không cộng vào Toàn dự án", minutes: 0, amount: null, uncostedMinutes: 0, rows: [] },
        reconciliation: reconciliation(273.5 * H, 168 * H, 105.5 * H, 0)
      },
      items: visible ? [
        { code: "DT", name: "Doanh thu ghi nhận", parentCode: null, level: 1, sign: 1, unit: "VND", method: "SYSTEM", methodLabel: "Lấy từ hệ thống", roleGroup: null, amount: 67_200_000, incomplete: false, source: { kind: "revenue", description: "Giá trị hợp đồng của các hạng mục Trọn gói", byMonth: [] } },
        { code: "CP", name: "Tổng chi phí", parentCode: null, level: 1, sign: -1, unit: "VND", method: "GROUP", methodLabel: "Tổng nhóm", roleGroup: null, amount: 30_970_000, incomplete: true, source: { kind: "group", description: "Cộng các khoản mục con", byMonth: [] } },
        { code: "CP.NS", name: "Chi phí nhân sự", parentCode: "CP", level: 2, sign: 1, unit: "VND", method: "SYSTEM", methodLabel: "Lấy từ hệ thống", roleGroup: "DELIVERY", amount: 26_350_000, incomplete: false, source: { kind: "hours", description: "Giờ tính P&L × cost rate tháng", byMonth: [{ periodKey: "2026-08", amount: 21_340_000 }, { periodKey: "2026-09", amount: 5_010_000 }] } },
        { code: "CP.RIENG", name: "Chi phí riêng của dự án", parentCode: "CP", level: 2, sign: 1, unit: "VND", method: "MANUAL", methodLabel: "Nhập tay", roleGroup: null, amount: null, incomplete: false, source: { kind: "manual", description: "Nhập theo tháng phát sinh", byMonth: [] }, manualLines: [] },
        { code: "EBIT.PCT", name: "Biên EBIT", parentCode: null, level: 1, sign: 1, unit: "PERCENT", method: "FORMULA", methodLabel: "Công thức", roleGroup: null, amount: 53.9137, incomplete: false, source: { kind: "formula", description: "[EBIT] ÷ [Doanh thu ghi nhận]", byMonth: [] } }
      ] : null,
      history: visible ? [{ id: "evt-1", at: "2026-10-05T02:00:00.000Z", actorName: "PM-1", action: "pnl.period_reopened", label: "Mở lại kỳ", periodKey: "2026-08", reason: "Bổ sung hóa đơn công cụ AI" }] : null
    },
    meta: meta(visible)
  };
}

function monthDetailFixture(periodKey: string, visible = true): PnlProjectMonthDetail {
  const september = periodKey === "2026-09";
  const days = Array.from({ length: september ? 30 : 31 }, (_, index) => {
    const dateKey = `${periodKey}-${String(index + 1).padStart(2, "0")}`;
    const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    return { dateKey, weekend: weekday === 0 || weekday === 6, holiday: dateKey === "2026-09-02", ...(dateKey === "2026-09-02" ? { holidayName: "Quốc khánh" } : {}) };
  });
  const day = (date: string, logged: number, included: number) => ({ dateKey: `${periodKey}-${date}`, loggedMinutes: logged * H, includedMinutes: included * H, pendingMinutes: (logged - included) * H, excludedMinutes: 0 });
  return {
    periodKey, periodState: "awaiting_lock", standardMinutes: 176 * H, days,
    people: [
      { userId: "usr-a", displayName: "Nhân sự A", roleGroup: "DELIVERY", roleGroupLabel: "Delivery", hourlyCostRate: money(visible, 162_381), loggedMinutes: 29 * H, includedMinutes: 29 * H, pendingMinutes: 0, excludedMinutes: 0, laborCostAmount: money(visible, 5_010_000), status: { ok: true, label: "Đủ" }, leaveDays: [`${periodKey}-04`], byDay: [day("03", 8, 8)] },
      { userId: "usr-b", displayName: "Nhân sự B", roleGroup: "DELIVERY", roleGroupLabel: "Delivery", hourlyCostRate: null, loggedMinutes: 105.5 * H, includedMinutes: 0, pendingMinutes: 105.5 * H, excludedMinutes: 0, laborCostAmount: null, status: { ok: false, label: "Chờ cost rate" }, leaveDays: [], byDay: [day("03", 7.5, 0)] }
    ],
    tasks: [{
      taskId: "task-1", taskTitle: "Cấu hình Base bán hàng", contractItemId: "hm-01", contractItemCode: "HM-01", layer1: "DELIVERY", loggedMinutes: 134.5 * H, includedMinutes: 29 * H, pendingMinutes: 105.5 * H, excludedMinutes: 0,
      laborCostAmount: money(visible, 5_010_000), reasons: [{ reason: "missing_staff_cost", label: "Chờ cost rate", minutes: 6330 }]
    }],
    reconciliation: reconciliation(134.5 * H, 29 * H, 105.5 * H, 0)
  };
}

const periodsFixture = (periodKey: string): PnlPeriodsResponse => ({
  data: {
    periods: [
      { periodKey: "2026-07", state: "locked", stateLabel: "Đã khóa", statusText: "Đã khóa · 05/08 · PM-1", missingCount: 0, lockedAt: "2026-08-05T03:00:00.000Z", lockedByName: "PM-1", reopenedAt: null, reopenReason: null },
      { periodKey: "2026-08", state: "awaiting_lock", stateLabel: "Chờ khóa", statusText: "Chờ khóa · sẵn sàng", missingCount: 0, lockedAt: null, lockedByName: null, reopenedAt: null, reopenReason: null },
      { periodKey: "2026-09", state: "awaiting_lock", stateLabel: "Chờ khóa", statusText: "Chờ khóa · còn 3 việc", missingCount: 3, lockedAt: null, lockedByName: null, reopenedAt: null, reopenReason: null },
      { periodKey: "2026-10", state: "open", stateLabel: "Đang mở", statusText: "Đang mở · hiện tại", missingCount: 0, lockedAt: null, lockedByName: null, reopenedAt: null, reopenReason: null },
      { periodKey: "2026-11", state: "not_open", stateLabel: "Chưa mở", statusText: "Chưa mở", missingCount: 0, lockedAt: null, lockedByName: null, reopenedAt: null, reopenReason: null }
    ],
    selected: {
      periodKey, state: "awaiting_lock",
      checklist: [
        { key: "parameters", ok: true, label: "Tham số có hiệu lực cho tháng", detail: null, count: 0, names: [], target: null, targetLabel: null },
        { key: "pending_hours", ok: false, label: "Không còn giờ Chờ xử lý của tháng (trừ Pre-sale chờ ký hợp đồng)", detail: "còn 117,5 giờ", count: 7050, names: [], target: "pending_hours", targetLabel: "Danh sách" },
        { key: "staff_costs", ok: false, label: "Mọi người có giờ log có chi phí tháng Đã duyệt", detail: "thiếu: Nhân sự B", count: 1, names: ["Nhân sự B"], target: "staff_costs", targetLabel: "Hồ sơ nhân sự" },
        { key: "funds", ok: false, label: "Mọi quỹ của tháng đã chia đủ và xác nhận", detail: "còn: Công cụ AI", count: 1, names: ["Công cụ AI"], target: "funds", targetLabel: "Quỹ chi phí chung" },
        { key: "accepted_projects", ok: true, label: "Dự án qua G7 trong tháng có ngày nghiệm thu và giá trị hợp đồng", detail: null, count: 0, names: [], target: null, targetLabel: null }
      ],
      canLock: false, lockButtonText: `Khóa kỳ ${periodKey.slice(5)}/2026 · còn 3 việc`,
      lockBlockedByPeriodKey: "2026-08", lockBlockedReason: "Kỳ khóa theo thứ tự: tháng 08/2026 có dữ liệu và chưa khóa.",
      reopenPeriodKeys: [], snapshotNote: "Khóa lưu ảnh chụp tham số, cost rate, số chia quỹ, kết quả cổng lọc",
      reopenNote: "Mở lại kỳ đã khóa: Admin, bắt buộc lý do; các tháng sau mở lại theo · giờ ghi bù vào tháng đã khóa nằm ở Chờ xử lý",
      explanation: "Kỳ chỉ khóa dữ liệu đầu vào của tháng. P&L dự án vẫn cộng trọn vòng đời; dự án có giờ ở tháng chưa khóa thì Tạm tính.", history: []
    }
  },
  meta: meta()
});

const costItem = (code: string, name: string, parentCode: string | null, level: number, method: PnlCostItem["method"], methodLabel: string, extra: Partial<PnlCostItem> = {}): PnlCostItem => ({
  code, name, parentCode, level, sign: 1, roleGroup: null, unit: "VND", method, methodLabel, systemSource: null, formula: null, formulaText: null, required: false, effectiveFromPeriod: "2026-01",
  status: "active", statusLabel: "Đang dùng", sourceNote: null, sortOrder: 10, codeLocked: false, codeLockReason: null, lockedMethods: [], dependsOn: [], usedBy: [], draft: null, ...extra
});
const itemsFixture: PnlCostItemsResponse = {
  data: {
    check: { hasCycle: false, cycleCodes: [], allGroupsSummed: true, groupErrors: [], errors: [], requiredWithoutValue: [{ code: "CP.QUY.AI", name: "Công cụ AI" }], periodKey: "2026-10", canApply: true },
    items: [
      costItem("DT", "Doanh thu ghi nhận", null, 1, "SYSTEM", "Lấy từ hệ thống", { systemSource: "revenue" }),
      costItem("CP", "Tổng chi phí", null, 1, "GROUP", "Tổng nhóm"),
      costItem("CP.NS", "Chi phí nhân sự", "CP", 2, "GROUP", "Tổng nhóm"),
      costItem("CP.NS.DELIVERY", "Delivery", "CP.NS", 3, "SYSTEM", "Lấy từ hệ thống", { roleGroup: "DELIVERY", systemSource: "labor" }),
      costItem("CP.QUY.AI", "Công cụ AI", "CP", 2, "FUND", "Phân bổ quỹ", { required: true }),
      costItem("CP.HOAHONG", "Hoa hồng", "CP", 2, "FORMULA", "Công thức", { formula: [{ item: "DT" }, { op: "*" }, { param: "commissionPercent" }], formulaText: "[Doanh thu ghi nhận] × [Tỷ lệ hoa hồng]", dependsOn: [{ code: "DT", name: "Doanh thu ghi nhận" }] })
    ],
    hasDraft: false, openPeriodKeys: ["2026-10"],
    formulaOperands: [{ token: { item: "DT" }, label: "Doanh thu ghi nhận" }, { token: { param: "commissionPercent" }, label: "Tỷ lệ hoa hồng" }],
    usingDefaultTree: false
  },
  meta: meta()
};

const parameterRow = (key: PnlParameterRow["key"], label: string, text: string | null, scopeText: string, extra: Partial<PnlParameterRow> = {}): PnlParameterRow => ({
  key, subKey: null, label, unit: "", defaultValue: text, defaultValueText: text, scopeText, allowedScopes: ["company"], specificValueCount: 0, effectiveFrom: text ? "2026-01" : null, note: "nhập tay", derived: null, values: [], history: [], ...extra
});
const parametersFixture: PnlParametersResponse = {
  data: {
    rows: [
      parameterRow("standardDayHours", "Giờ chuẩn một ngày", "8 giờ", "Công ty, theo tháng", { derived: { periodKey: "2026-10", workingDays: 22, standardDayHours: 8, standardHours: 176, text: "Giờ chuẩn tháng 10/2026: 22 ngày × 8 = 176 giờ, hệ thống tính từ lịch ngày nghỉ" } }),
      parameterRow("usdRate", "Tỷ giá USD", "26.300 đ", "Công ty, theo tháng"),
      parameterRow("pnlCloseGate", "Mốc đóng P&L", "G7 (nghiệm thu)", "Công ty"),
      parameterRow("commissionPercent", "Tỷ lệ hoa hồng", "5%", "Công ty, khách hàng", { allowedScopes: ["company", "customer"], specificValueCount: 1 }),
      parameterRow("sellRate", "Đơn giá bán · Delivery", null, "Công ty, dự án", { subKey: "DELIVERY", allowedScopes: ["company", "project"] })
    ],
    moved: [{ label: "Cost rate theo giờ", movedTo: "Hồ sơ nhân sự › Chi phí theo tháng" }],
    priorityNote: "Thứ tự ưu tiên: dự án › khách hàng › loại dự án › công ty.",
    openPeriodKeys: ["2026-10"], scopeOptions: { customers: [], projectTypes: [], projects: [], roleGroups: [{ value: "DELIVERY", label: "Delivery" }] }
  },
  meta: meta()
};

const fundsFixture: PnlFundsResponse = { data: { periodKey: "2026-09", periodState: "awaiting_lock", funds: [], warnings: [], periodOptions: ["2026-09", "2026-10"], targetItemOptions: [] }, meta: meta() };
const templatesFixture: PnlTemplatesResponse = { data: { templates: [], comparison: [], comparisonNote: "Chỉ hiện các dòng khác nhau giữa các mẫu.", overrides: [], items: [] }, meta: meta() };

const staffCostsFixture: PnlStaffCostsResponse = {
  data: {
    periodKey: "2026-09", periodState: "awaiting_lock", standardMinutes: 176 * H, workingDays: 22, standardDayHours: 8, counts: { approved: 1, draft: 0, missing: 1 },
    rows: [
      {
        userId: "usr-a", employeeCode: "NS-001", displayName: "Nhân sự A", department: "Delivery", periodKey: "2026-09",
        components: { baseSalaryAmount: 20_000_000, performanceBonusAmount: 3_000_000, resultBonusAmount: 0, allowanceAmount: 1_279_056, overtimeAmount: 0, socialInsuranceAmount: 4_300_000 },
        totalAmount: 28_579_056, hourlyCostRate: 162_381, source: "import", sourceLabel: "Import Excel", status: "APPROVED", statusLabel: "Đã duyệt", loggedMinutes: 29 * H, waitingMinutes: 0,
        approvedAt: "2026-10-03T02:00:00.000Z", approvedByName: "PM-1", updatedAt: "2026-10-02T02:00:00.000Z"
      },
      {
        userId: "usr-b", employeeCode: null, displayName: "Nhân sự B", department: null, periodKey: "2026-09", components: null, totalAmount: null, hourlyCostRate: null, source: null, sourceLabel: null,
        status: "NONE", statusLabel: "Chưa có", loggedMinutes: 105.5 * H, waitingMinutes: 105.5 * H, approvedAt: null, approvedByName: null, updatedAt: null
      }
    ],
    lastImport: null, periodOptions: ["2026-08", "2026-09", "2026-10"],
    notes: { phase: "Giai đoạn 1: nhập tay hoặc import Excel; giai đoạn 2 lấy từ hệ thống lương.", lockRules: ["Chỉ bản Đã duyệt được dùng để tính cost rate."] }
  },
  meta: meta()
};

const entriesFixture: PnlSourceEntriesResponse = {
  data: [
    {
      id: "te-1", projectId: "prj-a", projectCode: "DA-A", projectName: "Dự án A", taskId: "task-1", taskTitle: "Cấu hình Base bán hàng", userId: "usr-b", userDisplayName: "Nhân sự B", roleGroup: "DELIVERY",
      workDate: "2026-09-03", periodKey: "2026-09", minutes: 7.5 * H, taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT", contractItemId: "hm-01", contractItemName: "HM-01 Triển khai",
      status: "pending", statusLabel: "Chờ xử lý", reason: "missing_staff_cost", reasons: ["missing_staff_cost"], reasonLabels: ["Chờ cost rate tháng 09"], blocksG7: false, awaitingContract: false,
      hourlyCostRate: null, costAmount: null, deadline: "2026-09-17", overdue: false, ownerUserId: "usr-pm1", ownerDisplayName: "PM-1", target: "staff_costs", fromSnapshot: false
    },
    {
      id: "te-2", projectId: "prj-a", projectCode: "DA-A", projectName: "Dự án A", taskId: "task-1", taskTitle: "Cấu hình Base bán hàng", userId: "usr-b", userDisplayName: "Nhân sự B", roleGroup: "DELIVERY",
      workDate: "2026-09-04", periodKey: "2026-09", minutes: 98 * H, taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT", contractItemId: "hm-01", contractItemName: "HM-01 Triển khai",
      status: "pending", statusLabel: "Chờ xử lý", reason: "missing_staff_cost", reasons: ["missing_staff_cost"], reasonLabels: ["Chờ cost rate tháng 09"], blocksG7: false, awaitingContract: false,
      hourlyCostRate: null, costAmount: null, deadline: "2026-09-18", overdue: false, ownerUserId: "usr-pm1", ownerDisplayName: "PM-1", target: "staff_costs", fromSnapshot: false
    }
  ],
  meta: { ...meta(), entryCount: 2, totalMinutes: 105.5 * H, totalCostAmount: null, overdueCount: 0, pendingDeadlineWorkingDays: 10 }
};

// --- /api/pnl mock --------------------------------------------------------------

const FORBIDDEN_MESSAGE = "Tài khoản của bạn không thuộc nhóm được xem số liệu này.";

/** Mocks the whole P&L BFF. Returns the GET requests it answered (pathname below /api/pnl + query). */
async function installPnlMocks(page: Page, options: { moneyVisible?: boolean; forbidden?: (path: string) => boolean } = {}) {
  const visible = options.moneyVisible ?? true;
  const calls: Array<{ path: string; query: URLSearchParams }> = [];
  await page.route("**/api/pnl/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/pnl\//, "");
    const query = url.searchParams;
    calls.push({ path, query });
    if (options.forbidden?.(path)) return fulfillJson(route, { message: FORBIDDEN_MESSAGE }, 403);
    if (path === "dashboard") return fulfillJson(route, dashboardFixture(visible));
    if (path === "company-costs") {
      return fulfillJson(route, {
        data: [{ line: query.get("line"), periodKey: "2026-04", userId: "usr-bd1", userName: "BD-1", projectId: "prj-lost", projectName: "Deal thua X", minutes: 90 * H, amount: 18 * M }],
        meta: { ...meta(visible), companyCosts: dashboardFixture(visible).data.companyCosts }
      });
    }
    if (path === "projects/prj-a") {
      const from = query.get("fromMonth");
      const to = query.get("toMonth");
      return fulfillJson(route, projectFixture(visible, from && to ? { from, to } : null));
    }
    if (path === "projects/prj-a/months/all") return fulfillJson(route, { data: [monthDetailFixture("2026-08", visible), monthDetailFixture("2026-09", visible)], meta: meta(visible) } satisfies PnlProjectMonthDetailResponse);
    if (path.startsWith("projects/prj-a/months/")) return fulfillJson(route, { data: [monthDetailFixture(path.split("/").pop() as string, visible)], meta: meta(visible) } satisfies PnlProjectMonthDetailResponse);
    if (path === "entries") return fulfillJson(route, entriesFixture);
    if (path === "periods") return fulfillJson(route, periodsFixture(query.get("periodKey") ?? "2026-09"));
    if (path === "config/items") return fulfillJson(route, itemsFixture);
    if (path === "config/parameters") return fulfillJson(route, parametersFixture);
    if (path === "config/templates") return fulfillJson(route, templatesFixture);
    if (path === "funds") return fulfillJson(route, fundsFixture);
    if (path === "staff-costs") return fulfillJson(route, staffCostsFixture);
    return fulfillJson(route, { message: `Unmocked P&L endpoint: ${path}` }, 404);
  });
  const last = (path: string) => [...calls].reverse().find((call) => call.path === path);
  return { calls, last };
}

test.beforeEach(async ({ context, page, baseURL }) => {
  await installAuthenticatedBrowser(context, page, baseURL);
});

// --- Mục 4: Tổng quan P&L ---------------------------------------------------------

test.describe("P&L › Tổng quan (/pnl)", () => {
  test("filter row, status line, five total tiles and the amber pending strip", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl?year=2026");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/P&L\s*›\s*Tổng quan/);
    await expect(page.getByText("Đơn vị: triệu đồng", { exact: true })).toBeVisible();

    const filters = page.getByRole("region", { name: "Bộ lọc" });
    await expect(filters.getByLabel("Năm", { exact: true })).toContainText("Năm 2026");
    const units = filters.getByRole("group", { name: "Loại kỳ" }).getByRole("button");
    await expect(units).toHaveText(["Năm", "H1/H2", "Quý", "Tháng"]);
    await expect(units.first()).toHaveAttribute("aria-pressed", "true");
    await expect(filters.getByLabel("Quy tắc chọn dự án")).toContainText("Bắt đầu trong kỳ & đã nghiệm thu");
    await expect(filters.getByLabel("Loại dự án")).toContainText("Loại DA");
    await expect(filters.getByLabel("Khách hàng")).toContainText("KH");
    await expect(filters.getByLabel("PIC", { exact: true })).toContainText("PIC");
    await expect(filters).toContainText("Đang tính 3 dự án · đã loại 4 dự án thử nghiệm · số liệu cập nhật 08:30 ngày 12/10");
    expect(api.last("dashboard")?.query.get("year")).toBe("2026");

    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(tiles).toHaveCount(5);
    await expect(tiles.nth(0)).toContainText(/Dự án\s*3\s*đã nghiệm thu/);
    await expect(tiles.nth(1)).toContainText(/Doanh thu ghi nhận\s*1\.240\s*ghi nhận tại G7/);
    await expect(tiles.nth(2)).toContainText(/Tổng chi phí\s*812\s*NS 690 · khác 122/);
    await expect(tiles.nth(3)).toContainText(/EBIT\s*428\s*Tạm tính · 2 dự án/);
    await expect(tiles.nth(4)).toContainText(/Biên EBIT\s*34,5%\s*tổng EBIT ÷ tổng DT/);
    await expect(tiles.nth(1).getByTitle("1.240.000.000 đ")).toBeVisible();

    await expect(page.getByText("Tạm tính vì: 105,5 giờ chờ cost rate · 12 giờ thiếu hạng mục · quỹ tháng 09 chưa chia")).toBeVisible();
    const list = page.getByRole("link", { name: "Xem danh sách ›" });
    await expect(list).toHaveAttribute("href", "/pnl/hours?from=2026-01&to=2026-12");
    await list.click();
    await expect(page).toHaveURL(/\/pnl\/hours\?from=2026-01&to=2026-12$/);
    await expect(page.getByRole("heading", { level: 1, name: "Giờ log Chờ xử lý" })).toBeVisible();
  });

  test("choosing Quý re-queries the API, keeps the choice in the URL and offers the quarter", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl?year=2026");
    const filters = page.getByRole("region", { name: "Bộ lọc" });
    await expect(filters.getByLabel("Kỳ trong năm")).toHaveCount(0);

    await filters.getByRole("button", { name: "Quý", exact: true }).click();
    await expect(page).toHaveURL(/unit=quarter/);
    await expect(filters.getByRole("button", { name: "Quý", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(filters.getByLabel("Kỳ trong năm")).toContainText("Quý 1");
    await expect(filters).toContainText("Gợi ý: nên xem kỳ dài");
    await expect.poll(() => api.last("dashboard")?.query.get("unit")).toBe("quarter");

    await filters.getByRole("button", { name: "H1/H2", exact: true }).click();
    await expect(filters.getByLabel("Kỳ trong năm")).toContainText("H1");
    await expect.poll(() => api.last("dashboard")?.query.get("unit")).toBe("half");
  });

  test("cost-by-group switches between Nhóm hạch toán and Vai trò; a group filters the project table", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl?year=2026");
    const block = page.getByRole("region", { name: "Chi phí theo nhóm, sinh từ cây khoản mục" });
    const views = block.getByRole("group", { name: "Cách xem nhóm chi phí" });
    await expect(views.getByRole("button")).toHaveText(["Nhóm hạch toán", "Vai trò"]);
    await expect(views.getByRole("button", { name: "Nhóm hạch toán" })).toHaveAttribute("aria-pressed", "true");
    await expect(block.getByRole("button", { name: /Chi phí nhân sự/ })).toContainText("690 · 85%");

    await views.getByRole("button", { name: "Vai trò" }).click();
    await expect(page).toHaveURL(/view=role/);
    const delivery = block.getByRole("button", { name: /Delivery\/DX/ });
    await expect(delivery).toContainText("520 · 64%");
    await expect(block.getByRole("button", { name: /Hoa hồng/ })).toContainText("62 · 8%");

    await delivery.click();
    await expect(page).toHaveURL(/groupKey=DELIVERY/);
    await expect(delivery).toHaveAttribute("aria-pressed", "true");
    await expect(block).toContainText("Bảng dự án đang lọc theo nhóm “Delivery/DX”.");
    await expect.poll(() => api.last("dashboard")?.query.get("groupKey")).toBe("DELIVERY");
    await block.getByRole("button", { name: "Bỏ lọc" }).click();
    await expect(page).not.toHaveURL(/groupKey=/);
  });

  test("project table: tabs Đã nghiệm thu / Đang triển khai, columns, total row and reconciliation", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl?year=2026");
    const block = page.getByRole("region", { name: "Bảng dự án" });
    const tabs = block.getByRole("tablist", { name: "Nhóm dự án" }).getByRole("tab");
    await expect(tabs).toHaveText(["Đã nghiệm thu (3)", "Đang triển khai (7) · chỉ chi phí, không cộng vào tổng"]);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");

    const headers = block.getByRole("columnheader");
    await expect(headers).toHaveCount(9);
    await expect(headers).toContainText(["Dự án / Khách hàng", "PIC", "Bắt đầu → NT", "DT ghi nhận", "CP nhân sự", "CP khác", "EBIT", "Biên", "Kết quả"]);

    const rowA = block.getByRole("row", { name: /Dự án A · Khách A/ });
    await expect(rowA.getByRole("cell")).toHaveText(["Dự án A · Khách A", "PM-1", "03/26 → 07/26", "420", "236", "41", "143", "34,0%", "Chính thức"]);
    await expect(rowA.getByRole("link", { name: "Dự án A · Khách A" })).toHaveAttribute("href", "/pnl/prj-a");
    await expect(block.getByRole("row", { name: /Dự án B · Khách B/ })).toContainText("Tạm tính");

    const total = block.getByRole("row", { name: /Tổng 3 dự án/ });
    await expect(total.getByRole("cell")).toHaveText(["Tổng 3 dự án", "1.240", "690", "122", "428", "34,5%", "Tạm tính"]);
    await expect(block).toContainText("Đối soát: dòng tổng = năm ô tổng phía trên · giờ đã ghi 2.140 = tính P&L 1.986 + chờ 117,5 + bị loại 36,5");
    await expect(block).toContainText("Trang 1/1 · ô tổng và sắp xếp tính trên toàn danh sách");

    await tabs.nth(1).click();
    await expect(page).toHaveURL(/tab=in_progress/);
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => api.last("dashboard")?.query.get("tab")).toBe("in_progress");
    await expect(headers).toHaveCount(7);
    await expect(headers).toContainText(["Dự án / Khách hàng", "PIC", "Bắt đầu", "CP nhân sự", "CP khác", "Tổng chi phí tới nay", "Kết quả"]);
    await expect(block.getByRole("row", { name: /Dự án D · Khách D/ }).getByRole("cell")).toHaveText(["Dự án D · Khách D", "PM-2", "06/26", "30", "5", "35", "Tạm tính"]);
    await expect(block.getByRole("row", { name: /Tổng 3 dự án/ })).toHaveCount(0);
    await expect(block).toContainText("không cộng vào ô tổng");

    await block.getByRole("row", { name: /Dự án D · Khách D/ }).getByRole("cell").nth(1).click();
    await expect(page).toHaveURL(/\/pnl\/prj-d$/);
  });

  test("company-level costs: four lines outside project P&L, one opens its list by person and project", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl?year=2026");
    const block = page.getByRole("region", { name: "Chi phí ngoài P&L dự án · theo tháng phát sinh trong kỳ" });
    const lines = block.getByRole("button");
    await expect(lines).toHaveCount(4);
    await expect(lines).toHaveText([/Pre-sale \(deal thua\)\s*18/, /Sau nghiệm thu\s*24/, /Nội bộ\s*65/, /Chưa phân bổ\s*41/]);

    await lines.first().click();
    await expect(lines.first()).toHaveAttribute("aria-expanded", "true");
    const detail = block.getByRole("table");
    await expect(detail).toContainText("Chi phí Pre-sale của deal thua · theo người và dự án");
    await expect(detail.getByRole("columnheader")).toHaveText(["Tháng", "Nhân sự", "Dự án", "Giờ", "Chi phí"]);
    await expect(detail.getByRole("row", { name: /Deal thua X/ }).getByRole("cell")).toHaveText(["04/2026", "BD-1", "Deal thua X", "90", "18,00"]);
    const call = api.last("company-costs");
    expect([call?.query.get("from"), call?.query.get("to"), call?.query.get("line")]).toEqual(["2026-01", "2026-12", "pre_sale"]);
  });

  test("Admin outside the cost permission group: money reads “—” with the explanatory note", async ({ page }) => {
    await installPnlMocks(page, { moneyVisible: false });
    await page.goto("/pnl?year=2026");
    await expect(page.getByRole("note").filter({ hasText: "Bạn không thuộc nhóm quyền chi phí" })).toContainText("doanh thu, chi phí, cost rate và biên không hiển thị (ghi “—”). Giờ và trạng thái dữ liệu vẫn xem được.");
    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(tiles.nth(0)).toContainText(/Dự án\s*3/);
    await expect(tiles.nth(1)).toContainText(/Doanh thu ghi nhận\s*—/);
    await expect(tiles.nth(2)).toContainText(/Tổng chi phí\s*—\s*NS — · khác —/);
    await expect(tiles.nth(4)).toContainText(/Biên EBIT\s*—/);
    const rowA = page.getByRole("region", { name: "Bảng dự án" }).getByRole("row", { name: /Dự án A · Khách A/ });
    await expect(rowA.getByRole("cell")).toHaveText(["Dự án A · Khách A", "PM-1", "03/26 → 07/26", "—", "—", "—", "—", "—", "Chính thức"]);
    // Hours are not money: the reconciliation line stays.
    await expect(page.getByText(/giờ đã ghi 2\.140 = tính P&L 1\.986/)).toBeVisible();
  });

  test("403 from the dashboard endpoint: the no-permission state replaces every figure", async ({ page }) => {
    await installPnlMocks(page, { forbidden: (path) => path === "dashboard" });
    await page.goto("/pnl?year=2026");
    const state = page.getByRole("status").filter({ hasText: "Bạn chưa có quyền xem tab P&L" });
    await expect(state).toContainText("Tab P&L chỉ mở cho tài khoản Admin; doanh thu, chi phí, cost rate chỉ hiện với nhóm quyền chi phí.");
    await expect(state).toContainText(FORBIDDEN_MESSAGE);
    await expect(page.getByRole("region", { name: "Năm ô tổng" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Bảng dự án" })).toHaveCount(0);
    await expect(page.getByText("1.240")).toHaveCount(0);
  });
});

// --- Mục 5: P&L dự án ---------------------------------------------------------------

test.describe("P&L dự án (/pnl/[projectId])", () => {
  test("header with result badge, scope switch, five tiles (Phụ lục B) and the people table", async ({ page }) => {
    await installPnlMocks(page);
    await page.goto("/pnl/prj-a");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/P&L\s*›\s*Dự án A · Khách A/);
    await expect(page.getByText("Đơn vị tiền: triệu đồng", { exact: true })).toBeVisible();
    const header = page.getByRole("region", { name: "Thông tin và phạm vi" });
    await expect(header.getByRole("heading", { level: 2 })).toHaveText("Dự án A · Khách A");
    await expect(header).toContainText("Loại dự án Khách hàng · PM-1 · Đang triển khai · G7 chưa có · Hồ sơ P&L: Đang ghi nhận");
    const badge = header.getByLabel("Tạm tính: 105,5 giờ chờ cost rate · tháng 08, 09 chưa khóa");
    await expect(badge).toHaveText("Tạm tính");
    await expect(header.getByRole("button", { name: "Toàn dự án" })).toHaveAttribute("aria-pressed", "true");
    await expect(header.getByRole("button", { name: "Thu hẹp theo tháng: Từ 08/2026 đến 09/2026" })).toBeVisible();
    await expect(header).toContainText("Khi thu hẹp: ô Doanh thu, EBIT ghi “Chỉ xem ở Toàn dự án”");

    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(tiles).toHaveCount(5);
    await expect(tiles.nth(0)).toContainText(/Giờ kế hoạch\s*260\s*giờ\s*từ sub-task đã lập/);
    await expect(tiles.nth(1)).toContainText(/Giờ thực hiện\s*273,5\s*giờ\s*\+5% · 2 tháng có giờ/);
    await expect(tiles.nth(2)).toContainText(/Doanh thu\s*67,2\s*giá trị HĐ, chưa G7/);
    await expect(tiles.nth(3)).toContainText(/Tổng chi phí\s*30,97\s*NS 26,35 · khác 4,62/);
    await expect(tiles.nth(4)).toContainText(/EBIT dự kiến\s*36,23\s*53,9% · Tạm tính/);
    await expect(tiles.nth(2).getByTitle("67.200.000 đ")).toBeVisible();
    await expect(tiles.nth(3).getByTitle("30.970.000 đ")).toBeVisible();
    await expect(tiles.nth(4).getByTitle("36.230.000 đ")).toBeVisible();

    const people = page.getByRole("region", { name: "Nhân sự tham gia, cộng dồn cả dự án" });
    await expect(people.getByRole("columnheader")).toHaveText(["Nhân sự", "Vai trò", "Giờ KH", "Giờ đã ghi", "Giờ tính P&L", "Chi phí NS", "Trạng thái"]);
    const cells = (name: string) => people.getByRole("row", { name: new RegExp(`^${name}`) }).getByRole("cell");
    await expect(cells("Nhân sự A")).toHaveText(["Delivery", "120", "149", "149", "22,61", "Đủ"]);
    await expect(cells("Nhân sự B")).toHaveText(["Delivery", "100", "105,5", "0", "—", "Chờ cost rate T09"]);
    await expect(cells("PM-1")).toHaveText(["PM", "16", "16", "16", "3,20", "Đủ"]);
    await expect(cells("BD-1")).toHaveText(["BD", "3", "3", "3", "0,54", "Đủ"]);
    await expect(cells("Chưa giao")).toHaveText(["", "21", "", "", "", ""]);
  });

  test("month table: Toàn dự án row, month rows, whole-project item, and a month that expands", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl/prj-a");
    const block = page.getByRole("region", { name: "Giờ và chi phí theo tháng" });
    const table = block.getByRole("table").first();
    await expect(table.locator("> thead").getByRole("columnheader")).toHaveText(["Tháng", "Kỳ", "Đã ghi", "Tính P&L", "Chờ", "Bị loại", "CP NS", "CP khác", "Tổng CP", "Dữ liệu"]);
    const cells = (name: RegExp) => table.locator("> tbody > tr").filter({ has: page.getByRole("rowheader", { name }) }).getByRole("cell");
    await expect(cells(/^Toàn dự án$/)).toHaveText(["273,5", "168", "105,5", "0", "26,35", "4,62", "30,97", "Thiếu 2 việc ›"]);
    await expect(cells(/08\/2026/)).toHaveText(["Chờ khóa", "139", "139", "0", "0", "21,34", "1,26", "22,60", "Đủ"]);
    await expect(cells(/09\/2026/)).toHaveText(["Chờ khóa", "134,5", "29", "105,5", "0", "5,01", "—", "5,01", "Thiếu cost rate ›"]);
    await expect(cells(/^Khoản cả dự án$/)).toHaveText(["3,36", "3,36", "Hoa hồng dự kiến"]);
    await expect(cells(/^Sau nghiệm thu$/)).toHaveText(["Chưa qua G7 · hiện giờ và chi phí Milestone 4 theo tháng · không cộng vào Toàn dự án"]);

    await block.getByRole("button", { name: "Thiếu 2 việc ›" }).click();
    await expect(block.getByRole("link", { name: "Thiếu cost rate · tháng 09/2026 ›" })).toHaveAttribute("href", "/users/costs?periodKey=2026-09");
    await expect(block.getByRole("link", { name: "Quỹ chưa chia · tháng 09/2026 ›" })).toHaveAttribute("href", "/pnl/costs?tab=funds&periodKey=2026-09");

    const september = block.getByRole("button", { name: "09/2026", exact: true });
    await expect(september).toHaveAttribute("aria-expanded", "false");
    await september.click();
    await expect(september).toHaveAttribute("aria-expanded", "true");
    const panel = block.locator("#pnl-month-2026-09");
    await expect(panel).toContainText("Tháng 09/2026 · giờ chuẩn 176 giờ");
    expect(api.last("projects/prj-a/months/2026-09")).toBeTruthy();
    const views = panel.getByRole("group", { name: "Cách xem tháng 09/2026" });
    await expect(views.getByRole("button")).toHaveText(["Người × ngày", "Theo task"]);
    const byDay = panel.getByRole("table");
    await expect(byDay.getByRole("columnheader")).toHaveCount(2 + 30 + 4); // Nhân sự, Cost rate, 30 ngày, Đã ghi, Tính P&L, Chi phí, Trạng thái
    await expect(byDay.getByRole("row", { name: /^Nhân sự A/ })).toContainText("162.381");
    await expect(byDay.getByRole("row", { name: /^Nhân sự B/ })).toContainText("Chờ cost rate");
    await expect(byDay.getByLabel("Nghỉ cá nhân")).toHaveCount(1);
    await expect(panel).toContainText("Đối soát tháng: giờ đã ghi 134,5 = tính P&L 29 + chờ 105,5 + bị loại 0 · khớp");
    await expect(panel.getByRole("link", { name: "Giờ log nguồn ›" })).toHaveAttribute("href", "/pnl/hours?projectId=prj-a&periodKey=2026-09");

    await views.getByRole("button", { name: "Theo task" }).click();
    await expect(panel.getByRole("columnheader")).toHaveText(["Task", "Hạng mục", "Đã ghi", "Tính P&L", "Chờ", "Bị loại", "Chi phí", "Lý do"]);
    await expect(panel.getByRole("row", { name: /Cấu hình Base bán hàng/ })).toContainText("HM-01");

    await block.getByRole("button", { name: "Mở hết các tháng ›" }).click();
    await expect(block.getByRole("button", { name: "08/2026", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(block.locator("#pnl-month-2026-08")).toContainText("Tháng 08/2026 · giờ chuẩn 176 giờ");
    expect(api.last("projects/prj-a/months/all")).toBeTruthy();
    await expect(block.getByRole("button", { name: "Thu gọn các tháng ›" })).toBeVisible();
  });

  test("the two collapsible sections open for the cost permission group", async ({ page }) => {
    await installPnlMocks(page);
    await page.goto("/pnl/prj-a");
    const items = page.getByRole("button", { name: /Chi tiết theo khoản mục P&L · nhập chi phí riêng ở dòng Nhập tay/ });
    const history = page.getByRole("button", { name: /Lịch sử thay đổi số liệu · gồm khóa và mở lại kỳ/ });
    for (const section of [items, history]) {
      await expect(section).toContainText("Chỉ nhóm quyền chi phí");
      await expect(section).toHaveAttribute("aria-expanded", "false");
      await expect(section).toBeEnabled();
    }

    await items.click();
    await expect(items).toHaveAttribute("aria-expanded", "true");
    const tree = page.locator("#pnl-items-panel");
    await expect(tree.getByRole("columnheader")).toHaveText(["Khoản mục", "Cách lấy số", "Lũy kế toàn dự án"]);
    await expect(tree.getByRole("row", { name: /Doanh thu ghi nhận/ }).getByRole("cell")).toHaveText(["Lấy từ hệ thống", "67,20"]);
    await expect(tree.getByRole("row", { name: /Tổng chi phí/ }).getByRole("cell").last()).toHaveText(/30,97\s*chưa đủ/);
    await expect(tree.getByRole("row", { name: /Biên EBIT/ }).getByRole("cell").last()).toHaveText("53,9%");
    await tree.getByRole("button", { name: "Chi phí nhân sự" }).click();
    await expect(tree).toContainText("Nguồn số: Giờ tính P&L × cost rate tháng");
    await expect(tree).toContainText("08/2026: 21,34 · 09/2026: 5,01");
    await tree.getByRole("button", { name: "Chi phí riêng của dự án" }).click();
    await expect(tree).toContainText("Nhập tay · chi phí riêng theo tháng phát sinh");

    await history.click();
    await expect(page.locator("#pnl-history-panel").getByRole("listitem")).toHaveText(/05\/10\/2026 09:00\s*Mở lại kỳ\s*kỳ 08\/2026\s*PM-1\s*lý do: Bổ sung hóa đơn công cụ AI/);
  });

  test("narrowing the scope with the month-range control: URL, API query, Doanh thu and EBIT “Chỉ xem ở Toàn dự án”", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl/prj-a");
    const header = page.getByRole("region", { name: "Thông tin và phạm vi" });
    await header.getByRole("button", { name: /^Thu hẹp theo tháng:/ }).click();
    const picker = header.getByRole("dialog", { name: "Thu hẹp theo tháng" });
    await expect(picker.getByLabel("Từ tháng").getByRole("option")).toHaveText(["08/2026", "09/2026"]);
    await picker.getByLabel("Từ tháng").selectOption("2026-09");
    await picker.getByLabel("Đến tháng").selectOption("2026-08");
    await expect(picker.getByRole("alert")).toHaveText("Đến tháng phải từ 09/2026 trở đi.");
    await expect(picker.getByRole("button", { name: "Áp dụng" })).toBeDisabled();
    await picker.getByLabel("Đến tháng").selectOption("2026-09");
    await picker.getByRole("button", { name: "Áp dụng" }).click();

    await expect(page).toHaveURL(/\/pnl\/prj-a\?fromMonth=2026-09&toMonth=2026-09$/);
    await expect.poll(() => api.last("projects/prj-a")?.query.toString()).toBe("fromMonth=2026-09&toMonth=2026-09");
    await expect(header.getByRole("button", { name: "Toàn dự án" })).toHaveAttribute("aria-pressed", "false");
    await expect(header.getByRole("button", { name: "Thu hẹp theo tháng: Từ 09/2026 đến 09/2026" })).toBeVisible();
    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(tiles.nth(2)).toContainText(/Doanh thu\s*—\s*Chỉ xem ở Toàn dự án/);
    await expect(tiles.nth(4)).toContainText(/EBIT dự kiến\s*—\s*Chỉ xem ở Toàn dự án/);

    await header.getByRole("button", { name: "Toàn dự án" }).click();
    await expect(page).toHaveURL(/\/pnl\/prj-a$/);
    await expect(tiles.nth(2)).toContainText("67,2");
  });

  test("outside the cost permission group: note, no cost columns, both sections locked", async ({ page }) => {
    await installPnlMocks(page, { moneyVisible: false });
    await page.goto("/pnl/prj-a");
    await expect(page.getByRole("note").filter({ hasText: "Bạn không thuộc nhóm quyền chi phí" })).toBeVisible();
    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(tiles.nth(1)).toContainText("273,5");
    for (const index of [2, 3, 4]) await expect(tiles.nth(index)).toContainText(/—\s*Chỉ nhóm quyền chi phí/);
    await expect(page.getByRole("region", { name: "Nhân sự tham gia, cộng dồn cả dự án" }).getByRole("columnheader")).toHaveText(["Nhân sự", "Vai trò", "Giờ KH", "Giờ đã ghi", "Giờ tính P&L", "Trạng thái"]);
    await expect(page.getByRole("region", { name: "Giờ và chi phí theo tháng" }).getByRole("columnheader")).toHaveText(["Tháng", "Kỳ", "Đã ghi", "Tính P&L", "Chờ", "Bị loại", "Dữ liệu"]);
    for (const name of [/Chi tiết theo khoản mục P&L/, /Lịch sử thay đổi số liệu/]) {
      const section = page.getByRole("button", { name });
      await expect(section).toBeDisabled();
      await expect(section).toHaveAttribute("title", "Bạn không thuộc nhóm quyền chi phí nên không mở được mục này.");
    }
  });
});

// --- Mục 6.2–6.6: Admin › Thiết lập P&L ---------------------------------------------

test.describe("Admin › Thiết lập P&L (/pnl/costs)", () => {
  const TABS = [
    { id: "items", label: "Khoản mục", endpoint: "config/items" },
    { id: "parameters", label: "Tham số", endpoint: "config/parameters" },
    { id: "funds", label: "Quỹ chi phí chung", endpoint: "funds" },
    { id: "periods", label: "Kỳ và khóa kỳ", endpoint: "periods" },
    { id: "templates", label: "Mẫu khoản mục", endpoint: "config/templates" }
  ];

  test("five tabs, each reachable through ?tab= and by click; unknown tabs and the old address are rewritten", async ({ page }) => {
    const api = await installPnlMocks(page);
    for (const tab of TABS) {
      await page.goto(`/pnl/costs?tab=${tab.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Admin › Thiết lập P&L");
      const tabs = page.getByRole("tablist", { name: "Thiết lập P&L" }).getByRole("tab");
      await expect(tabs).toHaveText(TABS.map((entry) => entry.label));
      await expect(page.getByRole("tab", { selected: true })).toHaveText(tab.label);
      await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", `pnl-setup-tab-${tab.id}`);
      await expect.poll(() => Boolean(api.last(tab.endpoint))).toBe(true);
    }
    await expect(page.getByText("Chưa có mẫu khoản mục nào.")).toBeVisible();

    await page.getByRole("tab", { name: "Quỹ chi phí chung" }).click();
    await expect(page).toHaveURL(/\/pnl\/costs\?tab=funds$/);
    await expect(page.getByRole("region", { name: "Danh sách quỹ" })).toContainText("Chưa khai báo quỹ nào.");

    await page.goto("/pnl/costs?tab=cost-categories");
    await expect(page).toHaveURL(/\/pnl\/costs\?tab=items$/);
    await expect(page.getByRole("tab", { selected: true })).toHaveText("Khoản mục");

    await page.goto("/pnl/config");
    await expect(page).toHaveURL(/\/pnl\/costs\?tab=periods$/);
    await expect(page.getByRole("tab", { selected: true })).toHaveText("Kỳ và khóa kỳ");
  });

  test("Kỳ và khóa kỳ: month cards, the five-condition checklist and a disabled lock button that says why", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl/costs?tab=periods&periodKey=2026-09");
    await expect.poll(() => api.last("periods")?.query.get("periodKey")).toBe("2026-09");

    const cards = page.getByRole("list", { name: "Danh sách các tháng" }).getByRole("button");
    await expect(cards).toHaveText([/T07\/2026\s*Đã khóa · 05\/08 · PM-1/, /T08\/2026\s*Chờ khóa · sẵn sàng/, /T09\/2026\s*Chờ khóa · còn 3 việc/, /T10\/2026\s*Đang mở · hiện tại/, /T11\/2026\s*Chưa mở/]);
    await expect(cards.nth(2)).toHaveAttribute("aria-pressed", "true");

    const checklist = page.getByRole("region", { name: "Checklist khóa kỳ 09/2026" });
    const conditions = checklist.getByRole("listitem");
    await expect(conditions).toHaveCount(5);
    await expect(conditions).toContainText([
      "Tham số có hiệu lực cho tháng",
      "Không còn giờ Chờ xử lý của tháng (trừ Pre-sale chờ ký hợp đồng) · còn 117,5 giờ",
      "Mọi người có giờ log có chi phí tháng Đã duyệt · thiếu: Nhân sự B",
      "Mọi quỹ của tháng đã chia đủ và xác nhận · còn: Công cụ AI",
      "Dự án qua G7 trong tháng có ngày nghiệm thu và giá trị hợp đồng"
    ]);
    await expect(checklist.getByText("Đạt", { exact: true })).toHaveCount(2);
    await expect(checklist.getByText("Chưa đạt", { exact: true })).toHaveCount(3);
    await expect(checklist.getByRole("link", { name: "Danh sách ›" })).toHaveAttribute("href", "/pnl/hours?periodKey=2026-09");
    await expect(checklist.getByRole("link", { name: "Hồ sơ nhân sự ›" })).toHaveAttribute("href", "/users/costs?periodKey=2026-09");
    await expect(checklist.getByRole("link", { name: "Quỹ chi phí chung ›" })).toHaveAttribute("href", "/pnl/costs?tab=funds&periodKey=2026-09");

    const lockBlock = page.getByRole("region", { name: "Khóa kỳ", exact: true });
    const lock = lockBlock.getByRole("button", { name: "Khóa kỳ 09/2026 · còn 3 việc" });
    await expect(lock).toBeDisabled();
    await expect(lock).toHaveAccessibleDescription(/Kỳ khóa theo thứ tự: tháng 08\/2026 có dữ liệu và chưa khóa\./);
    await expect(lockBlock).toContainText("Khóa lưu ảnh chụp tham số, cost rate, số chia quỹ, kết quả cổng lọc");
    await expect(lockBlock).toContainText("Mở lại kỳ đã khóa: Admin, bắt buộc lý do");
    await expect(page.getByText("Kỳ chỉ khóa dữ liệu đầu vào của tháng.")).toBeVisible();

    await lockBlock.getByRole("button", { name: "Mở kỳ 08/2026 ›" }).click();
    await expect(page).toHaveURL(/tab=periods&periodKey=2026-08$/);
    await expect(page.getByRole("region", { name: "Checklist khóa kỳ 08/2026" })).toBeVisible();
  });

  test("Khoản mục: configuration check, the cost-item tree folds, an item opens its declaration panel", async ({ page }) => {
    await installPnlMocks(page);
    await page.goto("/pnl/costs?tab=items");
    await expect(page.getByText("✓ Không có tham chiếu vòng · ✓ Mọi dòng tổng do hệ thống cộng · 1 khoản mục bắt buộc chưa có số ở kỳ 10/2026")).toBeVisible();

    const tree = page.getByRole("region", { name: "Cây khoản mục" });
    await expect(tree.getByRole("columnheader")).toHaveText(["Khoản mục", "Cách lấy số"]);
    const rows = tree.locator("tbody tr");
    await expect(rows).toHaveText([/Doanh thu ghi nhận\s*Lấy từ hệ thống/, /Tổng chi phí\s*Tổng nhóm/, /Chi phí nhân sự\s*Tổng nhóm/, /Delivery\s*Lấy từ hệ thống/, /Công cụ AI\s*Phân bổ quỹ/, /Hoa hồng\s*Công thức/]);

    await tree.getByRole("button", { name: "Gập nhóm Chi phí nhân sự" }).click();
    await expect(rows).toHaveCount(5);
    await expect(tree.getByRole("button", { name: "Delivery", exact: true })).toHaveCount(0);
    await tree.getByRole("button", { name: "Gập nhóm Tổng chi phí" }).click();
    await expect(rows).toHaveCount(2);
    await tree.getByRole("button", { name: "Mở nhóm Tổng chi phí" }).click();
    await expect(rows).toHaveCount(5);

    await expect(page.getByRole("region", { name: "Panel khai báo" })).toContainText("Chọn một khoản mục trên cây");
    await tree.getByRole("button", { name: "Hoa hồng", exact: true }).click();
    const panel = page.getByRole("region", { name: "Khai báo khoản mục Hoa hồng" });
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Khoản mục: Hoa hồng");
    await expect(panel).toContainText("[Doanh thu ghi nhận] × [Tỷ lệ hoa hồng]");
  });

  test("Tham số: the parameters table, its derived standard-hours line and the moved parameters", async ({ page }) => {
    await installPnlMocks(page);
    await page.goto("/pnl/costs?tab=parameters");
    const table = page.getByRole("region", { name: "Bảng tham số" });
    await expect(table.getByRole("columnheader")).toHaveText(["Tham số", "Giá trị mặc định", "Phạm vi", "Giá trị riêng", "Hiệu lực từ", "Ghi chú"]);
    const cells = (label: string) => table.getByRole("row").filter({ has: page.getByRole("button", { name: `Xem giá trị theo phạm vi của ${label}` }) }).getByRole("cell");
    await expect(cells("Giờ chuẩn một ngày")).toHaveText(["Giờ chuẩn một ngày", "8 giờ", "Công ty, theo tháng", "0", "01/2026", "Xem ›"]);
    await expect(cells("Tỷ giá USD")).toHaveText(["Tỷ giá USD", "26.300 đ", "Công ty, theo tháng", "0", "01/2026", "nhập tay"]);
    await expect(cells("Tỷ lệ hoa hồng")).toHaveText(["Tỷ lệ hoa hồng", "5%", "Công ty, khách hàng", "1", "01/2026", "nhập tay"]);
    await expect(cells("Đơn giá bán · Delivery")).toHaveText(["Đơn giá bán · Delivery", "Chưa nhập", "Công ty, dự án", "", "", "nhập tay"]);
    await expect(table).toContainText("Giờ chuẩn tháng 10/2026: 22 ngày × 8 = 176 giờ, hệ thống tính từ lịch ngày nghỉ");
    await expect(page.getByText("Thứ tự ưu tiên: dự án › khách hàng › loại dự án › công ty.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Tham số đã chuyển đi" })).toContainText("Cost rate theo giờ → Hồ sơ nhân sự › Chi phí theo tháng");
    // Tỷ lệ hoa hồng is the row opened by default (khối 3).
    await expect(page.getByRole("heading", { level: 2, name: "Tỷ lệ hoa hồng · giá trị theo phạm vi" })).toBeVisible();
    await table.getByRole("button", { name: "Xem giá trị theo phạm vi của Tỷ giá USD" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Tỷ giá USD · giá trị theo phạm vi" })).toBeVisible();
  });
});

// --- Mục 6.7 và danh sách giờ log nguồn ---------------------------------------------

test("/users/costs renders the monthly staff-cost table; a 403 shows the cost-permission notice instead", async ({ page }) => {
  let forbidden = false;
  const api = await installPnlMocks(page, { forbidden: (path) => forbidden && path === "staff-costs" });
  await page.goto("/users/costs?periodKey=2026-09");
  await expect.poll(() => api.last("staff-costs")?.query.get("periodKey")).toBe("2026-09");
  await expect(page.getByRole("region", { name: "Thanh kỳ và tiến độ" })).toContainText("Giờ chuẩn tháng 176 giờ (22 ngày × 8) · Đã duyệt 1 · Nháp 0 · Chưa có 1");
  for (const name of ["Tải file mẫu", "Import Excel", "Duyệt bản nháp"]) await expect(page.getByRole("button", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Duyệt bản nháp" })).toBeDisabled(); // no Nháp row in the month

  const table = page.getByRole("region", { name: "Bảng chi phí" });
  const headers = table.getByRole("columnheader");
  await expect(headers).toHaveCount(13);
  await expect(headers.first()).toHaveText("Mã NS");
  await expect(headers.nth(1)).toHaveText("Nhân sự");
  await expect(headers.nth(6)).toHaveAttribute("title", /.+/); // six component columns, each titled with its full name
  await expect(headers).toContainText(["Tổng", "Cost rate", "Nguồn", "Trạng thái", "Thao tác"]);
  const rowA = table.getByRole("row", { name: /Nhân sự A/ });
  await expect(rowA.getByRole("cell")).toContainText(["NS-001", "Nhân sự A", "20,00", "3,00", "0", "1,28", "0", "4,30", "28,58", "162.381", "Import Excel", "Đã duyệt"]);
  const rowB = table.getByRole("row", { name: /Nhân sự B/ });
  await expect(rowB).toContainText("Chưa gán mã");
  await expect(rowB).toContainText("105,5 giờ log trong tháng đang chờ chi phí tháng này");
  await expect(rowB).toContainText("Chưa có");
  await expect(table.getByRole("button", { name: "Nhập chi phí tháng của Nhân sự B" })).toBeVisible();

  forbidden = true;
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Chỉ nhóm quyền chi phí xem và sửa chi phí nhân sự theo tháng." })).toContainText(FORBIDDEN_MESSAGE);
  await expect(page.getByRole("region", { name: "Bảng chi phí" })).toHaveCount(0);
});

test("/pnl/hours reads ?projectId= (and month, group) into the entries query and scopes the worklist", async ({ page }) => {
  const api = await installPnlMocks(page);
  await page.goto("/pnl/hours?projectId=prj-a&periodKey=2026-09&group=cost_rate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Giờ log Chờ xử lý");
  await expect.poll(() => api.last("entries")?.query.toString()).toBe("status=pending&projectId=prj-a&periodKey=2026-09&group=cost_rate");
  await expect(page.getByText("Phạm vi: dự án Dự án A · tháng 09/2026.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Quay lại P&L dự án" })).toHaveAttribute("href", "/pnl/prj-a");
  await expect(page.getByRole("status").filter({ hasText: "giờ log" })).toHaveText("2 giờ log · 105,5 giờ · hạn xử lý 10 ngày làm việc · chưa có giờ log nào quá hạn");

  const list = page.getByRole("region", { name: "Danh sách giờ log, theo dự án và người" });
  await expect(list.getByRole("columnheader")).toHaveText(["Dự án", "Nhân sự", "Ngày", "Task · Hạng mục", "Giờ", "Kết quả cổng lọc", "Cost rate", "Hạn xử lý", "Người xử lý", "Nơi sửa"]);
  const rows = list.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByRole("cell")).toHaveText(["Dự án A", "Nhân sự B", "03/09/2026", /Cấu hình Base bán hàng\s*HM-01 Triển khai/, "7,5", /Chờ xử lý\s*Chờ cost rate tháng 09/, "—", "17/09/2026", "PM-1", "Chi phí tháng của nhân sự ›"]);
  await expect(rows.first().getByRole("link", { name: "Chi phí tháng của nhân sự ›" })).toHaveAttribute("href", "/users/costs?periodKey=2026-09");

  // Without a project the list covers every project and leads back to the overview.
  await page.goto("/pnl/hours?status=excluded");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Giờ log Bị loại");
  await expect.poll(() => api.last("entries")?.query.toString()).toBe("status=excluded");
  await expect(page.getByRole("link", { name: "Quay lại Tổng quan P&L" })).toHaveAttribute("href", "/pnl");
  await expect(list.getByRole("columnheader")).toHaveCount(8); // no deadline / owner columns outside "Chờ xử lý"
});
