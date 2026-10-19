import { describe, expect, it } from "vitest";
import { taskReminderConfigFromEnv } from "./lark-task-reminders.js";
import { TASK_REMINDER_SCHEDULE, normalizeReminderSchedule } from "./task-reminder-rules.js";

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
