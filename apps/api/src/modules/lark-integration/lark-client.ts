/**
 * The ONE door to the Lark Open API for groups, bot messages and Approval reads (7.5 / V-36, V-02, D-09).
 *
 * Every request goes through LarkTransport.call(), which
 *   (a) sends nothing unless LARK_MESSAGING_ENABLED=true and LARK_APP_ID / LARK_APP_SECRET are set — the outcome is
 *       then "disabled" with the note "chưa bật kênh Lark";
 *   (b) writes one LarkDeliveryLog row per attempt: what, to whom, result;
 *   (c) never throws: callers branch on the outcome.
 * Specs replace the transport with a fake `{ call, record, alreadyHandled }`, or give the real one a fake fetch.
 * Scopes and env keys: docs/lark-integration.md.
 */
import { Inject, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";

export const LARK_CHANNEL_DISABLED = "chưa bật kênh Lark";

export type LarkStatus = "sent" | "disabled" | "failed";

export interface LarkOutcome<T = any> {
  status: LarkStatus;
  detail: string;
  data?: T;
}

/** What the delivery log keeps next to the request itself. */
export interface LarkLogContext {
  /** Human-readable recipient: chat id, open_id, "nhóm nội bộ dự án X"… */
  target: string;
  workspaceId?: string | null;
  projectId?: string | null;
  /** Bot name of table 7.5 ("Khởi tạo dự án", "Sổ vấn đề dự án"…). */
  bot?: string;
  /** "Send once" key: see alreadyHandled(). */
  dedupeKey?: string;
}

export interface LarkRequest extends LarkLogContext {
  /** create_chat | add_members | remove_members | list_members | send_message | list_approval_instances | get_approval_instance */
  action: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** False for reads that would flood the log (Approval instance details); failures are logged anyway. */
  log?: boolean;
}

export interface LarkTransportLike {
  call<T = any>(request: LarkRequest): Promise<LarkOutcome<T>>;
  record(entry: LarkLogContext & { action: string; status: LarkStatus; detail?: string }): Promise<void>;
  alreadyHandled(dedupeKey: string): Promise<boolean>;
}

export function larkMessagingConfig(env: NodeJS.ProcessEnv = process.env) {
  const appId = env.LARK_APP_ID?.trim();
  const appSecret = env.LARK_APP_SECRET?.trim();
  if (env.LARK_MESSAGING_ENABLED !== "true" || !appId || !appSecret) return null;
  return { appId, appSecret, baseUrl: (env.LARK_OPEN_API_BASE_URL?.trim() || "https://open.larksuite.com").replace(/\/$/, "") };
}

/** A failed key is retried on later sweeps, but not forever. */
const MAX_ATTEMPTS_PER_KEY = 3;

@Injectable()
export class LarkTransport implements LarkTransportLike {
  env: NodeJS.ProcessEnv = process.env;
  fetchImpl: typeof fetch = (...args) => fetch(...args);
  private token?: { value: string; expiresAt: number };

  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: any) {}

  get enabled() {
    return larkMessagingConfig(this.env) !== null;
  }

  async record(entry: LarkLogContext & { action: string; status: LarkStatus; detail?: string }) {
    try {
      await this.prisma?.larkDeliveryLog?.create({
        data: { workspaceId: entry.workspaceId ?? null, projectId: entry.projectId ?? null, bot: entry.bot ?? null, action: entry.action, target: entry.target, status: entry.status, detail: entry.detail?.slice(0, 1000) ?? null, dedupeKey: entry.dedupeKey ?? null }
      });
    } catch (error) {
      // The log must never break the business action that triggered the message.
      console.error("Lark delivery log failed", error);
    }
  }

  /** True when the key was already sent (or recorded as not sendable), or has failed MAX_ATTEMPTS_PER_KEY times. */
  async alreadyHandled(dedupeKey: string) {
    const rows: Array<{ status: string }> = (await this.prisma?.larkDeliveryLog?.findMany({ where: { dedupeKey }, select: { status: true }, take: MAX_ATTEMPTS_PER_KEY })) ?? [];
    return rows.some((row) => row.status !== "failed") || rows.length >= MAX_ATTEMPTS_PER_KEY;
  }

  private async tenantToken(config: NonNullable<ReturnType<typeof larkMessagingConfig>>) {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const response = await this.fetchImpl(`${config.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret })
    });
    const body = (await response.json().catch(() => ({}))) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (!response.ok || body.code !== 0 || !body.tenant_access_token) throw new Error(`không lấy được tenant access token: ${body.msg ?? `HTTP ${response.status}`}`);
    this.token = { value: body.tenant_access_token, expiresAt: Date.now() + (body.expire ?? 3600) * 1000 };
    return this.token.value;
  }

  async call<T = any>(request: LarkRequest): Promise<LarkOutcome<T>> {
    const config = larkMessagingConfig(this.env);
    let outcome: LarkOutcome<T>;
    if (!config) {
      outcome = { status: "disabled", detail: LARK_CHANNEL_DISABLED };
    } else {
      try {
        const url = new URL(`${config.baseUrl}/open-apis${request.path}`);
        for (const [key, value] of Object.entries(request.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
        const response = await this.fetchImpl(url.toString(), {
          method: request.method,
          headers: { authorization: `Bearer ${await this.tenantToken(config)}`, "content-type": "application/json; charset=utf-8" },
          ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
          signal: AbortSignal.timeout(15_000)
        });
        const body = (await response.json().catch(() => ({}))) as { code?: number; msg?: string; data?: T };
        outcome = response.ok && body.code === 0
          ? { status: "sent", detail: "đã gửi Lark", data: body.data }
          : { status: "failed", detail: `Lark lỗi: ${body.msg ?? `HTTP ${response.status}`}${body.code ? ` (code ${body.code})` : ""}` };
      } catch (error) {
        outcome = { status: "failed", detail: `Lark lỗi: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    if (request.log !== false || outcome.status === "failed") await this.record({ ...request, status: outcome.status, detail: outcome.detail });
    return outcome;
  }
}

// ---------------------------------------------------------------------------
// The calls the integration uses. `ctx` is what the delivery log shows.
// ---------------------------------------------------------------------------

type Ctx = Omit<LarkLogContext, "target"> & { target?: string };

export interface LarkCard {
  config?: Record<string, unknown>;
  header: { template: string; title: { tag: "plain_text"; content: string } };
  elements: unknown[];
}

/** A private group owned by the bot, with the given members (open_id). */
export function createChat(lark: LarkTransportLike, input: { name: string; description?: string; openIds: string[] }, ctx: Ctx) {
  return lark.call<{ chat_id: string }>({
    ...ctx, target: ctx.target ?? input.name, action: "create_chat", method: "POST", path: "/im/v1/chats", query: { user_id_type: "open_id", set_bot_manager: "true" },
    body: { name: input.name, description: input.description ?? "", chat_mode: "group", chat_type: "private", user_id_list: input.openIds }
  });
}

export function addChatMembers(lark: LarkTransportLike, chatId: string, openIds: string[], ctx: Ctx) {
  return lark.call({ ...ctx, target: ctx.target ?? chatId, action: "add_members", method: "POST", path: `/im/v1/chats/${encodeURIComponent(chatId)}/members`, query: { member_id_type: "open_id" }, body: { id_list: openIds } });
}

export function removeChatMembers(lark: LarkTransportLike, chatId: string, openIds: string[], ctx: Ctx) {
  return lark.call({ ...ctx, target: ctx.target ?? chatId, action: "remove_members", method: "DELETE", path: `/im/v1/chats/${encodeURIComponent(chatId)}/members`, query: { member_id_type: "open_id" }, body: { id_list: openIds } });
}

/** open_ids of the people in the chat (first 100: project groups are small). */
export async function listChatMembers(lark: LarkTransportLike, chatId: string, ctx: Ctx): Promise<LarkOutcome<string[]>> {
  const outcome = await lark.call<{ items?: Array<{ member_id?: string }> }>({ ...ctx, target: ctx.target ?? chatId, action: "list_members", method: "GET", path: `/im/v1/chats/${encodeURIComponent(chatId)}/members`, query: { member_id_type: "open_id", page_size: 100 }, log: false });
  return { ...outcome, data: (outcome.data?.items ?? []).flatMap((item) => (item.member_id ? [item.member_id] : [])) };
}

/** Text or interactive card to a chat (chat_id) or to one person (open_id). */
export function sendMessage(lark: LarkTransportLike, to: { chatId: string } | { openId: string }, message: string | LarkCard, ctx: Ctx) {
  const receiveId = "chatId" in to ? to.chatId : to.openId;
  return lark.call<{ message_id: string }>({
    ...ctx, target: ctx.target ?? receiveId, action: "send_message", method: "POST", path: "/im/v1/messages", query: { receive_id_type: "chatId" in to ? "chat_id" : "open_id" },
    body: typeof message === "string"
      ? { receive_id: receiveId, msg_type: "text", content: JSON.stringify({ text: message }) }
      : { receive_id: receiveId, msg_type: "interactive", content: JSON.stringify(message) }
  });
}

/** Instance codes of one Approval definition created in the window (all pages). */
export async function listApprovalInstanceCodes(lark: LarkTransportLike, input: { approvalCode: string; from: Date; to: Date }, ctx: Ctx): Promise<LarkOutcome<string[]>> {
  const codes: string[] = [];
  let pageToken: string | undefined;
  // ponytail: 50 pages × 100 = 5.000 instances per sync window; shorten LARK_LEAVE_SYNC_LOOKBACK_DAYS if a tenant exceeds it.
  for (let page = 0; page < 50; page += 1) {
    const outcome = await lark.call<{ instance_code_list?: string[]; page_token?: string; has_more?: boolean }>({
      ...ctx, target: ctx.target ?? input.approvalCode, action: "list_approval_instances", method: "GET", path: "/approval/v4/instances",
      query: { approval_code: input.approvalCode, start_time: input.from.getTime(), end_time: input.to.getTime(), page_size: 100, page_token: pageToken }
    });
    if (outcome.status !== "sent") return { ...outcome, data: codes };
    codes.push(...(outcome.data?.instance_code_list ?? []));
    pageToken = outcome.data?.page_token;
    if (!outcome.data?.has_more || !pageToken) break;
  }
  return { status: "sent", detail: "đã đọc Lark Approval", data: codes };
}

export function getApprovalInstance(lark: LarkTransportLike, instanceCode: string, ctx: Ctx) {
  return lark.call<Record<string, any>>({ ...ctx, target: ctx.target ?? instanceCode, action: "get_approval_instance", method: "GET", path: `/approval/v4/instances/${encodeURIComponent(instanceCode)}`, log: false });
}
