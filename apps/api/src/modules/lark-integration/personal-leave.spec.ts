import { describe, expect, it, vi } from "vitest";
import { ProjectsService } from "../delivery-handoff/projects.service";
import type { LarkRequest } from "./lark-client";
import { approvedPersonalLeaveMinutes, leaveMinutesOn, parseLeaveInstance, syncPersonalLeave, userIdsOnFullDayLeave } from "./personal-leave";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const leaveForm = (start: string, end: string, name = "Nghỉ phép năm") => JSON.stringify([{ id: "w1", type: "input", value: "Việc riêng" }, { id: "w2", type: "leaveGroupV2", value: { name, start, end, interval: 1, unit: "DAY" } }]);

describe("personal leave minutes (D-09 reduces the D-13 cap)", () => {
  const full = { startDate: day("2026-10-12"), endDate: day("2026-10-14"), status: "approved" };
  it("a full day of leave takes the whole standard day; days outside the range take nothing", () => {
    expect(leaveMinutesOn([full], "2026-10-13")).toBe(480);
    expect(leaveMinutesOn([full], "2026-10-15")).toBe(0);
    expect(leaveMinutesOn([{ ...full, status: "cancelled" }], "2026-10-13")).toBe(0);
  });

  it("a half day takes half of the standard day, on the first or the last day only", () => {
    const range = { startDate: day("2026-10-12"), endDate: day("2026-10-14"), startHalfDay: true, endHalfDay: true };
    expect(leaveMinutesOn([range], "2026-10-12")).toBe(240);
    expect(leaveMinutesOn([range], "2026-10-13")).toBe(480);
    expect(leaveMinutesOn([range], "2026-10-14")).toBe(240);
    expect(leaveMinutesOn([range], "2026-10-12", 420)).toBe(210);
  });

  it("two half days on one date are a full day, never more", () => {
    const morning = { startDate: day("2026-10-12"), endDate: day("2026-10-12"), endHalfDay: true };
    const afternoon = { startDate: day("2026-10-12"), endDate: day("2026-10-12"), startHalfDay: true };
    expect(leaveMinutesOn([morning, afternoon, afternoon], "2026-10-12")).toBe(480);
  });

  it("reads the person's approved rows; without the table nobody has leave", async () => {
    const findMany = vi.fn(async () => [{ startDate: day("2026-10-12"), endDate: day("2026-10-12"), startHalfDay: false, endHalfDay: true }]);
    expect(await approvedPersonalLeaveMinutes({ personalLeave: { findMany } }, "ws", "usr-1", "2026-10-12")).toBe(240);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "ws", userId: "usr-1", status: "approved", startDate: { lte: day("2026-10-12") }, endDate: { gte: day("2026-10-12") } } }));
    expect(await approvedPersonalLeaveMinutes({}, "ws", "usr-1", "2026-10-12")).toBe(0);
  });

  it("time-log rule: a full day of leave leaves no minutes to log, half a day leaves half of the 8-hour cap", async () => {
    const service = new ProjectsService({} as any) as any;
    const client = (rows: unknown[]) => ({ personalLeave: { findMany: async () => rows } });
    expect(await service.standardDayCapMinutes(client([]), "ws", "usr-1", "2026-10-12")).toBe(480);
    expect(await service.standardDayCapMinutes(client([{ startDate: day("2026-10-12"), endDate: day("2026-10-12") }]), "ws", "usr-1", "2026-10-12")).toBe(0);
    expect(await service.standardDayCapMinutes(client([{ startDate: day("2026-10-12"), endDate: day("2026-10-12"), startHalfDay: true }]), "ws", "usr-1", "2026-10-12")).toBe(240);
  });

  it("only a full day off silences the missing-log reminder", async () => {
    const rows = [
      { userId: "full", startDate: day("2026-10-12"), endDate: day("2026-10-12") },
      { userId: "half", startDate: day("2026-10-12"), endDate: day("2026-10-12"), endHalfDay: true }
    ];
    expect([...(await userIdsOnFullDayLeave({ personalLeave: { findMany: async () => rows } }, "ws", "2026-10-12"))]).toEqual(["full"]);
  });
});

