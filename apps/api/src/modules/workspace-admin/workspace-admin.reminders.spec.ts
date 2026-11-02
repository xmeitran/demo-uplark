import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAdminService } from "./workspace-admin.service";

const admin = { subjectId: "pm", subjectType: "internal_user", workspaceId: "w1", tenantKey: "t", roleCodes: ["WORKSPACE_ADMIN"] } as any;
const person = (id: string, name: string, departmentCode: string | null = null) => ({ id, displayName: name, email: `${id}@example.com`, departmentCode, resourceProfile: null, roleBindings: [], identities: [{ id: `i-${id}`, provider: "lark", providerUserId: `ou_${id}` }] });
const pmSlot = (recipientUserIds: string[]) => [{ slot: "pm_follow_up", time: "14:00", enabled: true, recipientUserIds }];

function setup(nudgedToday: string[] = [], policy: { excludedUserIds?: string[]; slots?: unknown } | null = null) {
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const none = { findMany: vi.fn().mockResolvedValue([]) };
  const prisma = {
    tenantWorkspace: { findUnique: vi.fn().mockResolvedValue({ tenantKey: "t" }) },
    workspaceDayOff: { findFirst: vi.fn().mockResolvedValue(null) },
    // The staff in scope, then (for "Nhắc lại cho PM") the PMs picked in the schedule.
    user: { findMany: vi.fn(async (query: any) => query.where.id?.in ? [person("pm", "Sao Mai")] : [person("u1", "An"), person("u2", "Bình", "CDS_DX_ENABLER"), person("u3", "Chi")]) },
    workspaceReminderPolicy: { findUnique: vi.fn().mockResolvedValue(policy && { enabled: true, timezone: "Asia/Ho_Chi_Minh", weekdaysOnly: true, slots: policy.slots ?? [], excludedUserIds: policy.excludedUserIds ?? [] }) },
    projectTask: none,
    taskPlanningBlock: { findMany: vi.fn().mockResolvedValue([{ userId: "u1", taskId: "t1", plannedMinutes: 240, status: "planned", task: { title: "Thiết kế", project: { name: "Dự án A" } } }]) },
    taskTimeEntry: none,
    reminderDeliveryLog: { findMany: vi.fn().mockResolvedValue(nudgedToday.map((userId) => ({ userId }))), createMany }
  };
  const sentTo: string[] = [];
  const cards: any[] = [];
  vi.stubEnv("LARK_APP_ID", "cli_test");
  vi.stubEnv("LARK_APP_SECRET", "s");
  vi.stubEnv("LARK_REMINDER_LINK_URL", "https://lark-upbase.mindtheoperation.com/projects");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    if (url.includes("tenant_access_token")) return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "t" }) };
    if (url.includes("batch_get_id")) return { ok: true, status: 200, json: async () => ({ code: 0, data: { user_list: [{ email: body.emails[0], user_id: `ou_${body.emails[0].split("@")[0]}` }] } }) };
    sentTo.push(body.receive_id);
    cards.push(JSON.parse(body.content));
    return { ok: true, status: 200, json: async () => ({ code: 0 }) };
  }));
  return { service: new (WorkspaceAdminService as any)(prisma) as WorkspaceAdminService, createMany, sentTo, cards };
}

describe("WorkspaceAdminService.sendReminder unplannedOnly (Gửi nhắc on the 14:00 PM card)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("privately reminds only the people with no plan that day, and logs them as manual_unplanned", async () => {
    const { service, createMany, sentTo, cards } = setup();
    const result = await service.sendReminder({ localDate: "2026-11-02", slot: "morning_plan", unplannedOnly: true }, { ...admin, displayName: "Sao Mai" });
    expect(sentTo).toEqual(["ou_u2", "ou_u3"]);
    expect(cards[0].header.title.content).toBe("Nhắc lần 2: lập kế hoạch Task hôm nay");
    expect(cards[0].elements[0].text.content).toContain("Chào **Bình**,");
    expect(cards[0].elements[0].text.content).toContain("Thứ Hai, 02/11/2026, bạn vẫn chưa lập kế hoạch Task cho hôm nay. Đây là lần nhắc thứ 2.");
    expect(cards[0].elements[2].elements[0].content).toBe("Gửi theo yêu cầu của PM Sao Mai.");
    expect(cards[0].elements[3].actions[0].url).toBe("https://lark-upbase.mindtheoperation.com/projects");
    expect(cards[0].elements[0].text.content).not.toContain("Dự án đang tham gia");
    expect(result.data.recipientNames).toEqual(["Bình", "Chi"]);
    expect(createMany.mock.calls[0][0].data.map((row: any) => [row.userId, row.missingType])).toEqual([["u2", "manual_unplanned"], ["u3", "manual_unplanned"]]);
  });

  it("skips people already reminded through the button today, and says so when nobody is left", async () => {
    const { service, sentTo } = setup(["u3"]);
    await service.sendReminder({ localDate: "2026-11-02", slot: "morning_plan", unplannedOnly: true }, admin);
    expect(sentTo).toEqual(["ou_u2"]);
    const again = setup(["u2", "u3"]);
    await expect(again.service.sendReminder({ localDate: "2026-11-02", slot: "morning_plan", unplannedOnly: true }, admin)).rejects.toThrow("Không còn ai cần nhắc");
    expect(again.sentTo).toEqual([]);
  });

  it("only goes with the morning slot", async () => {
    const { service } = setup();
    await expect(service.sendReminder({ localDate: "2026-11-02", slot: "evening_actual", unplannedOnly: true }, admin)).rejects.toThrow("Kế hoạch đầu ngày");
  });
});

