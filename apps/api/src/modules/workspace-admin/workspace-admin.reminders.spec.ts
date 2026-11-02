import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAdminService } from "./workspace-admin.service";

const admin = { subjectId: "pm", subjectType: "internal_user", workspaceId: "w1", tenantKey: "t", roleCodes: ["WORKSPACE_ADMIN"] } as any;
const person = (id: string, name: string) => ({ id, displayName: name, email: `${id}@example.com`, identities: [{ id: `i-${id}`, provider: "lark", providerUserId: `ou_${id}` }] });

function setup(nudgedToday: string[] = []) {
  const createMany = vi.fn().mockResolvedValue({ count: 0 });
  const none = { findMany: vi.fn().mockResolvedValue([]) };
  const prisma = {
    tenantWorkspace: { findUnique: vi.fn().mockResolvedValue({ tenantKey: "t" }) },
    workspaceDayOff: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue([person("u1", "An"), person("u2", "Bình"), person("u3", "Chi")]) },
    projectTask: none,
    taskPlanningBlock: { findMany: vi.fn().mockResolvedValue([{ userId: "u1", taskId: "t1", plannedMinutes: 240 }]) },
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

  it("refuses unknown or locked people and recipients on another slot", async () => {
    await expect(policySetup(1).service.updateReminderPolicy({ slots: slots(["pm-1", "gone"]) }, admin)).rejects.toThrow("không tồn tại hoặc đã bị khóa");
    const morningWithRecipients = slots().map((slot) => slot.slot === "morning_plan" ? { ...slot, recipientUserIds: ["pm-1"] } : slot);
    await expect(policySetup(1).service.updateReminderPolicy({ slots: morningWithRecipients }, admin)).rejects.toThrow("Nhắc lại cho PM");
  });
});