describe("parseLeaveInstance", () => {
  const instance = (start: string, end: string) => ({ instance_code: "INST-1", status: "APPROVED", open_id: "ou_1", form: leaveForm(start, end) });
  it("turns the leave widget into Vietnam dates", () => {
    expect(parseLeaveInstance(instance("2026-10-12T00:00:00+07:00", "2026-10-14T00:00:00+07:00"))).toMatchObject({ instanceCode: "INST-1", status: "APPROVED", openId: "ou_1", leaveType: "Nghỉ phép năm", startDate: "2026-10-12", endDate: "2026-10-13", startHalfDay: false, endHalfDay: false });
    expect(parseLeaveInstance(instance("2026-10-12T08:30:00+07:00", "2026-10-12T17:30:00+07:00"))).toMatchObject({ startDate: "2026-10-12", endDate: "2026-10-12", startHalfDay: false, endHalfDay: false });
  });

  it("reads half days from the clock times", () => {
    expect(parseLeaveInstance(instance("2026-10-12T00:00:00+07:00", "2026-10-12T12:00:00+07:00"))).toMatchObject({ startDate: "2026-10-12", endDate: "2026-10-12", startHalfDay: false, endHalfDay: true });
    expect(parseLeaveInstance(instance("2026-10-12T13:30:00+07:00", "2026-10-12T17:30:00+07:00"))).toMatchObject({ startHalfDay: true, endHalfDay: false });
    expect(parseLeaveInstance(instance("2026-10-12T12:00:00+07:00", "2026-10-14T12:00:00+07:00"))).toMatchObject({ startDate: "2026-10-12", endDate: "2026-10-14", startHalfDay: true, endHalfDay: true });
  });

  it("returns null without a usable leave widget", () => {
    expect(parseLeaveInstance({ instance_code: "X", status: "APPROVED", form: "[]" })).toBeNull();
    expect(parseLeaveInstance({ instance_code: "X", status: "APPROVED", form: "not json" })).toBeNull();
    expect(parseLeaveInstance(instance("2026-10-14T00:00:00+07:00", "2026-10-12T00:00:00+07:00"))).toBeNull();
  });
});

