/**
 * D-09 / chốt 11/10 #7: personal leave comes from APPROVED instances of the Lark leave Approval and reduces the
 * person's daily cap (D-13). Read-only in the app: rows are only written by syncPersonalLeave().
 *
 * The document does not define half days. Lark leave can be half a day, so a half day counts as half of
 * "Giờ chuẩn một ngày" (assumption — see docs/lark-integration.md).
 */
import { STANDARD_DAY_MINUTES } from "../delivery-handoff/daily-actual-log";
import { getApprovalInstance, listApprovalInstanceCodes, type LarkTransportLike } from "./lark-client";

const HCM_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

export interface LeaveRange {
  startDate: Date | string;
  endDate: Date | string;
  startHalfDay?: boolean;
  endHalfDay?: boolean;
  status?: string;
}

const dateKey = (value: Date | string) => (typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10));

/** Minutes of leave on one local date (YYYY-MM-DD): a full day = the standard day, a half day = half of it; never more than the standard day. */
export function leaveMinutesOn(leaves: readonly LeaveRange[], localDate: string, standardMinutes: number = STANDARD_DAY_MINUTES): number {
  let minutes = 0;
  for (const leave of leaves) {
    if (leave.status && leave.status !== "approved") continue;
    const start = dateKey(leave.startDate);
    const end = dateKey(leave.endDate);
    if (localDate < start || localDate > end) continue;
    const half = (localDate === start && leave.startHalfDay) || (localDate === end && leave.endHalfDay);
    minutes += half ? standardMinutes / 2 : standardMinutes;
  }
  return Math.min(standardMinutes, Math.round(minutes));
}

/** The extension point of the time-log rules (projects.service.ts standardDayCapMinutes): 0 when the person has no approved leave that day. */
export async function approvedPersonalLeaveMinutes(client: any, workspaceId: string, userId: string, localDate: string, standardMinutes: number = STANDARD_DAY_MINUTES): Promise<number> {
  // Unit specs mock only the Prisma models they exercise.
  if (typeof client?.personalLeave?.findMany !== "function") return 0;
  const day = new Date(`${localDate}T00:00:00.000Z`);
  const leaves = await client.personalLeave.findMany({
    where: { workspaceId, userId, status: "approved", startDate: { lte: day }, endDate: { gte: day } },
    select: { startDate: true, endDate: true, startHalfDay: true, endHalfDay: true }
  });
  return leaveMinutesOn(leaves, localDate, standardMinutes);
}

/** User ids with a FULL day of approved leave on the date: they are not chased for a missing time log (D-09, V-06). */
export async function userIdsOnFullDayLeave(client: any, workspaceId: string, localDate: string, standardMinutes: number = STANDARD_DAY_MINUTES): Promise<Set<string>> {
  if (typeof client?.personalLeave?.findMany !== "function") return new Set();
  const day = new Date(`${localDate}T00:00:00.000Z`);
  const leaves: Array<LeaveRange & { userId: string }> = await client.personalLeave.findMany({ where: { workspaceId, status: "approved", startDate: { lte: day }, endDate: { gte: day } } });
  const byUser = new Map<string, LeaveRange[]>();
  for (const leave of leaves) byUser.set(leave.userId, [...(byUser.get(leave.userId) ?? []), leave]);
  return new Set([...byUser].filter(([, rows]) => leaveMinutesOn(rows, localDate, standardMinutes) >= standardMinutes).map(([userId]) => userId));
}

export interface ParsedLeave {
  instanceCode: string;
  /** Lark instance status: PENDING | APPROVED | REJECTED | CANCELED | DELETED. */
  status: string;
  openId?: string;
  larkUserId?: string;
  leaveType?: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
}

