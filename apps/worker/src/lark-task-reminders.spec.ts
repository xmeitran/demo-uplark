import { afterEach, describe, expect, it, vi } from "vitest";
import { pmDeliveries, reminderPmUserIds, runTaskReminderSlot, taskReminderConfigFromEnv } from "./lark-task-reminders.js";
import { TASK_REMINDER_SCHEDULE, normalizeReminderSchedule, type PlanReminderIssue, type ReminderUserFacts } from "./task-reminder-rules.js";

describe("taskReminderConfigFromEnv", () => {
  it("stays inert without production secrets when disabled", () => {
    expect(taskReminderConfigFromEnv({})).toMatchObject({ enabled: false, webhookUrl: "", workspaceId: "" });
  });

  it("requires an official custom-bot webhook and an explicit workspace", () => {
    const base = {
      LARK_TASK_REMINDER_ENABLED: "true",
      LARK_TASK_REMINDER_WORKSPACE_ID: "twk-1",
      PUBLIC_APP_URL: "https://crm.example.com"
    };
    expect(() => taskReminderConfigFromEnv(base)).toThrow("LARK_TASK_REMINDER_WEBHOOK_URL is required");
    // Private messages need no group webhook.
    expect(taskReminderConfigFromEnv({ ...base, LARK_MESSAGING_ENABLED: "true", LARK_APP_ID: "cli_test", LARK_APP_SECRET: "s" })).toMatchObject({ enabled: true, webhookUrl: "", directMessage: { appId: "cli_test" } });
    expect(() => taskReminderConfigFromEnv({
      ...base,
      LARK_TASK_REMINDER_WEBHOOK_URL: "https://example.com/hook/secret"
    })).toThrow("official Lark/Feishu");
  });

  it("parses pilot users, PM mentions, excluded dates and the daily target", () => {
    const config = taskReminderConfigFromEnv({
      LARK_TASK_REMINDER_ENABLED: "true",
      LARK_TASK_REMINDER_WORKSPACE_ID: "twk-1",
      LARK_TASK_REMINDER_WEBHOOK_URL: "https://open.larksuite.com/open-apis/bot/v2/hook/example",
      PUBLIC_APP_URL: "https://crm.example.com/",
      LARK_TASK_REMINDER_USER_IDS: "usr-1, usr-2",
      LARK_TASK_REMINDER_PM_OPEN_IDS: "u-pm-1, u-pm-2",
      LARK_TASK_REMINDER_EXCLUDED_DATES: "2026-09-02, 2026-09-03",
      LARK_TASK_REMINDER_TARGET_MINUTES: "420"
    });
    expect(config).toMatchObject({
      enabled: true,
      workspaceId: "twk-1",
      publicAppUrl: "https://crm.example.com",
      targetMinutes: 420,
      pmOpenIds: ["u-pm-1", "u-pm-2"]
    });
    expect([...config.includedUserIds]).toEqual(["usr-1", "usr-2"]);
    expect([...config.excludedDates]).toEqual(["2026-09-02", "2026-09-03"]);
  });
});

describe("normalizeReminderSchedule (review 19/10: D1)", () => {
  it("every slot switched off sends nothing; no usable slot at all falls back to the defaults", () => {
    const off = [{ slot: "morning_plan", time: "08:30", enabled: false }, { slot: "pm_follow_up", time: "14:00", enabled: false }, { slot: "evening_actual", time: "17:00", enabled: false }];
    expect(normalizeReminderSchedule(off)).toEqual([]);
    expect(normalizeReminderSchedule([{ slot: "evening_actual", time: "17:30", enabled: true }, ...off.slice(0, 2)])).toEqual([{ slot: "evening_actual", minute: 17 * 60 + 30 }]);
    expect(normalizeReminderSchedule(undefined)).toBe(TASK_REMINDER_SCHEDULE);
    expect(normalizeReminderSchedule([{ slot: "bogus" }])).toBe(TASK_REMINDER_SCHEDULE);
  });
});

describe("pmDeliveries (Nhắc lại cho PM)", () => {
  const fact = (userId: string, projectPms: ReminderUserFacts["projectPms"]): ReminderUserFacts => ({ userId, displayName: userId, projectPms, tasks: [], planningBlocks: [], timeEntries: [] });
  const issue = (userId: string): PlanReminderIssue => ({ kind: "plan", userId, displayName: userId, hasPlan: false, taskFieldIssues: [] });
  const facts = [
    fact("dev-1", [{ userId: "pm-a", larkOpenId: "ou_a" }]),
    fact("dev-2", [{ userId: "pm-a", larkOpenId: "ou_a" }, { userId: "pm-b", larkOpenId: "ou_b" }]),
    fact("pm-a", [{ userId: "pm-a", larkOpenId: "ou_a" }]),
    fact("dev-3", [{ userId: "pm-c" }])
  ];
  const issues = ["dev-1", "dev-2", "pm-a", "dev-3"].map(issue);

  it("sends each project's PIC only the people of their projects, never themselves", () => {
    const deliveries = pmDeliveries({ pmOpenIds: [], directMessage: { appId: "a", appSecret: "s", baseUrl: "https://lark.test" } }, facts, issues);
    expect(deliveries.map((d) => [d.openId, d.mentionOpenIds, d.issues.map((i) => i.userId)])).toEqual([
      ["ou_a", ["ou_a"], ["dev-1", "dev-2"]],
      ["ou_b", ["ou_b"], ["dev-2"]]
    ]);
  });

  it("keeps the PMs set on the server: all issues, once per PM or once to the group", () => {
    const direct = pmDeliveries({ pmOpenIds: ["ou_x", "ou_y"], directMessage: { appId: "a", appSecret: "s", baseUrl: "https://lark.test" } }, facts, issues);
    expect(direct.map((d) => [d.openId, d.issues.length])).toEqual([["ou_x", 4], ["ou_y", 4]]);
    const group = pmDeliveries({ pmOpenIds: ["ou_x", "ou_y"] }, facts, issues);
    expect(group).toHaveLength(1);
    expect(group[0].mentionOpenIds).toEqual(["ou_x", "ou_y"]);
  });
});

