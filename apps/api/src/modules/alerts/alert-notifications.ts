/**
 * V-36 / V-37 and decision 16: who is told about a warning, when it is told again, and how one scan's messages are merged.
 * What was sent is kept in the warning's own event log (action "notified", note "<reason>|<severity>|<channels>"),
 * so "send once" needs no extra table and shows up in the warning history.
 */
import { ALERT_GROUP_LABELS, ALERT_SEVERITIES, alertTriggerOf, type AlertGroup, type AlertRecipient, type AlertTier, type AlertTriggerDef } from "@b2b-crm/contracts";
import { postReminderWebhook, reminderWebhookConfig } from "../workspace-admin/workspace-admin.service";

export const NOTIFIED_ACTION = "notified";
export const LARK_NOT_CONFIGURED = "chưa cấu hình kênh Lark";
export type NotifyReason = "new" | "escalated" | "overdue" | "closed";
const REASON_LABELS: Record<NotifyReason, string> = { new: "Mới", escalated: "Nâng mức", overdue: "Quá hạn", closed: "Đã đóng" };

const severityRank = (severity: string | undefined) => (ALERT_SEVERITIES as readonly string[]).indexOf(String(severity));

export interface NotifiableWarning {
  status: string;
  severity: string;
  dueAt?: Date | null;
  events: ReadonlyArray<{ action: string; note?: string | null; at?: Date }>;
}

/**
 * V-37: a warning is sent when it is new, and again only when its level rises or it passes its deadline (each once);
 * its closure is announced once, and only if the warning itself had been announced. Null = nothing to send.
 */
export function notifyReason(warning: NotifiableWarning, now: Date): NotifyReason | null {
  const notified = warning.events.filter((event) => event.action === NOTIFIED_ACTION);
  const sent = notified.map((event) => String(event.note ?? "").split("|"));
  if (warning.status !== "open") return sent.length && !sent.some(([reason]) => reason === "closed") ? "closed" : null;
  if (!sent.length) return "new";
  if (severityRank(warning.severity) > Math.max(...sent.map(([, severity]) => severityRank(severity)))) return "escalated";
  // A message sent after the deadline already told the recipients it is late (e.g. a warning that was overdue when it opened).
  const dueAt = warning.dueAt;
  if (dueAt && now > dueAt && !sent.some(([reason]) => reason === "overdue") && !notified.some((event) => event.at && event.at > dueAt)) return "overdue";
  return null;
}

export interface PendingAlert {
  warningId: string;
  projectId: string;
  projectName: string;
  typeCode: string;
  title: string;
  severity: string;
  reason: NotifyReason;
  trigger: AlertTriggerDef;
  /** Resolved user ids per recipient role of the trigger. */
  recipientUserIds: string[];
}

export interface AlertMessage {
  /** Null = the management group on Lark. */
  recipientUserId: string | null;
  /** A trigger group for "push now", "digest" for the daily digest. */
  bucket: AlertGroup | "digest";
  title: string;
  body: string;
  href: string;
  alerts: PendingAlert[];
}

function messageOf(recipientUserId: string | null, bucket: AlertMessage["bucket"], alerts: PendingAlert[]): AlertMessage {
  const projects = new Set(alerts.map((alert) => alert.projectId));
  const lines = alerts.slice(0, 8).map((alert) => `[${REASON_LABELS[alert.reason]}] ${alert.typeCode} · ${alert.projectName}: ${alert.title}`);
  if (alerts.length > lines.length) lines.push(`… và ${alerts.length - lines.length} cảnh báo khác`);
  return {
    recipientUserId, bucket, alerts,
    title: bucket === "digest" ? `Bản tin cảnh báo dự án: ${alerts.length} cảnh báo` : `Cảnh báo ${ALERT_GROUP_LABELS[bucket]}: ${alerts.length} thay đổi`,
    body: lines.join("\n"),
    // A person who is not an Admin cannot open the Admin tab, so a single-project message links to that project.
    href: projects.size === 1 ? `/projects/${encodeURIComponent(alerts[0].projectId)}` : recipientUserId === null ? "/admin#alerts" : `/projects/${encodeURIComponent(alerts[0].projectId)}`,
  };
}

/**
 * V-37 "nhiều cảnh báo cùng nhóm trong một lượt quét gộp thành một tin": per recipient, one message per trigger group
 * for tier "push_now" and ONE message for everything in tier "daily_digest". Tier "screen_only" sends nothing.
 * The Lark management group (recipient null) gets the same merge.
 */
export function mergeAlerts(pending: readonly PendingAlert[]): AlertMessage[] {
  const buckets = new Map<string, { recipientUserId: string | null; bucket: AlertMessage["bucket"]; alerts: PendingAlert[] }>();
  for (const alert of pending) {
    const tier: AlertTier = alert.trigger.tier;
    if (tier === "screen_only") continue;
    const bucket = tier === "daily_digest" ? "digest" : alert.trigger.group;
    for (const recipientUserId of [null, ...new Set(alert.recipientUserIds)]) {
      const key = `${recipientUserId ?? "lark"}|${bucket}`;
      const entry = buckets.get(key) ?? { recipientUserId, bucket, alerts: [] };
      entry.alerts.push(alert);
      buckets.set(key, entry);
    }
  }
  return [...buckets.values()].map((entry) => messageOf(entry.recipientUserId, entry.bucket, entry.alerts));
}

export function resolveRecipients(roles: readonly AlertRecipient[], who: { ownerUserId?: string | null; pmUserId?: string | null; adminUserIds: readonly string[] }): string[] {
  const ids = new Set<string>();
  if (roles.includes("owner") && who.ownerUserId) ids.add(who.ownerUserId);
  if (roles.includes("pm") && who.pmUserId) ids.add(who.pmUserId);
  if (roles.includes("admins")) who.adminUserIds.forEach((id) => ids.add(id));
  return [...ids];
}

/**
 * The ONE door to Lark for project warnings (V-36 "Cảnh báo dự án" → nhóm Quản lý dự án). Uses the existing custom-bot
 * webhook sender when LARK_PROJECT_ALERT_WEBHOOK_URL is set; otherwise nothing is sent and the caller records why.
 * No bot or group is created here.
 */
export async function deliverLarkAlert(message: { title: string; body: string; href: string }, env: NodeJS.ProcessEnv = process.env, post: typeof postReminderWebhook = postReminderWebhook): Promise<string> {
  const url = env.LARK_PROJECT_ALERT_WEBHOOK_URL?.trim();
  if (!url) return LARK_NOT_CONFIGURED;
  try {
    const origin = (env.PUBLIC_APP_URL ?? env.CRM_AUTH_PUBLIC_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
    await post({
      msg_type: "interactive",
      card: {
        schema: "2.0",
        header: { template: "red", title: { tag: "plain_text", content: message.title } },
        body: { elements: [{ tag: "markdown", content: message.body }, { tag: "markdown", content: `[Mở trên hệ thống PM](${origin}${message.href})` }] }
      }
    }, reminderWebhookConfig(url, env.LARK_PROJECT_ALERT_WEBHOOK_SECRET?.trim() || undefined));
    return "đã gửi Lark";
  } catch (error) {
    return `Lark lỗi: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function triggerFor(typeCode: string, triggers: readonly AlertTriggerDef[]) {
  return alertTriggerOf(typeCode, triggers);
}