function localParts(at: Date) {
  const local = new Date(at.getTime() + HCM_OFFSET_MS);
  return { date: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/**
 * Reads the leave widget (type "leaveGroup" / "leaveGroupV2": { name, start, end, interval, unit }) of an Approval
 * instance. Days are Vietnam dates. Half days are read from the clock times: a leave that starts at or after 12:00
 * takes half of its first day; one that ends at or before 12:00 takes half of its last day; an end at 00:00 belongs
 * to the day before. Null when the instance has no usable leave widget.
 */
export function parseLeaveInstance(instance: Record<string, any> | null | undefined): ParsedLeave | null {
  if (!instance) return null;
  let widgets: any[] = [];
  try {
    widgets = typeof instance.form === "string" ? JSON.parse(instance.form) : Array.isArray(instance.form) ? instance.form : [];
  } catch {
    return null;
  }
  const widget = widgets.find((item) => String(item?.type ?? "").startsWith("leaveGroup")) ?? widgets.find((item) => item?.type === "dateInterval");
  const value = widget?.value;
  const start = new Date(value?.start);
  const end = new Date(value?.end);
  if (!value || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  const from = localParts(start);
  // An end at exactly midnight is the exclusive end of the previous day.
  const to = localParts(end.getTime() > start.getTime() && localParts(end).minute === 0 ? new Date(end.getTime() - 1) : end);
  const startHalfDay = from.minute >= 12 * 60;
  const endHalfDay = to.minute <= 12 * 60 && !(from.date === to.date && startHalfDay);
  return {
    instanceCode: String(instance.instance_code ?? ""),
    status: String(instance.status ?? ""),
    openId: instance.open_id || undefined,
    larkUserId: instance.user_id || undefined,
    leaveType: typeof value.name === "string" ? value.name : undefined,
    startDate: from.date,
    endDate: to.date,
    startHalfDay,
    endHalfDay
  };
}

export interface LeaveSyncResult {
  status: "sent" | "disabled" | "failed";
  detail: string;
  read: number;
  upserted: number;
  cancelled: number;
  /** Approved leave whose Lark user has no linked account here. */
  unmatched: number;
  syncedAt: string;
}

/**
 * Reads the instances of the leave Approval created in the look-back window and mirrors them: APPROVED → upsert by
 * instance code; an instance that is no longer approved (withdrawn, deleted) → its row becomes "cancelled".
 * ponytail: an approved leave withdrawn after it left the window stays; widen LARK_LEAVE_SYNC_LOOKBACK_DAYS or
 * subscribe to the approval_instance event if that happens in practice.
 */
export async function syncPersonalLeave(prisma: any, lark: LarkTransportLike, workspaceId: string, options: { approvalCode?: string; lookbackDays?: number; now?: Date } = {}): Promise<LeaveSyncResult> {
  const now = options.now ?? new Date();
  const result: LeaveSyncResult = { status: "sent", detail: "", read: 0, upserted: 0, cancelled: 0, unmatched: 0, syncedAt: now.toISOString() };
  const ctx = { workspaceId, bot: "Lịch nghỉ", target: "Lark Approval nghỉ phép" };
  const finish = async (status: LeaveSyncResult["status"], detail: string) => {
    Object.assign(result, { status, detail });
    await lark.record({ ...ctx, action: "leave_sync", status, detail });
    return result;
  };
  const approvalCode = options.approvalCode?.trim();
  if (!approvalCode) return finish("disabled", "chưa cấu hình mã Approval nghỉ phép (LARK_LEAVE_APPROVAL_CODE)");

  const codes = await listApprovalInstanceCodes(lark, { approvalCode, from: new Date(now.getTime() - (options.lookbackDays ?? 60) * DAY_MS), to: now }, ctx);
  if (codes.status !== "sent") return finish(codes.status, codes.detail);

  const workspace = await prisma.tenantWorkspace.findUnique({ where: { id: workspaceId }, select: { tenantKey: true } });
  for (const code of codes.data ?? []) {
    const detail = await getApprovalInstance(lark, code, ctx);
    if (detail.status !== "sent") return finish(detail.status, `${detail.detail} (đơn ${code}; đã đọc ${result.read} đơn)`);
    result.read += 1;
    const leave = parseLeaveInstance({ instance_code: code, ...detail.data });
    if (!leave) continue;
    if (leave.status !== "APPROVED") {
      const closed = await prisma.personalLeave.updateMany({ where: { workspaceId, sourceInstanceId: code, status: "approved" }, data: { status: "cancelled", syncedAt: now } });
      result.cancelled += closed.count;
      continue;
    }
    const identity = await prisma.portalIdentity.findFirst({
      where: { tenantKey: workspace?.tenantKey, OR: [...(leave.openId ? [{ provider: "lark", providerUserId: leave.openId }] : []), ...(leave.larkUserId ? [{ provider: "lark_user_id", providerUserId: leave.larkUserId }] : [])] },
      select: { userId: true }
    });
    if (!identity) {
      result.unmatched += 1;
      continue;
    }
    const data = {
      userId: identity.userId, startDate: new Date(`${leave.startDate}T00:00:00.000Z`), endDate: new Date(`${leave.endDate}T00:00:00.000Z`),
      startHalfDay: leave.startHalfDay, endHalfDay: leave.endHalfDay, leaveType: leave.leaveType ?? null, status: "approved", syncedAt: now
    };
    await prisma.personalLeave.upsert({ where: { workspaceId_sourceInstanceId: { workspaceId, sourceInstanceId: code } }, create: { workspaceId, sourceInstanceId: code, source: "lark_approval", ...data }, update: data });
    result.upserted += 1;
  }
  return finish("sent", `đã đọc ${result.read} đơn: ${result.upserted} đơn đã duyệt, ${result.cancelled} đơn huỷ, ${result.unmatched} đơn chưa khớp tài khoản`);
}