describe("runTaskReminderSlot (sáng/chiều: mọi người · 14:00: PM)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = taskReminderConfigFromEnv({
    LARK_TASK_REMINDER_ENABLED: "true", LARK_TASK_REMINDER_WORKSPACE_ID: "twk-1", PUBLIC_APP_URL: "https://crm.example.com",
    LARK_MESSAGING_ENABLED: "true", LARK_APP_ID: "app-slots", LARK_APP_SECRET: "s", LARK_TASK_REMINDER_PM_OPEN_IDS: "ou_pm"
  });
  const member = { projectMembers: [{ project: { id: "p1", name: "Dự án A" } }] };
  const people = [
    { id: "u1", displayName: "An", identities: [{ providerUserId: "ou_1" }], ...member },
    { id: "u2", displayName: "Bình", identities: [{ providerUserId: "ou_2" }], ...member }
  ];
  const prisma = {
    tenantWorkspace: { findUnique: async () => ({ id: "twk-1", tenantKey: "t", status: "active" }) },
    user: { findMany: async (input: any) => people.filter((person) => input.where.projectMembers || input.where.id?.in?.includes(person.id)) },
    projectStage: { findMany: async () => [] },
    projectTask: { findMany: async () => [{ id: "t1", title: "Thiết kế", assigneeUserId: "u1", ownerUserId: null, plannedStartAt: null, dueAt: null, estimateMinutes: 240, project: { name: "Dự án A" } }] },
    taskPlanningBlock: { findMany: async () => [{ userId: "u1", taskId: "t1", plannedMinutes: 240, status: "planned" }] },
    taskTimeEntry: { findMany: async () => [] }
  } as any;
  const redis = () => {
    const store = new Map<string, string>();
    return { get: async (key: string) => store.get(key) ?? null, set: async (key: string, value: string) => { store.set(key, value); return "OK"; }, eval: async () => 0 };
  };
  const run = async (slot: "morning_plan" | "pm_follow_up" | "evening_actual", pmUserIds?: string[]) => {
    const messages: Array<{ to: string; text: string; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      if (url.includes("tenant_access_token")) return { ok: true, status: 200, json: async () => ({ code: 0, tenant_access_token: "t", expire: 7200 }) };
      const body = JSON.parse(init.body);
      const card = JSON.parse(body.content);
      messages.push({ to: body.receive_id, text: card.elements[0].text.content, url: card.elements.at(-1).actions[0].url });
      return { ok: true, status: 200, json: async () => ({ code: 0 }) };
    }));
    // Monday 2026-11-02, 14:00 in Vietnam.
    await runTaskReminderSlot({ prisma, redis: redis(), config, slot, pmUserIds, now: new Date("2026-11-02T07:00:00Z") });
    return messages;
  };

  it("morning asks everyone to plan today's hours, with what each already planned", async () => {
    const messages = await run("morning_plan");
    expect(messages.map((message) => message.to)).toEqual(["ou_1", "ou_2"]);
    expect(messages[0].text).toContain("Đã lập: 4 giờ kế hoạch");
    expect(messages[1].text).toContain("Bạn chưa lập kế hoạch Task cho hôm nay");
  });

  it("14:00 lists only the people with no plan, to the PMs, with the Gửi nhắc link", async () => {
    const messages = await run("pm_follow_up");
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe("ou_pm");
    expect(messages[0].text).toContain("Đến 14:00 ngày 2026-11-02, 1 người chưa lập kế hoạch ngày");
    expect(messages[0].text).toContain("**Bình**");
    expect(messages[0].text).not.toContain("**An**");
    expect(messages[0].url).toBe("https://crm.example.com/admin?nudge=unplanned&date=2026-11-02");
  });

  it("14:00 goes to the PMs picked in Admin instead of the server list", async () => {
    expect(reminderPmUserIds([{ slot: "morning_plan" }, { slot: "pm_follow_up", recipientUserIds: ["u1", 7, ""] }])).toEqual(["u1"]);
    expect((await run("pm_follow_up", ["u1"])).map((message) => message.to)).toEqual(["ou_1"]);
    expect(await run("pm_follow_up", ["u-no-lark"])).toEqual([]);
  });

  it("evening asks everyone to finish today's plan and lists the plans still open", async () => {
    const messages = await run("evening_actual");
    expect(messages.map((message) => message.to)).toEqual(["ou_1", "ou_2"]);
    expect(messages[0].text).toContain("Kế hoạch chưa hoàn tất:");
    expect(messages[0].text).toContain("**Thiết kế** · Dự án A — 4 giờ");
    expect(messages[1].text).toContain("Hôm nay bạn chưa có kế hoạch");
  });
});
