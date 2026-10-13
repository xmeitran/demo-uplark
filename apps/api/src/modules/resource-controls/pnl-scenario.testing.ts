/**
 * Test fixture: Phụ lục B1 of "Yêu cầu tab P&L – hệ thống PM" v2, 13/10/2026 (dự án mẫu Trí Mai Food – Quản lý cắt ngọn), loaded into
 * the in-memory database and read through the real services. Every number below is the document's.
 */
import type { PrincipalContext } from "@b2b-crm/contracts";
import { isWorkingDay } from "../../shared/working-days";
import { reportDayStart } from "./pnl-calc";
import { PnlConfigService } from "./pnl-config.service";
import { fakeDb } from "./pnl-fake-db.testing";
import { PnlService } from "./pnl.service";

export const WS = "ws-1";
export const HOLIDAYS = ["2026-09-02"];

export const founder: PrincipalContext = {
  subjectId: "u-admin", subjectType: "internal_user", displayName: "Admin chi phí", tenantKey: "prod", workspaceId: WS, workspaceKey: "default",
  roleCodes: ["FOUNDER_GM"], accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [], roleVersion: "r", grantVersion: "g"
} as unknown as PrincipalContext;
/** An Admin outside the cost permission group (PL-26). */
export const adminNoCost = { ...founder, subjectId: "u-dx-director", displayName: "Dx Director", roleCodes: ["DX_DIRECTOR", "WORKSPACE_ADMIN"] } as PrincipalContext;
export const plainUser = { ...founder, subjectId: "u-a", displayName: "Nhân sự A", roleCodes: ["DX", "WORKSPACE_USER"] } as PrincipalContext;

const USERS = [
  { id: "u-a", displayName: "Nhân sự A", role: "DX" },
  { id: "u-b", displayName: "Nhân sự B", role: "DX" },
  { id: "u-pm", displayName: "PM-1", role: "PM" },
  { id: "u-bd", displayName: "BD-1", role: "BD" },
  { id: "u-cs", displayName: "CS-1", role: "CS" }
];

