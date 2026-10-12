import { describe, expect, it, vi } from "vitest";
import { LARK_CHANNEL_DISABLED, LarkTransport, addChatMembers, createChat, listApprovalInstanceCodes, sendMessage } from "./lark-client";

const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

function transport(env: NodeJS.ProcessEnv, handler: (url: string, init: any) => unknown = () => ({ code: 0, data: {} })) {
  const rows: any[] = [];
  const prisma = { larkDeliveryLog: { create: vi.fn(async ({ data }: any) => { rows.push(data); }), findMany: vi.fn(async ({ where }: any) => rows.filter((row) => row.dedupeKey === where.dedupeKey)) } };
  const lark = new LarkTransport(prisma);
  lark.env = env;
  const fetchImpl = vi.fn(async (url: string, init: any) => {
    if (url.includes("tenant_access_token")) return response({ code: 0, tenant_access_token: "t-1", expire: 7200 });
    const result = handler(url, init) as any;
    return result?.json ? result : response(result);
  });
  lark.fetchImpl = fetchImpl as unknown as typeof fetch;
  return { lark, rows, fetchImpl };
}

const ENABLED = { LARK_MESSAGING_ENABLED: "true", LARK_APP_ID: "cli_test", LARK_APP_SECRET: "test-secret", LARK_OPEN_API_BASE_URL: "https://lark.test/" };

describe("LarkTransport", () => {
  it("sends nothing and records \"chưa bật kênh Lark\" unless LARK_MESSAGING_ENABLED=true with app credentials", async () => {
    for (const env of [{}, { LARK_MESSAGING_ENABLED: "true" }, { LARK_APP_ID: "cli_test", LARK_APP_SECRET: "test-secret" }, { ...ENABLED, LARK_MESSAGING_ENABLED: "false" }]) {
      const { lark, rows, fetchImpl } = transport(env);
      const outcome = await sendMessage(lark, { chatId: "oc_1" }, "xin chào", { workspaceId: "ws", projectId: "prj", bot: "Khởi tạo dự án", dedupeKey: "k" });
      expect(outcome).toEqual({ status: "disabled", detail: LARK_CHANNEL_DISABLED });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(rows).toEqual([{ workspaceId: "ws", projectId: "prj", bot: "Khởi tạo dự án", action: "send_message", target: "oc_1", status: "disabled", detail: LARK_CHANNEL_DISABLED, dedupeKey: "k" }]);
    }
  });

  it("enabled: authenticates with the tenant token (cached), sends and logs what, to whom and the result", async () => {
    const { lark, rows, fetchImpl } = transport(ENABLED, () => ({ code: 0, data: { chat_id: "oc_new" } }));
    const created = await createChat(lark, { name: "[Nội bộ] ACME - HRM", openIds: ["ou_1", "ou_2"] }, { workspaceId: "ws", projectId: "prj" });
    expect(created).toMatchObject({ status: "sent", data: { chat_id: "oc_new" } });
    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe("https://lark.test/open-apis/im/v1/chats?user_id_type=open_id&set_bot_manager=true");
    expect(init.headers.authorization).toBe("Bearer t-1");
    expect(JSON.parse(init.body)).toMatchObject({ name: "[Nội bộ] ACME - HRM", chat_type: "private", user_id_list: ["ou_1", "ou_2"] });

    await addChatMembers(lark, "oc_new", ["ou_3"], {});
    await sendMessage(lark, { openId: "ou_3" }, { header: { template: "blue", title: { tag: "plain_text", content: "T" } }, elements: [] }, {});
    expect(fetchImpl.mock.calls.filter(([calledUrl]) => String(calledUrl).includes("tenant_access_token"))).toHaveLength(1);
    const [messageUrl, messageInit] = fetchImpl.mock.calls.at(-1)!;
    expect(messageUrl).toContain("/im/v1/messages?receive_id_type=open_id");
    expect(JSON.parse(messageInit.body)).toMatchObject({ receive_id: "ou_3", msg_type: "interactive" });
    expect(rows.map((row) => [row.action, row.target, row.status])).toEqual([["create_chat", "[Nội bộ] ACME - HRM", "sent"], ["add_members", "oc_new", "sent"], ["send_message", "ou_3", "sent"]]);
  });

  it("failed: a Lark error code, an HTTP error and a network error all come back as an outcome, never as an exception", async () => {
    const refused = transport(ENABLED, () => ({ code: 232011, msg: "Operator and invited users can NOT be in the same tenant" }));
    expect(await createChat(refused.lark, { name: "G", openIds: [] }, {})).toEqual({ status: "failed", detail: "Lark lỗi: Operator and invited users can NOT be in the same tenant (code 232011)", data: undefined });
    expect(refused.rows[0]).toMatchObject({ action: "create_chat", status: "failed" });

    const http = transport(ENABLED, () => response({}, false, 502));
    expect((await sendMessage(http.lark, { chatId: "oc_1" }, "x", {})).detail).toBe("Lark lỗi: HTTP 502");

    const network = transport(ENABLED, () => { throw new Error("ECONNRESET"); });
    expect(await sendMessage(network.lark, { chatId: "oc_1" }, "x", {})).toEqual({ status: "failed", detail: "Lark lỗi: ECONNRESET" });
    expect(network.rows).toHaveLength(1);
  });

  it("alreadyHandled: sent or not-sendable keys are done; a failing key is retried at most three times", async () => {
    const { lark, rows } = transport({});
    expect(await lark.alreadyHandled("a")).toBe(false);
    rows.push({ dedupeKey: "a", status: "failed" }, { dedupeKey: "a", status: "failed" });
    expect(await lark.alreadyHandled("a")).toBe(false);
    rows.push({ dedupeKey: "a", status: "failed" });
    expect(await lark.alreadyHandled("a")).toBe(true);
    rows.push({ dedupeKey: "b", status: "disabled" }, { dedupeKey: "c", status: "sent" });
    expect(await lark.alreadyHandled("b")).toBe(true);
    expect(await lark.alreadyHandled("c")).toBe(true);
  });

  it("reads every page of the Approval instance list", async () => {
    const { lark } = transport(ENABLED, (url) => (url.includes("page_token=p2") ? { code: 0, data: { instance_code_list: ["C"], has_more: false } } : { code: 0, data: { instance_code_list: ["A", "B"], has_more: true, page_token: "p2" } }));
    const outcome = await listApprovalInstanceCodes(lark, { approvalCode: "LEAVE", from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-10-12T00:00:00.000Z") }, {});
    expect(outcome).toMatchObject({ status: "sent", data: ["A", "B", "C"] });
  });
});
