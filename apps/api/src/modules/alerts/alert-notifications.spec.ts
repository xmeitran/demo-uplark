import { describe, expect, it, vi } from "vitest";
import { ALERT_TRIGGERS, alertTriggerOf, type AlertTier } from "@b2b-crm/contracts";
import { deliverLarkAlert, LARK_NOT_CONFIGURED, mergeAlerts, NOTIFIED_ACTION, notifyReason, resolveRecipients, type PendingAlert } from "./alert-notifications";

const now = new Date("2026-10-14T03:00:00.000Z");
const sent = (note: string) => ({ action: NOTIFIED_ACTION, note });

describe("V-37 send once, resend only on a higher level or a missed deadline", () => {
  it("sends a new warning once", () => {
    expect(notifyReason({ status: "open", severity: "medium", events: [{ action: "opened" }] }, now)).toBe("new");
    expect(notifyReason({ status: "open", severity: "medium", events: [{ action: "opened" }, sent("new|medium|x"), { action: "refreshed" }] }, now)).toBeNull();
  });
  it("sends again when the level rises, once per level", () => {
    const events = [sent("new|medium|x")];
    expect(notifyReason({ status: "open", severity: "high", events }, now)).toBe("escalated");
    expect(notifyReason({ status: "open", severity: "high", events: [...events, sent("escalated|high|x")] }, now)).toBeNull();
    expect(notifyReason({ status: "open", severity: "low", events }, now)).toBeNull(); // a lower level is not news
  });
  it("sends again once when the deadline passes", () => {
    const base = { status: "open", severity: "medium", dueAt: new Date("2026-10-13T00:00:00.000Z") };
    expect(notifyReason({ ...base, events: [sent("new|medium|x")] }, now)).toBe("overdue");
    expect(notifyReason({ ...base, events: [sent("new|medium|x"), sent("overdue|medium|x")] }, now)).toBeNull();
    expect(notifyReason({ ...base, dueAt: new Date("2026-10-20T00:00:00.000Z"), events: [sent("new|medium|x")] }, now)).toBeNull();
    // Already overdue when it was first announced: that message covered it.
    expect(notifyReason({ ...base, events: [{ ...sent("new|medium|x"), at: new Date("2026-10-13T08:00:00.000Z") }] }, now)).toBeNull();
    expect(notifyReason({ ...base, events: [{ ...sent("new|medium|x"), at: new Date("2026-10-12T08:00:00.000Z") }] }, now)).toBe("overdue");
  });
  it("announces a closure once, and only for a warning that had been announced", () => {
    expect(notifyReason({ status: "closed", severity: "medium", events: [sent("new|medium|x")] }, now)).toBe("closed");
    expect(notifyReason({ status: "closed", severity: "medium", events: [sent("new|medium|x"), sent("closed|medium|x")] }, now)).toBeNull();
    expect(notifyReason({ status: "closed", severity: "medium", events: [{ action: "opened" }, { action: "closed" }] }, now)).toBeNull();
  });
});

describe("V-37 merge per scan and the three tiers of decision 16", () => {
  const alert = (typeCode: string, recipients: string[], tier: AlertTier = "push_now", projectId = "p1"): PendingAlert => ({
    warningId: `${typeCode}-${projectId}`, projectId, projectName: projectId.toUpperCase(), typeCode, title: typeCode, severity: "medium", reason: "new",
    trigger: { ...alertTriggerOf(typeCode, ALERT_TRIGGERS)!, tier }, recipientUserIds: recipients
  });
  const view = (messages: ReturnType<typeof mergeAlerts>) => messages.map((message) => `${message.recipientUserId ?? "lark"}:${message.bucket}:${message.alerts.length}`).sort();

  it("push now: one message per recipient and trigger group, plus one per group for the Lark management group", () => {
    const messages = mergeAlerts([alert("TD-01", ["pm", "admin"]), alert("TD-02", ["pm"]), alert("NL-04", ["pm"])]);
    expect(view(messages)).toEqual(["admin:TD:1", "lark:NL:1", "lark:TD:2", "pm:NL:1", "pm:TD:2"]);
    expect(messages.find((message) => message.recipientUserId === "pm" && message.bucket === "TD")?.body.split("\n")).toHaveLength(2);
  });
  it("daily digest: everything in one message per recipient; screen only: nothing", () => {
    expect(view(mergeAlerts([alert("TD-01", ["pm"], "daily_digest"), alert("NL-04", ["pm"], "daily_digest"), alert("DL-01", ["pm"], "screen_only")]))).toEqual(["lark:digest:2", "pm:digest:2"]);
  });
  it("links one project to its page and several projects to a page the recipient can open", () => {
    const [toPm] = mergeAlerts([alert("TD-01", ["pm"]), alert("TD-02", ["pm"], "push_now", "p2")]).filter((message) => message.recipientUserId === "pm");
    expect(toPm.href).toBe("/projects/p1");
    expect(mergeAlerts([alert("TD-01", [])])[0].href).toBe("/projects/p1");
    expect(mergeAlerts([alert("TD-01", []), alert("TD-02", [], "push_now", "p2")])[0].href).toBe("/admin#alerts");
  });
  it("resolves recipients per trigger without duplicates", () => {
    expect(resolveRecipients(["owner", "pm", "admins"], { ownerUserId: "pm", pmUserId: "pm", adminUserIds: ["a1", "pm"] })).toEqual(["pm", "a1"]);
    expect(resolveRecipients(["owner"], { ownerUserId: null, pmUserId: "pm", adminUserIds: ["a1"] })).toEqual([]);
  });
});

describe("deliverLarkAlert", () => {
  const message = { title: "Cảnh báo Tiến độ: 2 thay đổi", body: "…", href: "/admin#alerts" };
  it("records that the channel is not configured instead of sending", async () => {
    const post = vi.fn();
    await expect(deliverLarkAlert(message, {}, post)).resolves.toBe(LARK_NOT_CONFIGURED);
    expect(post).not.toHaveBeenCalled();
  });
  it("posts through the existing webhook sender when the alert webhook is configured, and reports a failure as text", async () => {
    const env = { LARK_PROJECT_ALERT_WEBHOOK_URL: "https://open.larksuite.com/open-apis/bot/v2/hook/abc" };
    const post = vi.fn().mockResolvedValue(undefined);
    await expect(deliverLarkAlert(message, env, post)).resolves.toBe("đã gửi Lark");
    expect(post.mock.calls[0][1]).toMatchObject({ url: env.LARK_PROJECT_ALERT_WEBHOOK_URL });
    post.mockRejectedValue(new Error("HTTP 500"));
    await expect(deliverLarkAlert(message, env, post)).resolves.toBe("Lark lỗi: HTTP 500");
    await expect(deliverLarkAlert(message, { LARK_PROJECT_ALERT_WEBHOOK_URL: "http://evil.example/hook" }, post)).resolves.toContain("Lark lỗi");
  });
});