export function scenario(options: { now?: string } = {}) {
  let entrySequence = 0;
  const db = fakeDb({
    user: USERS.map((user) => ({ id: user.id, displayName: user.displayName, email: `${user.id}@example.test`, subjectType: "INTERNAL_USER", status: "ACTIVE", departmentCode: "DX" })),
    role: ["DX", "PM", "BD", "CS"].map((code) => ({ id: `role-${code}`, code })),
    roleBinding: USERS.map((user) => ({ id: `rb-${user.id}`, userId: user.id, roleId: `role-${user.role}`, workspaceId: WS, endsAt: null })),
    account: [{ id: "acc-a", workspaceId: WS, name: "Khách A" }],
    workspaceDayOff: HOLIDAYS.map((dateKey) => ({ id: `off-${dateKey}`, workspaceId: WS, isActive: true, date: new Date(`${dateKey}T00:00:00.000Z`), name: "Quốc khánh" })),
    project: [{ id: "p-a", workspaceId: WS, code: "DA-A", name: "Dự án A", status: "active", projectType: "delivery", isTestProject: false, accountId: "acc-a", createdAt: new Date("2026-08-01T02:00:00.000Z") }],
    projectPnlRecord: [{ id: "ppr_p-a", workspaceId: WS, projectId: "p-a", overrideDisabledCodes: [], overrideEnabledCodes: [], projectValueAmount: 67_200_000, frozenDisabledCodes: [], frozenAt: null }],
    projectMember: [{ id: "pm-1", projectId: "p-a", userId: "u-pm", relation: "PM_OWNER", createdAt: new Date("2026-08-01T02:00:00.000Z") }],
    projectStage: [
      { id: "st-m1", projectId: "p-a", activity: "Validate", sortOrder: 10, taskTypeLayer1: "PRE_SALE", afterPnlClose: false, ownerUserId: "u-bd", plannedStartAt: new Date("2026-08-03T02:00:00.000Z"), plannedEndAt: new Date("2026-08-07T02:00:00.000Z") },
      { id: "st-m2", projectId: "p-a", activity: "Build", sortOrder: 20, taskTypeLayer1: "DELIVERY", afterPnlClose: false, ownerUserId: "u-pm", plannedStartAt: new Date("2026-08-10T02:00:00.000Z"), plannedEndAt: new Date("2026-10-30T02:00:00.000Z") },
      { id: "st-m4", projectId: "p-a", activity: "Handover", sortOrder: 40, taskTypeLayer1: "DELIVERY", afterPnlClose: true, ownerUserId: "u-cs", plannedStartAt: null, plannedEndAt: null }
    ],
    // Giá trị dự án 67.200.000 đ (on the P&L record above); chưa qua G7. No contract line items (chốt 13/10).
    projectGate: [
      { id: "g1", projectId: "p-a", code: "G1", status: "approved", decidedAt: new Date("2026-08-07T03:00:00.000Z") },
      { id: "g7", projectId: "p-a", code: "G7", status: "not_submitted", decidedAt: null }
    ],
    // Giờ kế hoạch 260 = 120 + 100 + 16 + 3 + 21 (chưa giao), all on lowest-level tasks.
    projectTask: [
      { id: "t-presale", workspaceId: WS, projectId: "p-a", stageId: "st-m1", parentTaskId: null, title: "Pre-sale", taskTypeLayer1: "PRE_SALE", estimateMinutes: 3 * 60, assigneeUserId: "u-bd" },
      { id: "t-pm", workspaceId: WS, projectId: "p-a", stageId: "st-m2", parentTaskId: null, title: "Quản lý dự án", taskTypeLayer1: "PM", estimateMinutes: 16 * 60, assigneeUserId: "u-pm" },
      { id: "t-build", workspaceId: WS, projectId: "p-a", stageId: "st-m2", parentTaskId: null, title: "Xây dựng", taskTypeLayer1: "DELIVERY", estimateMinutes: 0, assigneeUserId: null },
      { id: "t-build-a", workspaceId: WS, projectId: "p-a", stageId: null, parentTaskId: "t-build", title: "Xây dựng – A", taskTypeLayer1: "DELIVERY", estimateMinutes: 120 * 60, assigneeUserId: "u-a" },
      { id: "t-build-b", workspaceId: WS, projectId: "p-a", stageId: null, parentTaskId: "t-build", title: "Xây dựng – B", taskTypeLayer1: "DELIVERY", estimateMinutes: 100 * 60, assigneeUserId: "u-b" },
      { id: "t-build-x", workspaceId: WS, projectId: "p-a", stageId: null, parentTaskId: "t-build", title: "Xây dựng – chưa giao", taskTypeLayer1: "DELIVERY", estimateMinutes: 21 * 60, assigneeUserId: null },
      { id: "t-cr", workspaceId: WS, projectId: "p-a", stageId: "st-m2", parentTaskId: null, title: "Báo cáo bổ sung", taskTypeLayer1: "DELIVERY", estimateMinutes: 0, assigneeUserId: "u-a" },
      { id: "t-maint", workspaceId: WS, projectId: "p-a", stageId: "st-m4", parentTaskId: null, title: "Bảo trì", taskTypeLayer1: "DELIVERY", estimateMinutes: 0, assigneeUserId: "u-cs" }
    ],
    // Chi phí tháng đã duyệt. Nhân sự B: tháng 09 chưa có.
    resourceMonthlyCost: [
      staffCost("u-a", "2026-08", 25_200_000), staffCost("u-a", "2026-09", 27_280_000),
      staffCost("u-bd", "2026-08", 30_240_000),
      staffCost("u-pm", "2026-08", 33_600_000), staffCost("u-pm", "2026-09", 33_600_000)
    ],
    // Tỷ lệ hoa hồng 5% (nhập tay).
    pnlParameterValue: [
      { id: "pv-1", workspaceId: WS, key: "commissionPercent", subKey: null, scopeType: "company", scopeId: null, value: 5, effectiveFrom: "2026-08", reason: "dữ liệu mẫu", createdByName: "PM-1", createdAt: new Date("2026-08-01T00:00:00.000Z") }
    ],
    // Quỹ AI: tháng 08 đã chia cho dự án 1.260.000 đ và đã xác nhận; tháng 09 chưa chia.
    pnlFund: [{ id: "fund-ai", workspaceId: WS, code: "AI", name: "Công cụ AI", targetItemCode: "CP.FUNCOP.AI", criterion: "pnl_hours", eligibility: "billable_with_hours", eligibleProjectIds: [], active: true }],
    pnlFundPeriod: [
      { id: "fp-08", workspaceId: WS, fundId: "fund-ai", periodKey: "2026-08", amount: 1_260_000, sourceCurrency: "VND", sourceAmount: 1_260_000, exchangeRate: null, status: "allocated", confirmedAt: new Date("2026-09-03T00:00:00.000Z"), confirmedByName: "PM-1" },
      { id: "fp-09", workspaceId: WS, fundId: "fund-ai", periodKey: "2026-09", amount: 5_260_000, sourceCurrency: "USD", sourceAmount: 200, exchangeRate: 26_300, status: "unallocated", confirmedAt: null }
    ],
    pnlFundAllocation: [{ id: "fa-08", workspaceId: WS, fundPeriodId: "fp-08", projectId: "p-a", periodKey: "2026-08", itemCode: "CP.FUNCOP.AI", minutes: 139 * 60, amount: 1_260_000 }]
  });

  /** Logs `hours` for a person on a task, at most 8 giờ a day, from the first working day of the month (or on `dateKey`). */
  function log(input: { userId: string; taskId: string; month?: string; dateKey?: string; hours: number; selected?: string | null; taskLayer2?: string | null; projectId?: string; layer1?: string | null; createdAt?: string }) {
    const task = db.table("projectTask").find((row) => row.id === input.taskId) as Record<string, any>;
    const stage = db.table("projectStage").find((row) => row.id === (task.stageId ?? db.table("projectTask").find((parent) => parent.id === task.parentTaskId)?.stageId));
    const derived = input.taskLayer2 !== undefined ? input.taskLayer2 : stage?.afterPnlClose ? "TICKET_MAINTENANCE" : "CUSTOMER_PROJECT";
    const ids: string[] = [];
    let remaining = Math.round(input.hours * 60);
    const month = input.month ?? (input.dateKey as string).slice(0, 7);
    for (let day = input.dateKey ? Number(input.dateKey.slice(8)) : 1; remaining > 0 && day <= 31; day += 1) {
      const dateKey = `${month}-${String(day).padStart(2, "0")}`;
      if (!input.dateKey && !isWorkingDay(dateKey, new Set(HOLIDAYS))) continue;
      const minutes = Math.min(remaining, 480);
      remaining -= minutes;
      const id = `te-${++entrySequence}`;
      ids.push(id);
      db.table("taskTimeEntry").push({
        id, workspaceId: WS, projectId: input.projectId ?? task.projectId, taskId: task.id, userId: input.userId, minutes, workDate: reportDayStart(dateKey), createdAt: new Date(input.createdAt ?? `${dateKey}T10:00:00.000Z`),
        approvalStatus: "approved", taskTypeLayer1: input.layer1 !== undefined ? input.layer1 : task.taskTypeLayer1, taskTypeLayer2: derived, selectedTaskTypeLayer2: input.selected !== undefined ? input.selected : derived,
        contractItemId: null, legacyConvertedAt: null, legacyPendingReason: null
      });
    }
    return ids;
  }

  // Giờ log tháng 08: Nhân sự A 128 giờ; BD-1 3 giờ (task Pre-sale); PM-1 8 giờ (task PM).
  log({ userId: "u-a", taskId: "t-build-a", month: "2026-08", hours: 128 });
  log({ userId: "u-bd", taskId: "t-presale", month: "2026-08", hours: 3 });
  log({ userId: "u-pm", taskId: "t-pm", month: "2026-08", hours: 8 });
  // Giờ log tháng 09: Nhân sự A 21 giờ; Nhân sự B 105,5 giờ; PM-1 8 giờ.
  log({ userId: "u-a", taskId: "t-build-a", month: "2026-09", hours: 21 });
  log({ userId: "u-b", taskId: "t-build-b", month: "2026-09", hours: 105.5 });
  log({ userId: "u-pm", taskId: "t-pm", month: "2026-09", hours: 8 });

  const pnl = new PnlService(db as any);
  let now = new Date(options.now ?? "2026-10-12T03:00:00.000Z");
  pnl.now = () => now;
  const config = new PnlConfigService(db as any, pnl);
  return {
    db, pnl, config, log,
    setNow(value: string) { now = new Date(value); },
    /** Hồ sơ nhân sự › Chi phí theo tháng: nhập (Nháp) rồi duyệt, through the real services. */
    async approveCost(userId: string, periodKey: string, totalAmount: number) {
      await config.setStaffCost({ userId, periodKey, baseSalaryAmount: totalAmount }, founder);
      await config.approveStaffCosts({ periodKey, userIds: [userId] }, founder);
    },
    /** Khách ký biên bản, G7 được duyệt. */
    approveG7(dateKey: string, projectId = "p-a") {
      const gate = db.table("projectGate").find((row) => row.projectId === projectId && row.code === "G7") as Record<string, any>;
      Object.assign(gate, { status: "approved", decidedAt: new Date(`${dateKey}T03:00:00.000Z`) });
    },
    project: (query: Record<string, unknown> = {}, projectId = "p-a") => pnl.project(projectId, query, founder).then((response) => response.data)
  };
}

export function staffCost(userId: string, periodKey: string, totalAmount: number, status = "APPROVED") {
  return { id: `rmc-${userId}-${periodKey}`, workspaceId: WS, userId, periodKey, totalMonthlyIncome: totalAmount, p1BaseAmount: totalAmount, p2AllowanceAmount: 0, p3PerformanceAmount: 0, p4OtherVariableAmount: 0, overtimeAmount: 0, socialInsuranceAmount: 0, status, source: "manual", updatedAt: new Date("2026-09-05T00:00:00.000Z") };
}

export const hours = (value: number) => Math.round(value * 60);
