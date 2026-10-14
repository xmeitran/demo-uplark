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
 * The fixtures keep the API's own short labels ("chờ cost rate"); the screens show the plain wording of pnl-plain.ts.
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
  const revenue = figures?.[0] ?? null;
  const labor = figures?.[1] ?? 30 * M;
  const other = figures?.[2] ?? 5 * M;
  const accepted = acceptedOn !== null;
  return {
    projectId: id, projectCode: `DA-${letter}`, projectName: `Dự án ${letter}`, accountId: `acc-${letter}`, accountName: `Khách ${letter}`, projectType: "delivery",
    picUserId: `usr-${pic}`, picName: pic, startedOn, acceptedOn, acceptedOnEstimated: false,
    revenueAmount: revenue === null ? null : money(visible, revenue), laborCostAmount: money(visible, labor), otherCostAmount: money(visible, other),
    totalCostAmount: money(visible, labor + other), ebitAmount: accepted && revenue !== null ? money(visible, revenue - labor - other) : null,
    marginPercent: accepted && revenue !== null ? money(visible, ((revenue - labor - other) / revenue) * 100) : null,
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
        { kind: "classification", label: "12 giờ thiếu phân loại", minutes: 720, target: "pending_hours" },
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
      all: {
        total: 4, page: 1, pageSize: 20,
        rows: [
          dashboardRow("prj-a", "PM-1", "2026-03-02", "2026-07-20", [420 * M, 236 * M, 41 * M], official, visible),
          dashboardRow("prj-b", "PM-2", "2026-02-10", "2026-08-14", [560 * M, 318 * M, 52 * M], provisional, visible),
          dashboardRow("prj-c", "PM-1", "2026-05-05", "2026-09-25", [260 * M, 136 * M, 29 * M], provisional, visible),
          dashboardRow("prj-d", "PM-2", "2026-06-01", null, [100 * M, 30 * M, 5 * M], provisional, visible)
        ]
      },
      inProgress: { total: 7, page: 1, pageSize: 20, rows: [dashboardRow("prj-d", "PM-2", "2026-06-01", null, [100 * M, 30 * M, 5 * M], provisional, visible)] },
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
        revenue: { amount: whole ? money(visible, 67_200_000) : null, basis: "project_value", label: "Doanh thu dự án", note: whole ? "nhập tay theo từng dự án" : "Chỉ xem ở Toàn dự án", wholeProjectOnly: !whole, missingReason: null, projectValueAmount: money(visible, 67_200_000), canEdit: visible, reasonRequired: true, lockedReason: null },
        cost: { totalAmount: money(visible, 30_970_000), laborAmount: money(visible, 26_350_000), otherAmount: money(visible, 4_620_000) },
        ebit: { amount: whole ? money(visible, 36_230_000) : null, marginPercent: whole ? money(visible, 53.9137) : null, expected: true, label: "EBIT dự kiến", wholeProjectOnly: !whole, missingReason: null },
        consumable: false
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
        { code: "DT", name: "Doanh thu dự án", parentCode: null, level: 1, sign: 1, unit: "VND", method: "MANUAL", methodLabel: "Nhập tay", roleGroup: null, amount: 67_200_000, incomplete: false, source: { kind: "revenue", description: "Doanh thu do Admin/PM nhập trực tiếp theo từng dự án; không lấy tự động từ hệ thống", byMonth: [] } },
        { code: "CP", name: "Tổng chi phí", parentCode: null, level: 1, sign: -1, unit: "VND", method: "GROUP", methodLabel: "Tổng nhóm", roleGroup: null, amount: 30_970_000, incomplete: true, source: { kind: "group", description: "Cộng các khoản mục con", byMonth: [] } },
        { code: "CP.NS", name: "Chi phí nhân sự", parentCode: "CP", level: 2, sign: 1, unit: "VND", method: "SYSTEM", methodLabel: "Lấy từ hệ thống", roleGroup: "DELIVERY", amount: 26_350_000, incomplete: false, source: { kind: "hours", description: "Giờ tính P&L × cost rate tháng", byMonth: [{ periodKey: "2026-08", amount: 21_340_000 }, { periodKey: "2026-09", amount: 5_010_000 }] } },
        { code: "CP.RIENG", name: "Chi phí riêng của dự án", parentCode: "CP", level: 2, sign: 1, unit: "VND", method: "MANUAL", methodLabel: "Nhập tay", roleGroup: null, amount: null, incomplete: false, source: { kind: "manual", description: "Nhập theo tháng phát sinh", byMonth: [] }, manualLines: [] },
        { code: "EBIT.PCT", name: "Biên EBIT", parentCode: null, level: 1, sign: 1, unit: "PERCENT", method: "FORMULA", methodLabel: "Công thức", roleGroup: null, amount: 53.9137, incomplete: false, source: { kind: "formula", description: "[EBIT] ÷ [Doanh thu dự án]", byMonth: [] } }
      ] : null,
      history: visible ? [{ id: "evt-1", at: "2026-10-05T02:00:00.000Z", actorName: "PM-1", action: "pnl.period_reopened", label: "Mở lại kỳ", periodKey: "2026-08", reason: "Bổ sung hóa đơn công cụ AI" }] : null,
      template: { key: "customer", name: "Khách hàng", disabledCodes: [], override: null, canOverride: true }
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
      { userId: "usr-b", displayName: "Nhân sự B", roleGroup: "DELIVERY", roleGroupLabel: "Delivery", hourlyCostRate: null, loggedMinutes: 105.5 * H, includedMinutes: 0, pendingMinutes: 105.5 * H, excludedMinutes: 0, laborCostAmount: null, status: { ok: false, label: "Chờ cost rate", missing: [{ kind: "cost_rate", label: "Thiếu cost rate", periodKey, target: "staff_costs" }] }, leaveDays: [], byDay: [day("03", 7.5, 0)] }
    ],
    tasks: [{
      taskId: "task-1", taskTitle: "Cấu hình Base bán hàng", layer1: "DELIVERY", loggedMinutes: 134.5 * H, includedMinutes: 29 * H, pendingMinutes: 105.5 * H, excludedMinutes: 0,
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
        { key: "pending_hours", ok: false, label: "Không còn giờ Chờ xử lý của tháng", detail: "còn 117,5 giờ", count: 7050, names: [], target: "pending_hours", targetLabel: "Danh sách" },
        { key: "staff_costs", ok: false, label: "Mọi người có giờ log có chi phí tháng Đã duyệt", detail: "thiếu: Nhân sự B", count: 1, names: ["Nhân sự B"], target: "staff_costs", targetLabel: "Hồ sơ nhân sự" },
        { key: "funds", ok: false, label: "Mọi quỹ của tháng đã chia đủ và xác nhận", detail: "còn: Công cụ AI", count: 1, names: ["Công cụ AI"], target: "funds", targetLabel: "Quỹ chi phí chung" },
        { key: "accepted_projects", ok: true, label: "Dự án qua G7 trong tháng có ngày nghiệm thu và Giá trị dự án", detail: null, count: 0, names: [], target: null, targetLabel: null }
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
      costItem("DT", "Doanh thu dự án", null, 1, "MANUAL", "Nhập tay"),
      costItem("CP", "Tổng chi phí", null, 1, "GROUP", "Tổng nhóm"),
      costItem("CP.NS", "Chi phí nhân sự", "CP", 2, "GROUP", "Tổng nhóm"),
      costItem("CP.NS.DELIVERY", "Delivery", "CP.NS", 3, "SYSTEM", "Lấy từ hệ thống", { roleGroup: "DELIVERY", systemSource: "labor" }),
      costItem("CP.QUY.AI", "Công cụ AI", "CP", 2, "FUND", "Phân bổ quỹ", { required: true }),
      costItem("CP.HOAHONG", "Hoa hồng", "CP", 2, "FORMULA", "Công thức", { formula: [{ item: "DT" }, { op: "*" }, { param: "commissionPercent" }], formulaText: "[Doanh thu dự án] × [Tỷ lệ hoa hồng]", dependsOn: [{ code: "DT", name: "Doanh thu dự án" }] })
    ],
    hasDraft: false, openPeriodKeys: ["2026-10"],
    formulaOperands: [{ token: { item: "DT" }, label: "Doanh thu dự án" }, { token: { param: "commissionPercent" }, label: "Tỷ lệ hoa hồng" }],
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
      parameterRow("commissionPercent", "Tỷ lệ hoa hồng", "5%", "Công ty, khách hàng", { allowedScopes: ["company", "customer"], specificValueCount: 1 })
    ],
    moved: [{ label: "Cost rate theo giờ", movedTo: "Hồ sơ nhân sự › Chi phí theo tháng" }],
    priorityNote: "Thứ tự ưu tiên: dự án › khách hàng › loại dự án › công ty.",
    openPeriodKeys: ["2026-10"], scopeOptions: { customers: [], projectTypes: [], projects: [] }
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
      workDate: "2026-09-03", periodKey: "2026-09", minutes: 7.5 * H, taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT",
      status: "pending", statusLabel: "Chờ xử lý", reason: "missing_staff_cost", reasons: ["missing_staff_cost"], reasonLabels: ["Chờ cost rate tháng 09"], blocksG7: false,
      hourlyCostRate: null, costAmount: null, deadline: "2026-09-17", overdue: false, ownerUserId: "usr-pm1", ownerDisplayName: "PM-1", target: "staff_costs", fromSnapshot: false
    },
    {
      id: "te-2", projectId: "prj-a", projectCode: "DA-A", projectName: "Dự án A", taskId: "task-1", taskTitle: "Cấu hình Base bán hàng", userId: "usr-b", userDisplayName: "Nhân sự B", roleGroup: "DELIVERY",
      workDate: "2026-09-04", periodKey: "2026-09", minutes: 98 * H, taskTypeLayer1: "DELIVERY", taskTypeLayer2: "CUSTOMER_PROJECT", selectedTaskTypeLayer2: "CUSTOMER_PROJECT",
      status: "pending", statusLabel: "Chờ xử lý", reason: "missing_staff_cost", reasons: ["missing_staff_cost"], reasonLabels: ["Chờ cost rate tháng 09"], blocksG7: false,
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

test.describe("P&L dự án — tổng quan (/pnl)", () => {
  test("header, labelled filters, status line, five explained tiles and the “Vì sao số liệu còn tạm tính?” panel", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl?year=2026");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("P&L dự án");
    await expect(page.getByText("Theo dõi doanh thu, chi phí và EBIT của toàn bộ dự án trong workspace.")).toBeVisible();
    await expect(page.getByText("Đơn vị: triệu đồng", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Quay lại/ })).toHaveCount(0); // a top-level page has no back link
    await expect(page.getByRole("link", { name: "Chi phí nhân sự", exact: true })).toHaveAttribute("href", "/users/costs");
    await expect(page.getByRole("link", { name: "Thiết lập P&L", exact: true })).toHaveAttribute("href", "/pnl/costs");

    const filters = page.getByRole("region", { name: "Bộ lọc" });
    for (const label of ["Tìm kiếm", "Kỳ", "PIC", "Dự án được tính", "Loại dự án", "Khách hàng"]) await expect(filters.getByText(label, { exact: true }).first()).toBeVisible();
    // One period control, the shared date-range filter; the old year / unit / index selects are gone.
    await expect(filters.getByRole("button", { name: /^Kỳ: / })).toBeVisible();
    await expect(filters.getByLabel("Năm", { exact: true })).toHaveCount(0);
    await expect(filters.getByRole("group", { name: "Loại kỳ" })).toHaveCount(0);
    await expect(filters.getByLabel("Dự án được tính")).toContainText("Bắt đầu trong kỳ và đã nghiệm thu");
    await expect(filters.getByLabel("Loại dự án")).toContainText("Tất cả loại dự án");
    await expect(filters.getByLabel("Khách hàng", { exact: true })).toContainText("Tất cả khách hàng");
    await expect(filters.getByLabel("PIC", { exact: true })).toContainText("Tất cả PIC");
    await expect(filters).toContainText("Đang hiển thị 4 dự án. Tổng P&L tính cho 3 dự án bắt đầu trong kỳ và đến nay đã nghiệm thu (từ 01/2026 đến 12/2026) · không tính 4 dự án thử nghiệm · số liệu cập nhật lúc 08:30 ngày 12/10");
    await expect(filters).toContainText("P&L tính theo tháng nên khoảng ngày được làm tròn thành các tháng trọn vẹn.");
    // An address written before the date control (year=2026) is read as the months of that year.
    expect(["unit", "fromMonth", "toMonth", "tab", "year"].map((key) => api.last("dashboard")?.query.get(key))).toEqual(["custom", "2026-01", "2026-12", "all", null]);

    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(tiles).toHaveCount(5);
    // Tile: label, figure and ONE caption line; what the figure is sits in the label's tooltip.
    await expect(tiles.nth(0)).toHaveText(/^Dự án\s*3\s*đều đã cộng vào tổng$/);
    await expect(tiles.nth(1)).toHaveText(/^Doanh thu dự án\s*1\.240\s*triệu đồng$/);
    await expect(tiles.nth(2)).toHaveText(/^Tổng chi phí\s*812\s*Nhân sự 690 · khác 122$/);
    await expect(tiles.nth(3)).toHaveText(/^EBIT\s*428\s*Tạm tính · 2 dự án$/);
    await expect(tiles.nth(4)).toContainText(/^Biên EBIT\s*34,5%/);
    await expect(tiles.nth(1).getByTitle("Tổng doanh thu nhập tay theo từng dự án")).toHaveText("Doanh thu dự án");
    await expect(tiles.nth(3).getByTitle("Lãi lỗ = doanh thu dự án − tổng chi phí")).toHaveText("EBIT");
    await expect(tiles.nth(1).getByTitle("1.240.000.000 đ")).toBeVisible();

    // Each reason is one plain sentence with its count and one link to the place that fixes it.
    const why = page.getByRole("region", { name: "Vì sao số liệu còn tạm tính?" });
    await expect(why.getByRole("listitem")).toHaveText([
      /^105,5 giờ của 1 người chưa tính được chi phí vì chưa có chi phí nhân sự tháng được duyệt\.\s*Nhập \/ duyệt chi phí nhân sự ›$/,
      /^12 giờ chưa phân loại công việc\.\s*Phân loại giờ ›$/,
      /^Quỹ chi phí chung tháng 09\/2026 chưa chia cho dự án\.\s*Chia quỹ ›$/
    ]);
    await expect(why.getByRole("link", { name: "Nhập / duyệt chi phí nhân sự ›" })).toHaveAttribute("href", "/users/costs");
    await expect(why.getByRole("link", { name: "Phân loại giờ ›" })).toHaveAttribute("href", "/pnl/hours?from=2026-01&to=2026-12&group=classification");
    await expect(why.getByRole("link", { name: "Chia quỹ ›" })).toHaveAttribute("href", "/pnl/costs?tab=funds&periodKey=2026-09");
    await expect(page.getByText(/cost rate/i)).toHaveCount(0);

    const hours = page.getByRole("link", { name: "Giờ chờ xử lý", exact: true });
    await expect(hours).toHaveAttribute("href", "/pnl/hours?from=2026-01&to=2026-12");
    await hours.click();
    await expect(page).toHaveURL(/\/pnl\/hours\?from=2026-01&to=2026-12$/);
    await expect(page.getByRole("heading", { level: 1, name: "Giờ chờ xử lý" })).toBeVisible();
  });

  test("period: one date-range control — presets, picked days rounded to whole months, old year/unit/index addresses still open", async ({ page }) => {
    const api = await installPnlMocks(page);
    // The old address of "Quý 3 / 2026".
    await page.goto("/pnl?year=2026&unit=quarter&index=3");
    const filters = page.getByRole("region", { name: "Bộ lọc" });
    await expect.poll(() => api.last("dashboard")?.query.toString()).toBe("unit=custom&fromMonth=2026-07&toMonth=2026-09&tab=all");
    await expect(filters).toContainText("Gợi ý: nên xem kỳ dài");
    await expect(filters.getByRole("button", { name: "Đặt lại (1)" })).toBeVisible();

    await filters.getByRole("button", { name: /^Kỳ: / }).click();
    const picker = page.getByRole("dialog", { name: "Kỳ" });
    for (const name of ["Tháng này", "Tháng trước", "Quý này", "Quý trước", "6 tháng đầu năm", "6 tháng cuối năm", "Năm nay", "Năm trước"]) await expect(picker.getByRole("button", { name, exact: true }).first()).toBeVisible(); // "Tháng trước" is also the calendar's back arrow
    await expect(picker.getByRole("button", { name: "Tất cả thời gian" })).toHaveCount(0);

    // Specific days are picked on the calendar and rounded to their months when applied.
    await expect(picker).toContainText("Tháng 07/2026");
    await picker.getByRole("button", { name: "17/07/2026", exact: true }).click();
    await picker.getByRole("button", { name: "Tháng sau" }).click();
    await picker.getByRole("button", { name: "05/08/2026", exact: true }).click();
    await expect(picker).toContainText("Từ 17/07/2026 đến hết ngày 05/08/2026");
    await picker.getByRole("button", { name: "Áp dụng" }).click();
    await expect(page).toHaveURL(/\/pnl\?fromMonth=2026-07&toMonth=2026-08$/);
    await expect.poll(() => api.last("dashboard")?.query.toString()).toBe("unit=custom&fromMonth=2026-07&toMonth=2026-08&tab=all");
    await expect(filters.getByRole("button", { name: "Kỳ: 01/07/2026 – 31/08/2026" })).toBeVisible(); // what is shown is what is computed
    await expect(filters.getByRole("button", { name: "Xóa lọc thời gian" })).toHaveCount(0); // a period is always set

    // "Năm nay" is the default view: nothing in the URL, nothing to reset.
    await filters.getByRole("button", { name: /^Kỳ: / }).click();
    await picker.getByRole("button", { name: "Năm nay", exact: true }).click();
    await expect(page).toHaveURL(/\/pnl$/);
    await expect(filters.getByRole("button", { name: "Kỳ: Năm nay" })).toBeVisible();
    await expect(filters.getByRole("button", { name: /^Đặt lại/ })).toHaveCount(0);
    await expect.poll(() => api.last("dashboard")?.query.get("fromMonth")).toMatch(/^\d{4}-01$/);

    await filters.getByRole("button", { name: "Kỳ: Năm nay" }).click();
    await picker.getByRole("button", { name: "Năm trước", exact: true }).click();
    await expect(page).toHaveURL(/fromMonth=\d{4}-01&toMonth=\d{4}-12$/);
    await filters.getByRole("button", { name: "Đặt lại (1)" }).click();
    await expect(page).toHaveURL(/\/pnl$/);
  });

  test("filters: several clients and PICs go to the API comma-joined, the search as q, and “Đặt lại” clears them", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl");
    const filters = page.getByRole("region", { name: "Bộ lọc" });

    await filters.getByLabel("Khách hàng", { exact: true }).click();
    await page.getByRole("option", { name: /Khách A/ }).click();
    await expect(page).toHaveURL(/accountId=acc-A/);
    await expect.poll(() => api.last("dashboard")?.query.get("accountId")).toBe("acc-A");
    await page.keyboard.press("Escape");

    await filters.getByLabel("PIC", { exact: true }).click();
    await page.getByRole("option", { name: /PM-1/ }).click();
    await expect.poll(() => api.last("dashboard")?.query.get("picUserId")).toBe("usr-PM-1");
    await page.keyboard.press("Escape");

    await filters.getByLabel("Tìm dự án hoặc khách hàng").fill("khach a");
    await expect(page).toHaveURL(/q=khach\+a/);
    await expect.poll(() => api.last("dashboard")?.query.get("q")).toBe("khach a");

    await filters.getByRole("button", { name: "Đặt lại (3)" }).click();
    await expect(page).not.toHaveURL(/accountId=|picUserId=|q=/);
    await expect(filters.getByLabel("Tìm dự án hoặc khách hàng")).toHaveValue("");
    await expect(filters.getByLabel("Khách hàng", { exact: true })).toContainText("Tất cả khách hàng");
    await expect.poll(() => ["accountId", "picUserId", "q"].map((key) => api.last("dashboard")?.query.get(key))).toEqual([null, null, null]);
  });

  test("cost-by-group switches between Nhóm hạch toán and Vai trò; a group filters the project table", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl?year=2026");
    const block = page.getByRole("region", { name: "Chi phí theo nhóm" });
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

  test("project table: tabs, full column names with tooltips, help toggle, total row, hours check and the link to the project P&L", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl?year=2026");
    const block = page.getByRole("region", { name: "Bảng dự án" });
    const tabs = block.getByRole("tablist", { name: "Nhóm dự án" }).getByRole("tab");
    await expect(tabs).toHaveText(["Tất cả dự án (4)", "Đã nghiệm thu (3)", "Đang triển khai (7) · chưa cộng vào tổng"]);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");

    const headers = block.getByRole("columnheader");
    // The default view lists every project and makes its P&L lifecycle explicit.
    await expect(headers).toHaveCount(7);
    await expect(headers).toContainText(["Dự án", "Trạng thái P&L", "Bắt đầu → Nghiệm thu", "Doanh thu dự án", "Tổng chi phí", "EBIT", "Kết quả"]);
    await expect(headers.nth(3)).toHaveAttribute("title", "Doanh thu nhập tay theo từng dự án (triệu đồng)");
    await expect(headers.nth(5)).toHaveAttribute("title", "EBIT của dự án đã nghiệm thu; dự án đang triển khai chưa có EBIT");

    const help = block.getByRole("button", { name: "Cách đọc bảng này" });
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await help.click();
    await expect(help).toHaveAttribute("aria-expanded", "true");
    await expect(block.getByRole("listitem")).toHaveCount(5);
    await expect(block).toContainText("Doanh thu dự án do Admin/PM nhập tay theo từng dự án.");
    await expect(block).toContainText("Không tính được: thiếu dữ liệu bắt buộc nên chưa ra được lãi lỗ");
    await help.click();
    await expect(block.getByRole("listitem")).toHaveCount(0);

    const rowA = block.getByRole("row", { name: /Dự án A/ });
    await expect(rowA.getByRole("cell")).toHaveText([/^Dự án A\s*Khách A · PIC PM-1$/, "Đã nghiệm thu", "03/26 → 07/26", "420", "277", /^143\s*34,0%$/, "Chính thức"]);
    await expect(rowA.getByRole("link", { name: "Dự án A" })).toHaveAttribute("href", /^\/pnl\/prj-a\?returnTo=%2Fpnl/);
    // The result label explains itself on hover or focus.
    await expect(rowA.getByLabel(/^Chính thức\. Chính thức: dự án đã nghiệm thu, đủ dữ liệu và mọi tháng đã khóa sổ/)).toHaveText("Chính thức");
    const rowB = block.getByRole("row", { name: /Dự án B/ });
    await expect(rowB.getByLabel(/^Tạm tính\. .*Lý do: 105,5 giờ chưa có chi phí nhân sự tháng được duyệt; Tháng 08\/2026, 09\/2026 chưa khóa sổ\.$/)).toHaveText("Tạm tính");

    await expect(block.getByRole("row", { name: /Tổng 3 dự án/ })).toHaveCount(0);
    await block.getByRole("tab", { name: "Đã nghiệm thu (3)" }).click();
    await expect(page).toHaveURL(/tab=accepted/);
    await expect(headers).toHaveCount(7);
    await expect(headers).toContainText(["Dự án", "Bắt đầu → Nghiệm thu", "Doanh thu dự án", "Chi phí nhân sự", "Chi phí khác", "EBIT · Biên", "Kết quả"]);
    await expect(rowA.getByRole("cell")).toHaveText([/^Dự án A\s*Khách A · PIC PM-1$/, "03/26 → 07/26", "420", "236", "41", /^143\s*34,0%$/, "Chính thức"]);

    const total = block.getByRole("row", { name: /Tổng 3 dự án/ });
    await expect(total.getByRole("cell")).toHaveText(["Tổng 3 dự án", "1.240", "690", "122", /^428\s*34,5%$/, "Tạm tính"]);
    await expect(block).toContainText("Kiểm tra giờ: 2.140 giờ đã ghi = 1.986 giờ đã tính vào P&L + 117,5 giờ chờ xử lý + 36,5 giờ không tính vào P&L dự án · khớp. Dòng tổng bằng các ô tổng phía trên.");
    await expect(block).toContainText("Trang 1/1 · các ô tổng và thứ tự sắp xếp tính trên toàn bộ danh sách");

    await tabs.nth(2).click();
    await expect(page).toHaveURL(/tab=in_progress/);
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => api.last("dashboard")?.query.get("tab")).toBe("in_progress");
    await expect(headers).toHaveCount(7);
    await expect(headers).toContainText(["Dự án", "Bắt đầu", "Doanh thu dự án", "Chi phí nhân sự", "Chi phí khác", "Tổng chi phí đến nay", "Kết quả"]);
    await expect(block.getByRole("row", { name: /Dự án D/ }).getByRole("cell")).toHaveText([/^Dự án D\s*Khách D · PIC PM-2$/, "06/26", "100", "30", "5", "35", "Tạm tính"]);
    await expect(block.getByRole("row", { name: /Tổng 3 dự án/ })).toHaveCount(0);
    await expect(block).toContainText("không cộng vào các ô tổng");

    // Opening a project carries this screen's filters, so "Quay lại" restores them.
    await block.getByRole("row", { name: /Dự án D/ }).getByRole("cell").nth(1).click();
    await expect(page).toHaveURL(/\/pnl\/prj-d\?returnTo=/);
    await expect(page.getByRole("link", { name: "Quay lại P&L dự án" })).toHaveAttribute("href", /^\/pnl\?(fromMonth=2026-01&toMonth=2026-12&)?tab=in_progress$/);
  });

  test("a “Không tính được” project says why in its row, and its empty cells explain the dash", async ({ page }) => {
    await installPnlMocks(page);
    await page.route("**/api/pnl/dashboard**", async (route) => {
      const body = dashboardFixture();
      const row = body.data.accepted.rows[2];
      Object.assign(row, { revenueAmount: null, ebitAmount: null, marginPercent: null, result: { label: "not_computable", labelText: "Không tính được", reasons: [{ code: "no_project_value", label: "chưa nhập doanh thu dự án", target: "project_value" }, { code: "months_unlocked", label: "tháng 09 chưa khóa", periodKeys: ["2026-09"], target: "periods" }] } });
      body.data.totals.notComputableProjectCount = 1;
      body.data.pending = [{ kind: "not_computable", label: "1 dự án Không tính được, chưa cộng vào ô tổng", projectCount: 1, target: "project_value" }];
      await fulfillJson(route, body);
    });
    await page.goto("/pnl?year=2026&tab=accepted");

    await expect(page.getByRole("region", { name: "Năm ô tổng" }).locator("> div").first()).toContainText("1 dự án chưa tính được, chưa cộng vào tổng");
    const why = page.getByRole("region", { name: "Vì sao số liệu còn tạm tính?" });
    await expect(why.getByRole("listitem")).toHaveText([/^1 dự án chưa tính được lãi lỗ nên chưa cộng vào các ô tổng\.\s*Xem lý do từng dự án ›$/]);
    await expect(why.getByRole("link", { name: "Xem lý do từng dự án ›" })).toHaveAttribute("href", "#pnl-projects");

    const rowC = page.getByRole("region", { name: "Bảng dự án" }).getByRole("row", { name: /Dự án C/ });
    // The reason sits on one line under the project name (whole sentence in its tooltip), not as a paragraph in the result cell.
    await expect(rowC.getByRole("cell").first()).toHaveText(/^Dự án C\s*Khách C · PIC PM-1\s*Chưa nhập doanh thu dự án nên chưa tính được EBIT$/);
    await expect(rowC.getByTitle("Chưa nhập doanh thu dự án nên chưa tính được EBIT", { exact: true })).toHaveCount(3); // the line, and the two empty cells
    await expect(rowC.getByRole("cell").last()).toHaveText("Không tính được");
    await expect(rowC.getByLabel("Chưa có số: Chưa nhập doanh thu dự án nên chưa tính được EBIT")).toHaveCount(2); // doanh thu, EBIT
    await expect(rowC.getByRole("cell").nth(3)).toHaveText("136"); // the cost it does have still shows
  });

  test("company-level costs: four lines outside project P&L, one opens its list by person and project", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl?year=2026");
    const block = page.getByRole("region", { name: "Chi phí nhân sự không thuộc P&L dự án" });
    await expect(block).toContainText("Không cộng vào các ô tổng phía trên.");
    const lines = block.getByRole("button");
    await expect(lines).toHaveCount(4);
    await expect(lines).toHaveText([/Pre-sale của deal thua\s*18/, /Sau nghiệm thu\s*24/, /Việc nội bộ\s*65/, /Chưa phân bổ\s*41/]);

    await lines.first().click();
    await expect(lines.first()).toHaveAttribute("aria-expanded", "true");
    const detail = block.getByRole("table");
    await expect(detail).toContainText("Chi phí Pre-sale của deal thua · theo người và dự án");
    await expect(detail.getByRole("columnheader")).toHaveText(["Tháng", "Nhân sự", "Dự án", "Giờ", "Chi phí"]);
    await expect(detail.getByRole("row", { name: /Deal thua X/ }).getByRole("cell")).toHaveText(["04/2026", "BD-1", "Deal thua X", "90", "18,00"]);
    const call = api.last("company-costs");
    expect([call?.query.get("from"), call?.query.get("to"), call?.query.get("line")]).toEqual(["2026-01", "2026-12", "pre_sale"]);
  });

  test("Admin outside the cost permission group: every “—” says why, and links to cost screens are not offered", async ({ page }) => {
    await installPnlMocks(page, { moneyVisible: false });
    await page.goto("/pnl?year=2026&tab=accepted");
    await expect(page.getByRole("note").filter({ hasText: "Bạn không thuộc nhóm quyền chi phí" })).toContainText("doanh thu, chi phí, đơn giá giờ của nhân sự và biên lợi nhuận không hiển thị (ghi “—”). Giờ và trạng thái dữ liệu vẫn xem được.");
    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(tiles.nth(0)).toContainText(/Dự án\s*3/);
    for (const index of [1, 2, 3, 4]) await expect(tiles.nth(index)).toContainText(/—\s*Chỉ nhóm quyền chi phí xem được số tiền/);
    const rowA = page.getByRole("region", { name: "Bảng dự án" }).getByRole("row", { name: /Dự án A/ });
    await expect(rowA.getByRole("cell")).toHaveText([/^Dự án A\s*Khách A · PIC PM-1$/, "03/26 → 07/26", "—", "—", "—", "—", "Chính thức"]);
    await expect(rowA.getByLabel("Chưa có số: Chỉ nhóm quyền chi phí xem được số tiền")).toHaveCount(4);
    // Hours are not money: the hours check stays.
    await expect(page.getByText(/2\.140 giờ đã ghi = 1\.986 giờ đã tính vào P&L/)).toBeVisible();
    // Whoever cannot edit or approve costs is not sent to the screens that do.
    await expect(page.getByRole("link", { name: "Thiết lập P&L", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Chi phí nhân sự", exact: true })).toHaveCount(0);
    const why = page.getByRole("region", { name: "Vì sao số liệu còn tạm tính?" });
    await expect(why.getByRole("listitem")).toHaveCount(3);
    await expect(why.getByRole("link")).toHaveText(["Phân loại giờ ›"]);
  });

  test("403 from the dashboard endpoint: the no-permission state replaces every figure", async ({ page }) => {
    await installPnlMocks(page, { forbidden: (path) => path === "dashboard" });
    await page.goto("/pnl?year=2026");
    const state = page.getByRole("status").filter({ hasText: "Bạn chưa có quyền xem tab P&L" });
    await expect(state).toContainText("Tab P&L chỉ mở cho tài khoản Admin; doanh thu, chi phí và đơn giá giờ của nhân sự chỉ hiện với nhóm quyền chi phí.");
    await expect(state).toContainText(FORBIDDEN_MESSAGE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("P&L dự án");
    await expect(page.getByRole("region", { name: "Năm ô tổng" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Bảng dự án" })).toHaveCount(0);
    await expect(page.getByText("1.240")).toHaveCount(0);
  });
});

// --- Mục 5: P&L dự án ---------------------------------------------------------------

test.describe("P&L của một dự án (/pnl/[projectId])", () => {
  test("header with back link, KPI tiles, and the “Báo cáo lãi lỗ” statement: result badge, reasons, Doanh thu → chi phí → EBIT", async ({ page }) => {
    await installPnlMocks(page);
    await page.goto("/pnl/prj-a");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dự án A");
    await expect(page.getByText("Khách A · Đang triển khai", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Quay lại P&L dự án" })).toHaveAttribute("href", "/pnl");
    await expect(page.getByText("Đơn vị tiền: triệu đồng", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Mở dự án", exact: true })).toHaveAttribute("href", "/projects/prj-a");

    const scope = page.getByRole("region", { name: "Phạm vi thời gian" });
    await expect(scope.getByRole("button", { name: "Thu hẹp theo thời gian: Toàn dự án" })).toBeVisible();
    await expect(scope).toContainText("P&L tính theo tháng nên khoảng ngày được làm tròn thành các tháng trọn vẹn của dự án (08/2026 – 09/2026). Khi thu hẹp, Doanh thu và EBIT ghi “Chỉ xem ở Toàn dự án” vì chỉ tính cho cả dự án.");

    // Tile: small label, figure, one caption.
    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(tiles).toHaveCount(5);
    await expect(tiles.nth(0)).toHaveText(/^Giờ kế hoạch\s*260\s*giờ\s*từ các sub-task đã lập$/);
    await expect(tiles.nth(1)).toHaveText(/^Giờ thực hiện\s*273,5\s*giờ\s*\+5% so với kế hoạch · 2 tháng có giờ$/);
    await expect(tiles.nth(2)).toHaveText(/^Doanh thu dự án\s*Sửa\s*67,2\s*nhập tay theo từng dự án$/);
    await expect(tiles.nth(3)).toHaveText(/^Tổng chi phí\s*30,97\s*Nhân sự 26,35 · khác 4,62$/);
    await expect(tiles.nth(4)).toHaveText(/^EBIT dự kiến\s*36,23\s*Biên 53,9% · Tạm tính$/);
    await expect(tiles.nth(2).getByTitle("67.200.000 đ")).toBeVisible();
    await expect(tiles.nth(3).getByTitle("30.970.000 đ")).toBeVisible();
    await expect(tiles.nth(4).getByTitle("36.230.000 đ")).toBeVisible();

    // The statement is the centre of the page: badge and reasons on top, then the P&L read top to bottom.
    const statement = page.getByRole("region", { name: "Báo cáo lãi lỗ · toàn dự án" });
    await expect(statement).toContainText("Loại dự án Khách hàng · PIC PM-1 · Chưa nghiệm thu (G7) · Hồ sơ P&L: Đang ghi nhận");
    const badge = statement.getByLabel(/^Tạm tính\. .*Lý do: 105,5 giờ chưa có chi phí nhân sự tháng được duyệt; Tháng 08\/2026, 09\/2026 chưa khóa sổ\.$/);
    await expect(badge).toHaveText("Tạm tính");
    await expect(statement.getByRole("heading", { level: 3, name: "Vì sao số liệu còn tạm tính?" })).toBeVisible();
    await expect(statement.getByRole("listitem")).toHaveText([
      /^105,5 giờ chưa có chi phí nhân sự tháng được duyệt\.\s*Nhập \/ duyệt chi phí nhân sự ›$/,
      /^Tháng 08\/2026, 09\/2026 chưa khóa sổ\.\s*Mở kỳ và khóa kỳ ›$/
    ]);
    await expect(statement.getByRole("link", { name: "Nhập / duyệt chi phí nhân sự ›" })).toHaveAttribute("href", "/users/costs");
    await expect(statement.getByRole("link", { name: "Mở kỳ và khóa kỳ ›" })).toHaveAttribute("href", "/pnl/costs?tab=periods&periodKey=2026-08");
    for (const line of [
      /Doanh thu dự án\s*Doanh thu do Admin\/PM nhập trực tiếp theo từng dự án; không lấy tự động từ hệ thống\s*67,2/,
      /Chi phí nhân sự\s*Giờ đã tính vào P&L × đơn giá giờ của từng người trong tháng\s*26,35/,
      /Chi phí khác\s*Quỹ chi phí chung được chia, chi phí riêng của dự án, hoa hồng…\s*4,62/,
      /Tổng chi phí\s*Chi phí nhân sự \+ chi phí khác\s*30,97/,
      /EBIT dự kiến\s*Lãi lỗ dự kiến = doanh thu dự án − tổng chi phí đến nay\s*36,23\s*Biên EBIT 53,9%/
    ]) await expect(statement).toContainText(line);
    await expect(page.getByText(/cost rate/i)).toHaveCount(0);
  });

  test("Phụ lục B ca 10 · “Sửa” on the Doanh thu tile: after G1 a change of doanh thu dự án needs a reason, then it is saved and the page re-reads", async ({ page }) => {
    await installPnlMocks(page);
    const writes: Array<{ amount: number; reason?: string }> = [];
    await page.route("**/api/pnl/projects/prj-a/project-value", async (route) => {
      const body = route.request().postDataJSON() as { amount: number; reason?: string };
      if (!body.reason) return fulfillJson(route, { message: "Sửa doanh thu sau G1 bắt buộc phải ghi lý do." }, 400);
      writes.push(body);
      await fulfillJson(route, { data: { projectId: "prj-a", amount: body.amount } });
    });
    await page.goto("/pnl/prj-a");
    const tile = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div").nth(2);
    await tile.getByRole("button", { name: "Sửa" }).click();
    const dialog = page.getByRole("dialog", { name: "Sửa doanh thu dự án" });
    await expect(dialog.getByLabel("Doanh thu dự án (đồng)")).toHaveValue("67.200.000");
    await dialog.getByLabel("Doanh thu dự án (đồng)").fill("70.000.000");
    await expect(dialog.getByText("= 70.000.000 đ")).toBeVisible();
    // G1 đã duyệt: để trống lý do thì không lưu được.
    await expect(dialog.getByRole("button", { name: "Lưu" })).toBeDisabled();
    await dialog.getByLabel("Lý do điều chỉnh (bắt buộc — dự án đã qua G1)").fill("Phụ lục 02");
    await dialog.getByRole("button", { name: "Lưu" }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([{ amount: 70_000_000, reason: "Phụ lục 02" }]);
  });

  test("Phụ lục B ca 9 · opened from the project page (“Xem P&L ↗”): scope Toàn dự án, and “Quay lại” leads back to the project", async ({ page }) => {
    const { last } = await installPnlMocks(page);
    await page.goto("/pnl/prj-a?returnTo=%2Fprojects%2Fprj-a");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dự án A");
    await expect(page.getByRole("link", { name: "Quay lại P&L dự án" })).toHaveAttribute("href", "/projects/prj-a");
    expect(last("projects/prj-a")?.query.get("fromMonth")).toBeNull();
    // A returnTo that is not a path of this site is ignored.
    await page.goto("/pnl/prj-a?returnTo=https%3A%2F%2Fexample.com");
    await expect(page.getByRole("link", { name: "Quay lại P&L dự án" })).toHaveAttribute("href", "/pnl");
  });

  test("an Admin outside the cost permission group gets no “Sửa” on Doanh thu", async ({ page }) => {
    await installPnlMocks(page, { moneyVisible: false });
    await page.goto("/pnl/prj-a");
    const totals = page.getByRole("region", { name: "Năm ô tổng" });
    await expect(totals).toBeVisible();
    const revenueTile = totals.locator("> div").filter({ hasText: "Doanh thu" });
    await expect(revenueTile.getByRole("button", { name: "Sửa", exact: true })).toHaveCount(0);
  });

  test("the statement's cost-item lines: groups fold, “Nguồn số” opens the source, “Nhập tay” the entry of project costs; history stays a collapsible", async ({ page }) => {
    await installPnlMocks(page);
    await page.goto("/pnl/prj-a");
    const statement = page.getByRole("region", { name: /^Báo cáo lãi lỗ/ });
    await expect(statement).toContainText("Chi tiết theo khoản mục P&L");
    const toggle = statement.getByRole("button", { name: "Thu gọn" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true"); // open by default: it is part of the statement
    const tree = page.locator("#pnl-items-panel");
    const line = (code: string) => tree.locator(`[data-item-code="${code}"]`);
    await expect(tree.locator("[data-item-code]")).toHaveCount(5);
    await expect(line("DT")).toHaveText(/^Doanh thu dự án\s*Nhập tay\s*67,20\s*Nguồn số\s*$/);
    await expect(line("CP")).toHaveText(/^Tổng chi phí\s*Tổng nhóm\s*30,97\s*chưa đủ\s*Nguồn số\s*$/);
    await expect(line("EBIT.PCT")).toContainText("53,9%");
    await expect(line("CP.RIENG").getByLabel(/^Chưa có số: Khoản mục này chưa có số/)).toHaveText("—");

    await tree.getByRole("button", { name: "Nguồn số của Chi phí nhân sự" }).click();
    await expect(line("CP.NS")).toContainText("Nguồn số: Giờ tính P&L × cost rate tháng");
    await expect(line("CP.NS")).toContainText("08/2026: 21,34 · 09/2026: 5,01");
    await tree.getByRole("button", { name: "Nhập tay của Chi phí riêng của dự án" }).click();
    await expect(line("CP.RIENG")).toContainText("Nhập tay · chi phí riêng theo tháng phát sinh");
    await expect(line("CP.RIENG").getByRole("button", { name: "+ Thêm khoản" })).toBeVisible();

    await tree.getByRole("button", { name: "Gập nhóm Tổng chi phí" }).click();
    await expect(tree.locator("[data-item-code]")).toHaveCount(3);
    await tree.getByRole("button", { name: "Mở nhóm Tổng chi phí" }).click();
    await expect(tree.locator("[data-item-code]")).toHaveCount(5);
    await toggle.click();
    await expect(tree).toHaveCount(0);

    const history = page.getByRole("button", { name: /Lịch sử thay đổi số liệu/ });
    await expect(history).toContainText("Ai đã sửa gì, khi nào — gồm các lần sửa doanh thu dự án, khóa sổ và mở lại kỳ.");
    await expect(history).toHaveAttribute("aria-expanded", "false");
    await history.click();
    await expect(page.locator("#pnl-history-panel").getByRole("listitem")).toHaveText(/05\/10\/2026 09:00\s*Mở lại kỳ\s*kỳ 08\/2026\s*PM-1\s*lý do: Bổ sung hóa đơn công cụ AI/);
  });

  test("people card: one compact row per person, a status chip instead of a sentence", async ({ page }) => {
    await installPnlMocks(page);
    await page.goto("/pnl/prj-a");
    const people = page.getByRole("region", { name: "Nhân sự tham gia" });
    await expect(people.getByRole("columnheader")).toHaveText(["Nhân sự", "Giờ kế hoạch", "Giờ đã ghi", "Giờ đã tính", "Chi phí", "Dữ liệu"]);
    const row = (name: string) => people.getByRole("row", { name: new RegExp(`^${name}`) });
    await expect(row("Nhân sự A").getByRole("rowheader")).toHaveText(/^SA\s*Nhân sự A\s*Delivery$/);
    await expect(row("Nhân sự A").getByRole("cell")).toHaveText(["120", "149", "149", "22,61", "Đủ"]);
    await expect(row("Nhân sự B").getByRole("cell")).toHaveText(["100", "105,5", "0", "—", "Thiếu"]);
    // The whole reason is in the chip's tooltip, and once in the statement's reasons list.
    await expect(row("Nhân sự B").getByLabel("Thiếu: Chưa có chi phí nhân sự tháng được duyệt (tháng 09/2026)")).toHaveText("Thiếu");
    await expect(row("PM-1").getByRole("cell")).toHaveText(["16", "16", "16", "3,20", "Đủ"]);
    await expect(row("BD-1").getByRole("cell")).toHaveText(["3", "3", "3", "0,54", "Đủ"]);
    await expect(row("Chưa giao").getByRole("cell")).toHaveText(["21", "", "", "", ""]);
  });

  test("month table: seven columns, chips, a month opens its per-person list below the row; day grid and tasks behind the switch; Sau nghiệm thu apart", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl/prj-a");
    const block = page.getByRole("region", { name: "Giờ và chi phí theo tháng" });
    const table = block.getByRole("table").first();
    await expect(table.locator("> thead").getByRole("columnheader")).toHaveText(["Tháng", "Trạng thái kỳ", "Giờ đã ghi", "Đã tính", "Chờ xử lý", "Chi phí", "Dữ liệu"]);
    const help = block.getByRole("button", { name: "Cách đọc bảng này" });
    await help.click();
    await expect(block).toContainText("Giờ đã ghi = đã tính vào P&L + chờ xử lý + không tính.");
    await help.click();

    const cells = (name: RegExp) => table.locator("> tbody > tr").filter({ has: page.getByRole("rowheader", { name }) }).getByRole("cell");
    await expect(cells(/^Toàn dự án$/)).toHaveText(["273,5", "168", "105,5", "30,97", "Thiếu 2 ›"]);
    await expect(cells(/08\/2026/)).toHaveText(["Chờ khóa", "139", "139", "0", "22,60", "Đủ"]);
    await expect(cells(/09\/2026/)).toHaveText(["Chờ khóa", "134,5", "29", "105,5", "5,01", "Thiếu ›"]);
    await expect(cells(/09\/2026/).nth(3)).toHaveAttribute("title", "Chưa có chi phí nhân sự tháng được duyệt: 105,5 giờ");
    await expect(cells(/09\/2026/).nth(4)).toHaveAttribute("title", "Chi phí nhân sự 5,01 · chi phí khác — (triệu đồng)");
    await expect(cells(/08\/2026/).nth(4)).toHaveAttribute("title", "Chi phí nhân sự 21,34 · chi phí khác 1,26 (triệu đồng)");
    const fix = cells(/09\/2026/).last().getByRole("link");
    await expect(fix).toHaveAttribute("href", "/users/costs?periodKey=2026-09");
    await expect(fix).toHaveAttribute("title", "Chưa có chi phí nhân sự tháng được duyệt. Bấm để mở nơi bổ sung.");
    await expect(cells(/^Khoản tính một lần cho cả dự án/)).toHaveText(["3,36", "Dự kiến"]);
    // "Sau nghiệm thu" is its own block under the table, not rows of it.
    await expect(table.getByRole("rowheader", { name: /Sau nghiệm thu/ })).toHaveCount(0);
    await expect(block.getByRole("group", { name: "Sau nghiệm thu" })).toContainText("Chưa qua G7 · hiện giờ và chi phí Milestone 4 theo tháng · không cộng vào Toàn dự án");

    await block.getByRole("button", { name: /Thiếu 2/ }).click();
    await expect(block.getByRole("link", { name: "Chưa có chi phí nhân sự tháng được duyệt · tháng 09/2026 ›" })).toHaveAttribute("href", "/users/costs?periodKey=2026-09");
    await expect(block.getByRole("link", { name: "Quỹ chi phí chung chưa chia · tháng 09/2026 ›" })).toHaveAttribute("href", "/pnl/costs?tab=funds&periodKey=2026-09");

    const september = block.getByRole("button", { name: "09/2026", exact: true });
    await expect(september).toHaveAttribute("aria-expanded", "false");
    await september.click();
    await expect(september).toHaveAttribute("aria-expanded", "true");
    const panel = block.locator("#pnl-month-2026-09");
    await expect(panel).toContainText("Tháng 09/2026 · giờ chuẩn 176 giờ");
    expect(api.last("projects/prj-a/months/2026-09")).toBeTruthy();
    const views = panel.getByRole("group", { name: "Cách xem tháng 09/2026" });
    await expect(views.getByRole("button")).toHaveText(["Theo người", "Xem theo ngày", "Theo task"]);
    await expect(views.getByRole("button", { name: "Theo người" })).toHaveAttribute("aria-pressed", "true");

    // Default: a simple list per person.
    const detail = panel.getByRole("table");
    await expect(detail.getByRole("columnheader")).toHaveText(["Nhân sự", "Giờ đã ghi", "Giờ đã tính", "Đơn giá giờ", "Chi phí", "Dữ liệu"]);
    await expect(detail.getByRole("row", { name: /^Nhân sự A/ }).getByRole("cell")).toHaveText(["29", "29", "162.381", "5,01", "Đủ"]);
    await expect(detail.getByRole("row", { name: /^Nhân sự B/ }).getByRole("cell")).toHaveText(["105,5", "0", "—", "—", "Thiếu"]);
    await expect(detail.getByLabel("Thiếu: Chưa có chi phí nhân sự tháng được duyệt")).toHaveText("Thiếu");
    await expect(panel).toContainText("Kiểm tra giờ của tháng: 134,5 giờ đã ghi = 29 đã tính vào P&L + 105,5 chờ xử lý + 0 không tính · khớp");
    await expect(panel.getByRole("link", { name: "Xem từng dòng giờ đã ghi ›" })).toHaveAttribute("href", "/pnl/hours?projectId=prj-a&periodKey=2026-09&status=all");

    // The day grid is behind "Xem theo ngày" and scrolls inside its own box.
    await views.getByRole("button", { name: "Xem theo ngày" }).click();
    await expect(detail.getByRole("columnheader")).toHaveCount(1 + 30 + 1); // Nhân sự, 30 ngày, Tổng giờ
    await expect(detail.getByLabel("Nghỉ cá nhân")).toHaveCount(1);
    expect(await detail.evaluate((element) => { const box = element.parentElement as HTMLElement; return getComputedStyle(box).overflowX === "auto" && box.getBoundingClientRect().width <= (box.closest("td") as HTMLElement).getBoundingClientRect().width; })).toBe(true);

    await views.getByRole("button", { name: "Theo task" }).click();
    await expect(detail.getByRole("columnheader")).toHaveText(["Task", "Giờ đã ghi", "Giờ đã tính", "Chờ xử lý", "Chi phí", "Dữ liệu"]);
    const task = detail.getByRole("row", { name: /Cấu hình Base bán hàng/ });
    await expect(task.getByRole("cell")).toHaveText(["Cấu hình Base bán hàng", "134,5", "29", "105,5", "5,01", "Thiếu"]);
    await expect(task.getByLabel("Thiếu: Chưa có chi phí nhân sự tháng được duyệt: 105,5 giờ")).toHaveText("Thiếu");

    await block.getByRole("button", { name: "Mở hết các tháng ›" }).click();
    await expect(block.getByRole("button", { name: "08/2026", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(block.locator("#pnl-month-2026-08")).toContainText("Tháng 08/2026 · giờ chuẩn 176 giờ");
    expect(api.last("projects/prj-a/months/all")).toBeTruthy();
    await expect(block.getByRole("button", { name: "Thu gọn các tháng ›" })).toBeVisible();

    // Nothing is wider than the page: the document does not scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("narrowing the scope with the date-range control: quick picks, days rounded to months, URL, API query, and “×” back to Toàn dự án", async ({ page }) => {
    const api = await installPnlMocks(page);
    await page.goto("/pnl/prj-a?fromMonth=2026-08&toMonth=2026-08&returnTo=%2Fpnl%3Ftab%3Din_progress");
    const header = page.getByRole("region", { name: "Phạm vi thời gian" });
    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(header.getByRole("button", { name: "Thu hẹp theo thời gian: 01/08/2026 – 31/08/2026" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Báo cáo lãi lỗ · 08/2026 – 08/2026" })).toBeVisible();
    await expect(tiles.nth(2)).toContainText(/—\s*Chỉ xem ở Toàn dự án$/);
    await expect(tiles.nth(4)).toContainText(/—\s*Chỉ xem ở Toàn dự án$/);

    await header.getByRole("button", { name: /^Thu hẹp theo thời gian: / }).click();
    const picker = page.getByRole("dialog", { name: "Thu hẹp theo thời gian" });
    await expect(picker.getByRole("button", { name: "Toàn dự án", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(picker.getByRole("button", { name: "Tất cả thời gian" })).toHaveCount(0);
    await expect(picker).toContainText("Tháng 08/2026");
    await picker.getByRole("button", { name: "Tháng sau" }).click();
    await picker.getByRole("button", { name: "10/09/2026", exact: true }).click();
    await picker.getByRole("button", { name: "12/09/2026", exact: true }).click();
    await expect(picker).toContainText("Từ 10/09/2026 đến hết ngày 12/09/2026");
    await picker.getByRole("button", { name: "Áp dụng" }).click();

    // Three days of September become the whole month; where "Quay lại" leads stays.
    await expect(page).toHaveURL(/\/pnl\/prj-a\?fromMonth=2026-09&toMonth=2026-09&returnTo=/);
    await expect(page.getByRole("link", { name: "Quay lại P&L dự án" })).toHaveAttribute("href", "/pnl?tab=in_progress");
    await expect.poll(() => api.last("projects/prj-a")?.query.toString()).toBe("fromMonth=2026-09&toMonth=2026-09");

    // "×" on the control (and the "Toàn dự án" pick) clears the scope.
    await header.getByRole("button", { name: "Xóa lọc thời gian" }).click();
    await expect(page).not.toHaveURL(/fromMonth=/);
    await expect(header.getByRole("button", { name: "Thu hẹp theo thời gian: Toàn dự án" })).toBeVisible();
    await expect.poll(() => api.last("projects/prj-a")?.query.toString()).toBe("");
    await expect(tiles.nth(2)).toContainText("67,2");

    // The "Toàn dự án" pick is the selected one again.
    await header.getByRole("button", { name: /^Thu hẹp theo thời gian: / }).click();
    await expect(picker.getByRole("button", { name: "Toàn dự án", exact: true })).toHaveAttribute("aria-pressed", "true");
    await picker.getByRole("button", { name: "Toàn dự án", exact: true }).click();
    await expect(page).not.toHaveURL(/fromMonth=/);
  });

  test("outside the cost permission group: note, no cost columns, item lines and history locked, no links to cost screens", async ({ page }) => {
    await installPnlMocks(page, { moneyVisible: false });
    await page.goto("/pnl/prj-a");
    await expect(page.getByRole("note").filter({ hasText: "Bạn không thuộc nhóm quyền chi phí" })).toBeVisible();
    const tiles = page.getByRole("region", { name: "Năm ô tổng" }).locator("> div");
    await expect(tiles.nth(1)).toContainText("273,5");
    for (const index of [2, 3, 4]) await expect(tiles.nth(index)).toContainText(/—\s*Chỉ nhóm quyền chi phí xem được số tiền$/);
    await expect(page.getByRole("region", { name: "Nhân sự tham gia" }).getByRole("columnheader")).toHaveText(["Nhân sự", "Giờ kế hoạch", "Giờ đã ghi", "Giờ đã tính", "Dữ liệu"]);
    await expect(page.getByRole("region", { name: "Giờ và chi phí theo tháng" }).getByRole("columnheader")).toHaveText(["Tháng", "Trạng thái kỳ", "Giờ đã ghi", "Đã tính", "Chờ xử lý", "Dữ liệu"]);

    const statement = page.getByRole("region", { name: /^Báo cáo lãi lỗ/ });
    await expect(statement.getByLabel("Chưa có số: Chỉ nhóm quyền chi phí xem được số tiền")).toHaveCount(5); // every amount of the statement
    await expect(statement.getByTitle("Bạn không thuộc nhóm quyền chi phí nên không mở được mục này.")).toHaveText("Chỉ nhóm quyền chi phí");
    await expect(page.locator("#pnl-items-panel")).toHaveCount(0);
    const history = page.getByRole("button", { name: /Lịch sử thay đổi số liệu/ });
    await expect(history).toBeDisabled();
    await expect(history).toHaveAttribute("title", "Bạn không thuộc nhóm quyền chi phí nên không mở được mục này.");
    await expect(statement.getByRole("listitem")).toHaveCount(2);
    await expect(statement.getByRole("link")).toHaveCount(0);
  });

  test("a project that does not load keeps the header and its back link", async ({ page }) => {
    await installPnlMocks(page);
    await page.goto("/pnl/prj-missing");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("P&L của dự án");
    await expect(page.getByRole("link", { name: "Quay lại P&L dự án" })).toHaveAttribute("href", "/pnl");
    await expect(page.getByRole("alert").filter({ hasText: "Unmocked" })).toContainText("Unmocked P&L endpoint: projects/prj-missing");
  });
});

// --- Thiết lập P&L -----------------------------------------------------

test.describe("Thiết lập P&L (/pnl/costs)", () => {
  const TABS = [
    { id: "items", label: "Khoản mục", endpoint: "config/items" },
    { id: "parameters", label: "Tham số", endpoint: "config/parameters" }
  ];

  test("header leads back to Admin; only the two supported tabs are reachable and legacy tabs are rewritten", async ({ page }) => {
    const api = await installPnlMocks(page);
    for (const tab of TABS) {
      await page.goto(`/pnl/costs?tab=${tab.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thiết lập P&L");
      await expect(page.getByRole("link", { name: "Quay lại Admin" })).toHaveAttribute("href", "/admin");
      const tabs = page.getByRole("tablist", { name: "Thiết lập P&L" }).getByRole("tab");
      await expect(tabs).toHaveText(TABS.map((entry) => entry.label));
      await expect(page.getByRole("tab", { selected: true })).toHaveText(tab.label);
      await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", `pnl-setup-tab-${tab.id}`);
      await expect.poll(() => Boolean(api.last(tab.endpoint))).toBe(true);
    }
    await page.goto("/pnl/costs?tab=cost-categories");
    await expect(page).toHaveURL(/\/pnl\/costs\?tab=items$/);
    await expect(page.getByRole("tab", { selected: true })).toHaveText("Khoản mục");

    await page.goto("/pnl/costs?tab=funds&periodKey=2026-09");
    await expect(page).toHaveURL(/\/pnl\/costs\?tab=items$/);
    await expect(page.getByRole("tab", { selected: true })).toHaveText("Khoản mục");

    await page.goto("/pnl/config");
    await expect(page).toHaveURL(/\/pnl\/costs\?tab=items$/);
    await expect(page.getByRole("tab", { selected: true })).toHaveText("Khoản mục");
  });

  test("Khoản mục: configuration check, the cost-item tree searches and folds, an item opens its declaration panel", async ({ page }) => {
    await installPnlMocks(page);
    await page.goto("/pnl/costs?tab=items");
    await expect(page.getByText("✓ Không có tham chiếu vòng · ✓ Mọi dòng tổng do hệ thống cộng · 1 khoản mục bắt buộc chưa có số ở kỳ 10/2026")).toBeVisible();

    const tree = page.getByRole("region", { name: "Cây khoản mục" });
    await expect(tree.getByRole("columnheader")).toHaveText(["Khoản mục", "Cách lấy số"]);
    const rows = tree.locator("tbody tr");
    await expect(rows).toHaveText([/Doanh thu dự án\s*Nhập tay/, /Tổng chi phí\s*Tổng nhóm/, /Chi phí nhân sự\s*Tổng nhóm/, /Delivery\s*Lấy từ hệ thống/, /Công cụ AI\s*Phân bổ quỹ/, /Hoa hồng\s*Công thức/]);

    // The search keeps a hit with its parents, without accents, whatever is folded.
    const search = page.getByLabel("Tìm khoản mục");
    await search.fill("phan bo quy");
    await expect(rows).toHaveText([/Tổng chi phí/, /Công cụ AI\s*Phân bổ quỹ/]);
    await search.fill("không có khoản này");
    await expect(tree).toContainText("Không có kết quả phù hợp bộ lọc.");
    await tree.getByRole("button", { name: "Đặt lại bộ lọc" }).click();
    await expect(rows).toHaveCount(6);

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
    await expect(panel).toContainText("[Doanh thu dự án] × [Tỷ lệ hoa hồng]");
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
    // Chốt 13/10: no selling rate per role on this tab any more.
    await expect(table.getByText(/Đơn giá bán/)).toHaveCount(0);
    await expect(table).toContainText("Giờ chuẩn tháng 10/2026: 22 ngày × 8 = 176 giờ, hệ thống tính từ lịch ngày nghỉ");
    await expect(page.getByText("Thứ tự ưu tiên: dự án › khách hàng › loại dự án › công ty.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Tham số đã chuyển đi" })).toContainText("Cost rate theo giờ → Hồ sơ nhân sự › Chi phí theo tháng");
    // Tỷ lệ hoa hồng is the row opened by default (khối 3).
    await expect(page.getByRole("heading", { level: 2, name: "Tỷ lệ hoa hồng · giá trị theo phạm vi" })).toBeVisible();
    await table.getByRole("button", { name: "Xem giá trị theo phạm vi của Tỷ giá USD" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Tỷ giá USD · giá trị theo phạm vi" })).toBeVisible();
  });
});

// --- Mục 6.7 và danh sách giờ đã ghi ------------------------------------------------

test("/users/costs: header back to Nhân sự, filter bar (search, month, status, department), the staff-cost table; a 403 shows the cost-permission notice", async ({ page }) => {
  let forbidden = false;
  const api = await installPnlMocks(page, { forbidden: (path) => forbidden && path === "staff-costs" });
  await page.goto("/users/costs?periodKey=2026-09");
  await expect.poll(() => api.last("staff-costs")?.query.get("periodKey")).toBe("2026-09");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chi phí nhân sự theo tháng");
  await expect(page.getByRole("link", { name: "Quay lại Nhân sự" })).toHaveAttribute("href", "/users");
  const bar = page.getByRole("region", { name: "Thanh kỳ và tiến độ" });
  await expect(bar).toContainText("Giờ chuẩn tháng 176 giờ (22 ngày × 8) · Đã duyệt 1 · Nháp 0 · Chưa có 1");
  for (const name of ["Tải file mẫu", "Import Excel", "Duyệt bản nháp"]) await expect(page.getByRole("button", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Duyệt bản nháp" })).toBeDisabled(); // no Nháp row in the month
  for (const label of ["Tìm kiếm", "Tháng", "Trạng thái"]) await expect(bar.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(bar.getByText("Phòng ban", { exact: true })).toHaveCount(0); // one department only: nothing to choose
  await expect(bar.getByLabel("Tháng", { exact: true })).toContainText("Tháng 09/2026");

  const table = page.getByRole("region", { name: "Bảng chi phí" });
  const headers = table.getByRole("columnheader");
  await expect(headers).toHaveCount(13);
  await expect(headers.first()).toHaveText("Mã NS");
  await expect(headers.nth(1)).toHaveText("Nhân sự");
  await expect(headers.nth(6)).toHaveAttribute("title", /.+/); // six component columns, each titled with its full name
  await expect(headers).toContainText(["Tổng", "Đơn giá giờ", "Nguồn", "Trạng thái", "Thao tác"]);
  await expect(headers.nth(9)).toHaveAttribute("title", /cost rate/); // the payroll term stays findable
  const rowA = table.getByRole("row", { name: /Nhân sự A/ });
  await expect(rowA.getByRole("cell")).toContainText(["NS-001", "Nhân sự A", "20,00", "3,00", "0", "1,28", "0", "4,30", "28,58", "162.381", "Import Excel", "Đã duyệt"]);
  const rowB = table.getByRole("row", { name: /Nhân sự B/ });
  await expect(rowB).toContainText("Chưa gán mã");
  await expect(rowB).toContainText("105,5 giờ log trong tháng đang chờ chi phí tháng này");
  await expect(rowB).toContainText("Chưa có");
  await expect(table.getByRole("button", { name: "Nhập chi phí tháng của Nhân sự B" })).toBeVisible();

  // Filters narrow the month already loaded: by name or staff code, by status.
  const bodyRows = table.locator("tbody tr");
  await bar.getByLabel("Tìm nhân sự").fill("ns-001");
  await expect(bodyRows).toHaveText([/Nhân sự A/]);
  await bar.getByRole("button", { name: "Đặt lại (1)" }).click();
  await expect(bodyRows).toHaveCount(2);
  await bar.getByLabel("Trạng thái").click();
  await page.getByRole("option", { name: "Chưa có" }).click();
  await expect(bodyRows).toHaveText([/Nhân sự B/]);
  await page.keyboard.press("Escape");
  await bar.getByLabel("Tìm nhân sự").fill("nhân sự a");
  await expect(table).toContainText("Không có kết quả phù hợp bộ lọc.");
  await table.getByRole("button", { name: "Đặt lại bộ lọc" }).click();
  await expect(bodyRows).toHaveCount(2);

  await bar.getByRole("button", { name: "Tháng trước" }).click();
  await expect(page).toHaveURL(/\/users\/costs\?periodKey=2026-08$/);
  await expect.poll(() => api.last("staff-costs")?.query.get("periodKey")).toBe("2026-08");

  forbidden = true;
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Chỉ nhóm quyền chi phí xem và sửa chi phí nhân sự theo tháng." })).toContainText(FORBIDDEN_MESSAGE);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chi phí nhân sự theo tháng");
  await expect(page.getByRole("region", { name: "Bảng chi phí" })).toHaveCount(0);
});

test("/pnl/hours: scope from the link, full filter bar on the same URL parameters, plain reasons and what to do", async ({ page }) => {
  const api = await installPnlMocks(page);
  await page.goto("/pnl/hours?projectId=prj-a&periodKey=2026-09&group=cost_rate");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Giờ chờ xử lý");
  await expect(page.getByText("Giờ đã ghi nhưng chưa được tính vào P&L dự án vì còn thiếu một thông tin.")).toBeVisible();
  // A month link becomes the days of that month; the API narrows by status, days and kind of pending hour.
  await expect.poll(() => api.last("entries")?.query.toString()).toBe("status=pending&fromDay=2026-09-01&toDay=2026-09-30&group=cost_rate");
  await expect(page.getByRole("link", { name: "Quay lại P&L của Dự án A" })).toHaveAttribute("href", "/pnl/prj-a");
  await expect(page.getByRole("status").filter({ hasText: "dòng giờ" })).toHaveText("2 dòng giờ · 105,5 giờ · hạn xử lý 10 ngày làm việc kể từ khi ghi · chưa có dòng nào quá hạn");

  const help = page.getByRole("button", { name: "Cần làm gì với giờ chờ xử lý?" });
  await help.click();
  await expect(page.getByRole("listitem").filter({ hasText: "Chờ chi phí nhân sự tháng:" })).toContainText("nhập và duyệt chi phí nhân sự của tháng đó");
  await help.click();

  const filters = page.getByRole("region", { name: "Bộ lọc" });
  for (const label of ["Tìm kiếm", "Ngày ghi giờ", "Nhân sự", "Dự án", "Trạng thái", "Lý do chờ", "Nhóm việc cần làm"]) await expect(filters.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(filters.getByRole("button", { name: /^Ngày ghi giờ: / })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Đặt lại (3)" })).toBeVisible(); // project, days, kind

  const list = page.getByRole("region", { name: "Danh sách giờ, theo dự án và người" });
  await expect(list.getByRole("columnheader")).toHaveText(["Dự án · Task", "Nhân sự · Ngày ghi", "Giờ", "Trạng thái · Lý do", "Hạn · Người xử lý", "Việc cần làm"]);
  const rows = list.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByRole("cell")).toHaveText([/^Dự án A\s*Cấu hình Base bán hàng$/, /^Nhân sự B\s*03\/09\/2026$/, /^7,5\s*—$/, /^Chờ xử lý\s*Chưa có chi phí nhân sự tháng được duyệt$/, /^17\/09\/2026\s*PM-1$/, "Nhập / duyệt chi phí nhân sự ›"]);
  // The table fits its card: no sideways scroll inside the list.
  expect(await list.locator("table").evaluate((table) => table.scrollWidth <= (table.parentElement?.clientWidth ?? 0) + 1)).toBe(true);
  await expect(rows.first().getByLabel("Chưa có số: Chưa có chi phí nhân sự tháng được duyệt của tháng 09/2026")).toHaveText("—");
  await expect(rows.first().getByRole("link", { name: "Nhập / duyệt chi phí nhân sự ›" })).toHaveAttribute("href", "/users/costs?periodKey=2026-09");

  // Person, project, reason and text narrow the loaded list on the screen: the URL changes, the API query does not.
  await filters.getByLabel("Nhân sự", { exact: true }).click();
  await page.getByRole("option", { name: /Nhân sự B/ }).click();
  await expect(page).toHaveURL(/userId=usr-b/);
  await expect(page).toHaveURL(/fromDay=2026-09-01&toDay=2026-09-30/); // the month link is now written as days
  await expect(rows).toHaveCount(2);
  await page.keyboard.press("Escape");
  await filters.getByLabel("Tìm trong danh sách giờ").fill("không có task này");
  await expect(list).toContainText("Không có kết quả phù hợp bộ lọc.");
  expect(api.last("entries")?.query.toString()).toBe("status=pending&fromDay=2026-09-01&toDay=2026-09-30&group=cost_rate");
  await list.getByRole("button", { name: "Đặt lại bộ lọc" }).click();
  await expect(page).toHaveURL(/\/pnl\/hours$/);
  await expect(rows).toHaveCount(2);
  await expect.poll(() => api.last("entries")?.query.toString()).toBe("status=pending");
  await expect(page.getByRole("link", { name: "Quay lại P&L dự án" })).toHaveAttribute("href", "/pnl");

  // Status is asked from the API; several values go comma-joined.
  await filters.getByLabel("Trạng thái").click();
  await page.getByRole("option", { name: "Không tính vào P&L dự án" }).click();
  await expect.poll(() => api.last("entries")?.query.get("status")).toBe("pending,excluded");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Giờ đã ghi theo trạng thái P&L");

  // One status that is not "Chờ xử lý": its own title, no deadline / owner columns.
  await page.goto("/pnl/hours?status=excluded");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Giờ không tính vào P&L dự án");
  await expect.poll(() => api.last("entries")?.query.toString()).toBe("status=excluded");
  await expect(page.getByRole("link", { name: "Quay lại P&L dự án" })).toHaveAttribute("href", "/pnl");
  await expect(list.getByRole("columnheader")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Cần làm gì với giờ chờ xử lý?" })).toHaveCount(0);
});