describe("WorkspaceAdminService.sendReminder (Gửi nhắc Lark thủ công: same cards as the schedule, private messages)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("Kế hoạch đầu ngày goes to everyone in scope except the people switched off", async () => {
    const { service, sentTo, cards } = setup([], { excludedUserIds: ["u3"] });
    await service.sendReminder({ localDate: "2026-11-02", slot: "morning_plan" }, admin);
    expect(sentTo).toEqual(["ou_u1", "ou_u2"]);
    expect(cards.map((card) => card.header.title.content)).toEqual(["Lập kế hoạch Task hôm nay", "Lập kế hoạch Task hôm nay"]);
    expect(cards[1].elements[0].text.content).toContain("Chào **Bình**,");
  });

  it("Giờ thực tế cuối ngày: finish the planned Tasks, or plan and finish when there is no plan", async () => {
    const { service, cards } = setup();
    await service.sendReminder({ localDate: "2026-11-02", slot: "evening_actual" }, admin);
    expect(cards.map((card) => card.header.title.content)).toEqual(["Hoàn thành Task hôm nay", "Yêu cầu lập kế hoạch và hoàn thành Task hôm nay", "Yêu cầu lập kế hoạch và hoàn thành Task hôm nay"]);
    expect(cards[0].elements[0].text.content).toContain("1. **Thiết kế**\n    Dự án: Dự án A · Kế hoạch: 4 giờ · **Chưa hoàn thành**");
  });

  it("Nhắc lại cho PM sends the name-and-role list of people with no plan to the picked PMs", async () => {
    const { service, sentTo, cards } = setup([], { slots: pmSlot(["pm"]) });
    const result = await service.sendReminder({ localDate: "2026-11-02", slot: "pm_follow_up" }, admin);
    expect(sentTo).toEqual(["ou_pm"]);
    expect(result.data.recipientNames).toEqual(["Sao Mai"]);
    expect(cards[0].elements[0].text.content).toContain("1. **Bình** · DX enabler\n2. **Chi** · Chưa gán vai trò");
    expect(cards[0].elements[3].actions[0].text.content).toBe("Gửi nhắc lần 2");
  });

  it("Nhắc lại cho PM without picked PMs says so", async () => {
    await expect(setup().service.sendReminder({ localDate: "2026-11-02", slot: "pm_follow_up" }, admin)).rejects.toThrow("Chưa chọn người nhận");
  });
});

describe("WorkspaceAdminService.updateReminderPolicy PM recipients (Nhắc lại cho PM › Người nhận)", () => {
  const slots = (recipientUserIds?: string[]) => [
    { slot: "morning_plan" as const, time: "09:05", enabled: true },
    { slot: "pm_follow_up" as const, time: "14:00", enabled: true, ...(recipientUserIds ? { recipientUserIds } : {}) },
    { slot: "evening_actual" as const, time: "17:00", enabled: true }
  ];
  function policySetup(activeUsers: number) {
    const upsert = vi.fn(async (input: any) => ({ ...input.update, timezone: "Asia/Ho_Chi_Minh", id: "wrp_1" }));
    const prisma = { user: { count: vi.fn().mockResolvedValue(activeUsers) }, workspaceReminderPolicy: { upsert }, auditEvent: { create: vi.fn() } };
    return { service: new (WorkspaceAdminService as any)(prisma) as WorkspaceAdminService, upsert };
  }

  it("stores and returns the picked PMs on the PM slot only", async () => {
    const { service, upsert } = policySetup(2);
    const result = await service.updateReminderPolicy({ slots: slots(["pm-1", "pm-2", "pm-1"]) }, admin);
    expect(upsert.mock.calls[0][0].update.slots[1].recipientUserIds).toEqual(["pm-1", "pm-2"]);
    expect(result.data.slots.map((slot) => slot.recipientUserIds)).toEqual([undefined, ["pm-1", "pm-2"], undefined]);
  });

  it("stores the people switched off in Danh sách người nhận, and keeps the list when it is not sent", async () => {
    const { service, upsert } = policySetup(0);
    const result = await service.updateReminderPolicy({ slots: slots(), excludedUserIds: ["u9", "u9", "u7"] }, admin);
    expect(upsert.mock.calls[0][0].update.excludedUserIds).toEqual(["u9", "u7"]);
    expect(result.data.excludedUserIds).toEqual(["u9", "u7"]);
    await service.updateReminderPolicy({ slots: slots() }, admin);
    expect(upsert.mock.calls[1][0].update).not.toHaveProperty("excludedUserIds");
  });

  it("refuses unknown or locked people and recipients on another slot", async () => {
    await expect(policySetup(1).service.updateReminderPolicy({ slots: slots(["pm-1", "gone"]) }, admin)).rejects.toThrow("không tồn tại hoặc đã bị khóa");
    const morningWithRecipients = slots().map((slot) => slot.slot === "morning_plan" ? { ...slot, recipientUserIds: ["pm-1"] } : slot);
    await expect(policySetup(1).service.updateReminderPolicy({ slots: morningWithRecipients }, admin)).rejects.toThrow("Nhắc lại cho PM");
  });
});
