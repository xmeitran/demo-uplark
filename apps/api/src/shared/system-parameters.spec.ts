import { describe, expect, it } from "vitest";
import { ALERT_TRIGGERS, resolveAlertTriggers, validateAlertTriggerOverride } from "@b2b-crm/contracts";
import { SYSTEM_PARAMETERS, SYSTEM_PARAMETER_KEYS, getParameter, getStoredParameter, loadParameters, standardDayMinutes, systemParameterDefaults, validateSystemParameter } from "./system-parameters";

describe("7.6 parameter catalogue", () => {
  it("carries every parameter of the document with its default", () => {
    expect(systemParameterDefaults()).toEqual({
      standardDayHours: 8,
      hoursUsedThresholdPercent: 80,
      progressGapPoints: 10,
      progressMeasure: "completed_subtask_estimate",
      plannedNoLogWorkingDays: 2,
      customerResponseWorkingDays: 3,
      customerResponseG4WorkingDays: 1,
      customerReminderMaxCount: 2,
      handoffReviewWorkingHours: 24,
      statusProposalConfirmWorkingDays: 2,
      stageExtensionAbnormalCount: 2,
      newRequestClassifyWorkingDays: 1,
      pendingHoursWorkingDays: 10,
      reminderTimes: ["08:30", "14:00", "17:00"],
      pnlCloseGate: "G7",
      effectiveDate: null
    });
    for (const key of SYSTEM_PARAMETER_KEYS) {
      expect(SYSTEM_PARAMETERS[key].label).toBeTruthy();
      expect(validateSystemParameter(key, SYSTEM_PARAMETERS[key].defaultValue)).toEqual(SYSTEM_PARAMETERS[key].defaultValue);
    }
    expect(standardDayMinutes()).toBe(480);
  });

  it("validates each kind of value", () => {
    expect(validateSystemParameter("standardDayHours", "7.5")).toBe(7.5);
    expect(() => validateSystemParameter("standardDayHours", 0)).toThrow();
    expect(() => validateSystemParameter("standardDayHours", 25)).toThrow();
    expect(() => validateSystemParameter("pendingHoursWorkingDays", 2.5)).toThrow("số nguyên");
    expect(() => validateSystemParameter("hoursUsedThresholdPercent", "abc")).toThrow();
    expect(() => validateSystemParameter("pnlCloseGate", "G3")).toThrow();
    expect(validateSystemParameter("reminderTimes", ["17:00", "08:00", "13:30"])).toEqual(["08:00", "13:30", "17:00"]);
    expect(() => validateSystemParameter("reminderTimes", ["08:00", "25:00", "17:00"])).toThrow();
    expect(() => validateSystemParameter("reminderTimes", ["08:00", "17:00"])).toThrow("đúng 3");
    expect(() => validateSystemParameter("reminderTimes", ["08:00", "08:00", "17:00"])).toThrow();
    expect(validateSystemParameter("effectiveDate", "2026-11-01")).toBe("2026-11-01");
    expect(validateSystemParameter("effectiveDate", "")).toBeNull();
    expect(() => validateSystemParameter("effectiveDate", "01/11/2026")).toThrow();
    // Retired on 13/10 with the change-request flow: no longer a parameter.
    expect(() => validateSystemParameter("changeRequestStepSlaDays" as never, {})).toThrow();
    expect(() => validateSystemParameter("nope" as never, 1)).toThrow();
  });

  it("reads defaults synchronously and stored values through the client", async () => {
    expect(getParameter("hoursUsedThresholdPercent")).toBe(80);
    expect(getParameter("hoursUsedThresholdPercent", { hoursUsedThresholdPercent: 90 })).toBe(90);
    // No parameter table (a unit-test mock): every value is its default.
    expect(await loadParameters({}, "w1")).toEqual(systemParameterDefaults());
    const rows = [
      { key: "hoursUsedThresholdPercent", value: 90, createdAt: new Date() },
      { key: "progressGapPoints", value: null, createdAt: new Date() }, // reset to default
      { key: "standardDayHours", value: 99, createdAt: new Date() } // no longer valid: default
    ];
    const client = { systemParameter: { findMany: async ({ where }: any) => rows.filter((row) => where.key.in.includes(row.key)) } };
    expect(await loadParameters(client, "w1")).toMatchObject({ hoursUsedThresholdPercent: 90, progressGapPoints: 10, standardDayHours: 8 });
    expect(await getStoredParameter(client, "w1", "hoursUsedThresholdPercent")).toBe(90);
  });
});

describe("7.5 trigger catalogue", () => {
  it("lists every trigger of the document once, all in the base tier", () => {
    expect(ALERT_TRIGGERS.map((item) => item.code)).toEqual(["NL-01", "NL-02", "NL-03", "NL-04", "NL-05", "TD-01", "TD-02", "TD-03", "TD-04", "TD-05", "TD-06", "BRI-01", "BRI-02", "BRI-03", "BRI-04", "BRI-05", "DL-01"]);
    expect(ALERT_TRIGGERS.every((item) => item.tier === "push_now")).toBe(true);
    // TD-04, TD-05 and BRI-05 have their data source now (stage SLA, stage extensions, the gates' customer step).
    expect(ALERT_TRIGGERS.filter((item) => !item.enabled || item.disabledReason)).toEqual([]);
  });

  it("applies Admin overrides to every trigger, the three newly sourced ones included", () => {
    const resolved = resolveAlertTriggers({ "TD-02": { enabled: false, tier: "daily_digest" }, "TD-04": { enabled: false }, "NL-04": { tier: "bogus" as never } });
    expect(resolved.find((item) => item.code === "TD-02")).toMatchObject({ enabled: false, tier: "daily_digest" });
    expect(resolved.find((item) => item.code === "TD-04")?.enabled).toBe(false);
    expect(resolved.filter((item) => ["TD-05", "BRI-05"].includes(item.code)).every((item) => item.enabled)).toBe(true);
    expect(resolved.find((item) => item.code === "NL-04")?.tier).toBe("push_now");
    expect(validateAlertTriggerOverride("TD-02", { tier: "screen_only" })).toEqual({ tier: "screen_only" });
    expect(validateAlertTriggerOverride("TD-04", { enabled: true })).toEqual({ enabled: true });
    expect(() => validateAlertTriggerOverride("XX-01", {})).toThrow();
    expect(() => validateAlertTriggerOverride("TD-02", { tier: "sms" })).toThrow();
  });
});
