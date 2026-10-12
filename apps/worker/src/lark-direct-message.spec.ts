import { describe, expect, it, vi } from "vitest";
import { deliverReminder, directMessageConfigFromEnv, leaveMinutesByUser } from "./lark-direct-message.js";

const card = { msg_type: "interactive", card: { header: { title: { content: "Nhắc" } } } };
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

describe("daily reminder delivery (7.5: tin riêng, else the group webhook)", () => {
  it("is a private message only with LARK_MESSAGING_ENABLED=true and app credentials", () => {
    expect(directMessageConfigFromEnv({ LARK_APP_ID: "cli_test", LARK_APP_SECRET: "s" })).toBeUndefined();
    expect(directMessageConfigFromEnv({ LARK_MESSAGING_ENABLED: "true" })).toBeUndefined();
    expect(directMessageConfigFromEnv({ LARK_MESSAGING_ENABLED: "true", LARK_APP_ID: "cli_test", LARK_APP_SECRET: "s" })).toMatchObject({ appId: "cli_test", baseUrl: "https://open.larksuite.com" });
  });

  it("keeps today's webhook path when messaging is off or the person has no open_id", async () => {
    const postWebhook = vi.fn(async () => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await deliverReminder({ openId: "ou_1", payload: card, postWebhook, fetchImpl })).toBe("webhook");
    expect(await deliverReminder({ directMessage: { appId: "a", appSecret: "s", baseUrl: "https://lark.test" }, payload: card, postWebhook, fetchImpl })).toBe("webhook");
    expect(postWebhook).toHaveBeenCalledTimes(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the card to the person's open_id and logs it", async () => {
    const postWebhook = vi.fn(async () => undefined);
    const log = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (url: string) => json(url.includes("tenant_access_token") ? { code: 0, tenant_access_token: "t-1", expire: 7200 } : { code: 0 })) as unknown as typeof fetch;
    expect(await deliverReminder({ directMessage: { appId: "app-direct", appSecret: "s", baseUrl: "https://lark.test" }, openId: "ou_1", payload: card, postWebhook, fetchImpl, log })).toBe("direct");
    const [url, init] = (fetchImpl as any).mock.calls.at(-1);
    expect(url).toBe("https://lark.test/open-apis/im/v1/messages?receive_id_type=open_id");
    expect(JSON.parse(init.body)).toMatchObject({ receive_id: "ou_1", msg_type: "interactive", content: JSON.stringify(card.card) });
    expect(postWebhook).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({ target: "ou_1", status: "sent", detail: "đã gửi tin riêng" });
  });

  it("falls back to the webhook when the private message is rejected", async () => {
    const postWebhook = vi.fn(async () => undefined);
    const log = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (url: string) => json(url.includes("tenant_access_token") ? { code: 0, tenant_access_token: "t-2" } : { code: 230013, msg: "Bot has NO availability to this user" })) as unknown as typeof fetch;
    expect(await deliverReminder({ directMessage: { appId: "app-fallback", appSecret: "s", baseUrl: "https://lark.test" }, openId: "ou_2", payload: card, postWebhook, fetchImpl, log })).toBe("webhook");
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({ target: "ou_2", status: "failed" });
  });
});

describe("approved leave in the reminder (D-09, V-06)", () => {
  const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
  it("gives a full day or half a day per user on the date", () => {
    const rows = [
      { userId: "full", startDate: day("2026-10-12"), endDate: day("2026-10-14"), startHalfDay: false, endHalfDay: false },
      { userId: "half", startDate: day("2026-10-13"), endDate: day("2026-10-13"), startHalfDay: true, endHalfDay: false },
      { userId: "other-day", startDate: day("2026-10-20"), endDate: day("2026-10-20"), startHalfDay: false, endHalfDay: false }
    ];
    expect([...leaveMinutesByUser(rows, "2026-10-13", 480)]).toEqual([["full", 480], ["half", 240]]);
  });
});
