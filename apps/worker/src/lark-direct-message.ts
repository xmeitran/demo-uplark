/**
 * 7.5 "Nhắc việc hằng ngày → tin riêng tới từng nhân sự và PM": the reminder cards go to each person as a bot
 * message when LARK_MESSAGING_ENABLED=true and the app credentials exist; otherwise (or when the private message
 * fails) they go to the group webhook exactly as before. Also D-09 / V-06: people on approved leave are not chased.
 * The worker cannot import API code, so the small pieces it needs live here.
 */
export type DirectMessageConfig = { appId: string; appSecret: string; baseUrl: string };

export function directMessageConfigFromEnv(env: NodeJS.ProcessEnv): DirectMessageConfig | undefined {
  const appId = env.LARK_APP_ID?.trim();
  const appSecret = env.LARK_APP_SECRET?.trim();
  if (env.LARK_MESSAGING_ENABLED !== "true" || !appId || !appSecret) return undefined;
  return { appId, appSecret, baseUrl: (env.LARK_OPEN_API_BASE_URL?.trim() || "https://open.larksuite.com").replace(/\/$/, "") };
}

let cachedToken: { key: string; value: string; expiresAt: number } | undefined;

async function tenantToken(config: DirectMessageConfig, fetchImpl: typeof fetch) {
  if (cachedToken && cachedToken.key === config.appId && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const response = await fetchImpl(`${config.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret })
  });
  const body = (await response.json().catch(() => ({}))) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (!response.ok || body.code !== 0 || !body.tenant_access_token) throw new Error(`Lark tenant access token failed: ${body.msg ?? `HTTP ${response.status}`}`);
  cachedToken = { key: config.appId, value: body.tenant_access_token, expiresAt: Date.now() + (body.expire ?? 3600) * 1000 };
  return cachedToken.value;
}

async function postDirectMessage(config: DirectMessageConfig, openId: string, card: unknown, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${config.baseUrl}/open-apis/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: { authorization: `Bearer ${await tenantToken(config, fetchImpl)}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ receive_id: openId, msg_type: "interactive", content: JSON.stringify(card) }),
    signal: AbortSignal.timeout(10_000)
  });
  const body = (await response.json().catch(() => ({}))) as { code?: number; msg?: string };
  if (!response.ok || body.code !== 0) throw new Error(`Lark direct message rejected: ${body.msg ?? `HTTP ${response.status}`}`);
}

type DeliveryLog = (entry: { target: string; status: "sent" | "disabled" | "failed"; detail: string }) => Promise<unknown>;

/**
 * Private message when configured and the person has an open_id; the group webhook otherwise and as the fallback of
 * a failed private message. Returns the channel that delivered.
 */
export async function deliverReminder(options: {
  directMessage?: DirectMessageConfig;
  openId?: string;
  payload: { card?: unknown };
  postWebhook: () => Promise<void>;
  fetchImpl?: typeof fetch;
  log?: DeliveryLog;
}): Promise<"direct" | "webhook"> {
  const log = async (...args: Parameters<DeliveryLog>) => { await options.log?.(...args).catch(() => undefined); };
  if (options.directMessage && options.openId) {
    try {
      await postDirectMessage(options.directMessage, options.openId, options.payload.card ?? options.payload, options.fetchImpl ?? fetch);
      await log({ target: options.openId, status: "sent", detail: "đã gửi tin riêng" });
      return "direct";
    } catch (error) {
      await log({ target: options.openId, status: "failed", detail: `${error instanceof Error ? error.message : String(error)}; chuyển sang webhook nhóm` });
    }
  }
  await options.postWebhook();
  return "webhook";
}

export interface WorkerLeaveRow { userId: string; startDate: Date; endDate: Date; startHalfDay: boolean; endHalfDay: boolean }

/** Minutes of approved leave per user on a local date. Mirrors leaveMinutesOn in apps/api/src/modules/lark-integration/personal-leave.ts. */
export function leaveMinutesByUser(rows: readonly WorkerLeaveRow[], localDate: string, standardMinutes: number): Map<string, number> {
  const minutes = new Map<string, number>();
  for (const row of rows) {
    const start = row.startDate.toISOString().slice(0, 10);
    const end = row.endDate.toISOString().slice(0, 10);
    if (localDate < start || localDate > end) continue;
    const half = (localDate === start && row.startHalfDay) || (localDate === end && row.endHalfDay);
    minutes.set(row.userId, Math.min(standardMinutes, (minutes.get(row.userId) ?? 0) + (half ? standardMinutes / 2 : standardMinutes)));
  }
  return minutes;
}

/** Approved leave of the workspace on the date; empty when the table is not there yet. */
export async function loadLeaveMinutes(prisma: unknown, workspaceId: string, localDate: string, standardMinutes: number): Promise<Map<string, number>> {
  const model = (prisma as { personalLeave?: { findMany: (input: unknown) => Promise<WorkerLeaveRow[]> } }).personalLeave;
  if (!model) return new Map();
  const day = new Date(`${localDate}T00:00:00.000Z`);
  return leaveMinutesByUser(await model.findMany({ where: { workspaceId, status: "approved", startDate: { lte: day }, endDate: { gte: day } } }), localDate, standardMinutes);
}