describe("syncPersonalLeave", () => {
  function setup(instances: Record<string, any>, listStatus: "sent" | "disabled" | "failed" = "sent") {
    const leaves: any[] = [{ id: "old", workspaceId: "ws", sourceInstanceId: "INST-WITHDRAWN", userId: "usr-1", status: "approved" }];
    const prisma = {
      tenantWorkspace: { findUnique: async () => ({ tenantKey: "tenant" }) },
      portalIdentity: { findFirst: async ({ where }: any) => (where.OR.some((item: any) => item.providerUserId === "ou_1") ? { userId: "usr-1" } : null) },
      personalLeave: {
        upsert: vi.fn(async ({ where, create, update }: any) => {
          const existing = leaves.find((row) => row.sourceInstanceId === where.workspaceId_sourceInstanceId.sourceInstanceId);
          if (existing) Object.assign(existing, update); else leaves.push({ ...create });
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const rows = leaves.filter((row) => row.sourceInstanceId === where.sourceInstanceId && row.status === where.status);
          rows.forEach((row) => Object.assign(row, data));
          return { count: rows.length };
        })
      }
    };
    const records: any[] = [];
    const lark = {
      call: vi.fn(async (request: LarkRequest) => {
        if (request.action === "list_approval_instances") return listStatus === "sent" ? { status: "sent" as const, detail: "", data: { instance_code_list: Object.keys(instances), has_more: false } } : { status: listStatus, detail: listStatus === "disabled" ? "chưa bật kênh Lark" : "Lark lỗi: no permission" };
        return { status: "sent" as const, detail: "", data: instances[request.path.split("/").at(-1)!] };
      }),
      record: vi.fn(async (entry: any) => { records.push(entry); }),
      alreadyHandled: async () => false
    };
    return { prisma, lark, leaves, records };
  }
  const now = new Date("2026-10-12T03:00:00.000Z");

  it("upserts approved leave by instance code, cancels withdrawn ones and counts unmatched people", async () => {
    const { prisma, lark, leaves, records } = setup({
      "INST-1": { status: "APPROVED", open_id: "ou_1", form: leaveForm("2026-10-13T00:00:00+07:00", "2026-10-13T12:00:00+07:00") },
      "INST-PENDING": { status: "PENDING", open_id: "ou_1", form: leaveForm("2026-10-20T00:00:00+07:00", "2026-10-21T00:00:00+07:00") },
      "INST-WITHDRAWN": { status: "CANCELED", open_id: "ou_1", form: leaveForm("2026-10-15T00:00:00+07:00", "2026-10-16T00:00:00+07:00") },
      "INST-STRANGER": { status: "APPROVED", open_id: "ou_unknown", form: leaveForm("2026-10-15T00:00:00+07:00", "2026-10-16T00:00:00+07:00") }
    });
    const result = await syncPersonalLeave(prisma, lark, "ws", { approvalCode: "LEAVE-CODE", now });
    expect(result).toMatchObject({ status: "sent", read: 4, upserted: 1, cancelled: 1, unmatched: 1 });
    expect(leaves.find((row) => row.sourceInstanceId === "INST-1")).toMatchObject({ workspaceId: "ws", userId: "usr-1", source: "lark_approval", status: "approved", startDate: day("2026-10-13"), endDate: day("2026-10-13"), startHalfDay: false, endHalfDay: true, leaveType: "Nghỉ phép năm", syncedAt: now });
    expect(leaves.find((row) => row.sourceInstanceId === "INST-WITHDRAWN")).toMatchObject({ status: "cancelled" });
    expect(leaves).toHaveLength(2);
    expect(records.at(-1)).toMatchObject({ action: "leave_sync", status: "sent", workspaceId: "ws" });

    // Second run: same instance, changed dates → the row is updated, not duplicated.
    const again = setup({ "INST-1": { status: "APPROVED", open_id: "ou_1", form: leaveForm("2026-10-13T00:00:00+07:00", "2026-10-15T00:00:00+07:00") } });
    again.leaves.push({ workspaceId: "ws", sourceInstanceId: "INST-1", userId: "usr-1", status: "approved", startDate: day("2026-10-13"), endDate: day("2026-10-13"), endHalfDay: true });
    await syncPersonalLeave(again.prisma, again.lark, "ws", { approvalCode: "LEAVE-CODE", now });
    expect(again.leaves.filter((row) => row.sourceInstanceId === "INST-1")).toEqual([expect.objectContaining({ endDate: day("2026-10-14"), endHalfDay: false })]);
  });

  it("records why nothing was read: no approval code, channel disabled, Lark error", async () => {
    const none = setup({});
    expect(await syncPersonalLeave(none.prisma, none.lark, "ws", { now })).toMatchObject({ status: "disabled", detail: expect.stringContaining("LARK_LEAVE_APPROVAL_CODE") });
    expect(none.lark.call).not.toHaveBeenCalled();
    const disabled = setup({}, "disabled");
    expect(await syncPersonalLeave(disabled.prisma, disabled.lark, "ws", { approvalCode: "LEAVE", now })).toMatchObject({ status: "disabled", detail: "chưa bật kênh Lark", upserted: 0 });
    const failed = setup({}, "failed");
    expect(await syncPersonalLeave(failed.prisma, failed.lark, "ws", { approvalCode: "LEAVE", now })).toMatchObject({ status: "failed", detail: "Lark lỗi: no permission" });
    expect(failed.records.at(-1)).toMatchObject({ action: "leave_sync", status: "failed" });
  });
});
