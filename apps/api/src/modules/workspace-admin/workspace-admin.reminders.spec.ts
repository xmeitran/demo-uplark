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
  vi.stubEnv("LARK_APP_ID", "cli_test");
  vi.stubEnv("LARK_APP_SECRET", "s");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    if (url.includes("tenant_access_token")) return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "t" }) };
    if (url.includes("batch_get_id")) return { ok: true, status: 200, json: async () => ({ code: 0, data: { user_list: [{ email: body.emails[0], user_id: `ou_${body.emails[0].split("@")[0]}` }] } }) };
    sentTo.push(body.receive_id);
    return { ok: true, status: 200, json: async () => ({ code: 0 }) };
  }));
  return { service: new (WorkspaceAdminService as any)(prisma) as WorkspaceAdminService, createMany, sentTo };
}

describe("WorkspaceAdminService.sendReminder unplannedOnly (Gửi nhắc on the 14:00 PM card)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("privately reminds only the people with no plan that day, and logs them as manual_unplanned", async () => {
    const { service, createMany, sentTo } = setup();
    const result = await service.sendReminder({ localDate: "2026-11-02", slot: "morning_plan", unplannedOnly: true }, admin);
    expect(sentTo).toEqual(["ou_u2", "ou_u3"]);
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
