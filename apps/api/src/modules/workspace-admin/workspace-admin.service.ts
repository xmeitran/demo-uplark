import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHmac, randomUUID } from "node:crypto";
import type {
  AdminAlertDetailRow,
  AdminAlertType,
  AdminOverviewAlert,
  PrincipalContext,
  SendWorkspaceReminderInput,
  SendWorkspaceReminderResponse,
  UpdateWorkspaceReminderPolicyInput,
  WorkspaceReminderPolicy,
  WorkspaceReminderRecipientsResponse,
  WorkspaceReminderSlot,
  WorkspaceReminderSlotCode
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";

const ADMIN_ROLES = new Set(["FOUNDER_GM", "WORKSPACE_ADMIN"]);
const SLOT_LABELS: Record<WorkspaceReminderSlot["slot"], string> = {
  morning_plan: "Kế hoạch đầu ngày",
  pm_follow_up: "Nhắc lại cho PM",
  evening_actual: "Actual Hour cuối ngày"
};
const DEFAULT_SLOTS: WorkspaceReminderSlot[] = [
  { slot: "morning_plan", time: "08:30", label: SLOT_LABELS.morning_plan, enabled: true },
  { slot: "pm_follow_up", time: "14:00", label: SLOT_LABELS.pm_follow_up, enabled: true },
  { slot: "evening_actual", time: "17:00", label: SLOT_LABELS.evening_actual, enabled: true }
];
const TERMINAL_TASK_STATUSES = ["completed", "done", "cancelled", "closed"];
const WAITING_TASK_STATUSES = new Set(["blocked", "waiting", "on_hold", "on-hold"]);
const ACTUAL_ENTRY_STATUSES = new Set(["approved", "submitted"]);

function assertAdmin(principal: PrincipalContext) {
  if (principal.subjectType !== "internal_user" || !principal.roleCodes.some((role) => ADMIN_ROLES.has(role))) {
    throw new ForbiddenException("Founder/GM or Workspace Admin role is required");
  }
}

function localDateKey() {
  const date = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function dateOnly(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function validateLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(dateOnly(value).getTime()) || dateOnly(value).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException("Ngày gửi phải có định dạng YYYY-MM-DD");
  }
  return value;
}

function dayWindow(localDate: string) {
  const startAt = new Date(dateOnly(localDate).getTime() - 7 * 60 * 60 * 1000);
  return { startAt, endAt: new Date(startAt.getTime() + 24 * 60 * 60 * 1000) };
}

function appPublicOrigin() {
  return (process.env.PUBLIC_APP_URL ?? process.env.CRM_AUTH_PUBLIC_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
}

function reminderMinutesLabel(minutes: number) {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} giờ`;
}

function taskMissingFields(task: { assigneeUserId: string | null; plannedStartAt: Date | null; dueAt: Date | null; estimateMinutes: number }) {
  const fields: string[] = [];
  if (!task.assigneeUserId) fields.push("Người phụ trách");
  if (!task.plannedStartAt) fields.push("Ngày bắt đầu");
  if (!task.dueAt) fields.push("Hạn hoàn tất");
  if (!task.estimateMinutes || task.estimateMinutes <= 0) fields.push("Giờ ước tính");
  return fields;
}

function reminderWebhookConfig() {
  const raw = process.env.LARK_TASK_REMINDER_WEBHOOK_URL?.trim();
  if (!raw) throw new BadRequestException("Chưa cấu hình Lark custom-bot webhook trên worker.");
  let url: URL;
  try { url = new URL(raw); } catch { throw new BadRequestException("Lark webhook không hợp lệ."); }
  if (url.protocol !== "https:" || !["open.larksuite.com", "open.feishu.cn"].includes(url.hostname) || !url.pathname.startsWith("/open-apis/bot/v2/hook/")) {
    throw new BadRequestException("Lark webhook phải là URL custom-bot chính thức.");
  }
  return { url: url.toString(), secret: process.env.LARK_TASK_REMINDER_WEBHOOK_SECRET?.trim() || undefined };
}

function signedWebhookPayload(payload: Record<string, unknown>, secret?: string) {
  if (!secret) return payload;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign = createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
  return { timestamp, sign, ...payload };
}

async function postReminderWebhook(payload: Record<string, unknown>) {
  const config = reminderWebhookConfig();
  const response = await fetch(config.url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(signedWebhookPayload(payload, config.secret))
  });
  const body = await response.json().catch(() => ({})) as { code?: number; StatusCode?: number; msg?: string; StatusMessage?: string };
  if (!response.ok || (body.code !== undefined && body.code !== 0) || (body.StatusCode !== undefined && body.StatusCode !== 0)) {
    throw new BadRequestException(`Lark từ chối thông báo: ${body.msg ?? body.StatusMessage ?? `HTTP ${response.status}`}`);
  }
}

function directMessageConfig() {
  const appId = process.env.LARK_APP_ID?.trim();
  const appSecret = process.env.LARK_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  const baseUrl = (process.env.LARK_OPEN_API_BASE_URL?.trim() || "https://open.larksuite.com").replace(/\/$/, "");
  return { appId, appSecret, baseUrl };
}

async function fetchTenantAccessToken(config: NonNullable<ReturnType<typeof directMessageConfig>>) {
  const response = await fetch(`${config.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret })
  });
  const body = await response.json().catch(() => ({})) as { code?: number; msg?: string; tenant_access_token?: string };
  if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
    throw new BadRequestException(`Không lấy được Lark tenant access token: ${body.msg ?? `HTTP ${response.status}`}`);
  }
  return body.tenant_access_token;
}

async function postReminderDirectMessage(
  config: NonNullable<ReturnType<typeof directMessageConfig>>,
  tenantAccessToken: string,
  receiveId: string,
  receiveIdType: "email" | "open_id",
  payload: Record<string, unknown>
) {
  const response = await fetch(`${config.baseUrl}/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tenantAccessToken}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: "interactive",
      content: JSON.stringify((payload as { card?: unknown }).card ?? payload)
    })
  });
  const body = await response.json().catch(() => ({})) as { code?: number; msg?: string };
  if (!response.ok || (body.code !== undefined && body.code !== 0)) {
    throw new BadRequestException(`Lark không gửi được tin nhắn tới người nhận đã chọn: ${body.msg ?? `HTTP ${response.status}`}`);
  }
}

async function resolveLarkOpenIdByEmail(
  config: NonNullable<ReturnType<typeof directMessageConfig>>,
  tenantAccessToken: string,
  email: string
) : Promise<string | null> {
  const response = await fetch(`${config.baseUrl}/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tenantAccessToken}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ emails: [email] })
  });
  // Lark's `batch_get_id` response calls the identifier `user_id` even when
  // `user_id_type=open_id` is requested. Treat both shapes as valid so a
  // directory lookup can remap legacy identities to the current custom app.
  const body = await response.json().catch(() => ({})) as { code?: number; msg?: string; data?: { user_list?: Array<{ email?: string; open_id?: string; user_id?: string }> } };
  const match = body.data?.user_list?.find((user) => user.email === email) ?? body.data?.user_list?.[0];
  const openId = match?.open_id ?? match?.user_id;
  if (!response.ok || body.code !== 0) {
    throw new BadRequestException(`Không tra được Lark open_id từ email người nhận: ${body.msg ?? `HTTP ${response.status}`}`);
  }
  return openId ?? null;
}

async function resolveLarkOpenIdByUserId(
  config: NonNullable<ReturnType<typeof directMessageConfig>>,
  tenantAccessToken: string,
  userId: string
) : Promise<string | null> {
  const response = await fetch(`${config.baseUrl}/open-apis/contact/v3/users/${encodeURIComponent(userId)}?user_id_type=user_id`, {
    headers: { authorization: `Bearer ${tenantAccessToken}` }
  });
  const body = await response.json().catch(() => ({})) as {
    code?: number;
    msg?: string;
    data?: { user?: { open_id?: string; user_id?: string } };
  };
  if (body.code === 99992351 || body.code === 99992361) return null;
  if (!response.ok || body.code !== 0) {
    throw new BadRequestException(`Không tra được Lark open_id từ user_id người nhận: ${body.msg ?? `HTTP ${response.status}`}`);
  }
  return body.data?.user?.open_id ?? null;
}

const REMINDER_SLOT_TITLES: Record<WorkspaceReminderSlotCode, string> = {
  morning_plan: "Nhắc nhở hoàn tất kế hoạch Task trước 09:00",
  pm_follow_up: "Danh sách nhân sự chưa hoàn tất kế hoạch Task",
  evening_actual: "Cập nhật Actual Hour hôm nay"
};

function parseSlots(input: UpdateWorkspaceReminderPolicyInput["slots"]): WorkspaceReminderSlot[] {
  if (!Array.isArray(input) || input.length === 0) throw new BadRequestException("At least one reminder slot is required");
  const seen = new Set<string>();
  return input.map((item) => {
    if (!item || !(item.slot in SLOT_LABELS)) throw new BadRequestException("Unsupported reminder slot");
    if (seen.has(item.slot)) throw new BadRequestException("Reminder slots must be unique");
    seen.add(item.slot);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) throw new BadRequestException("Reminder time must use HH:mm");
    if (typeof item.enabled !== "boolean") throw new BadRequestException("Reminder enabled must be boolean");
    return { slot: item.slot, time: item.time, label: SLOT_LABELS[item.slot], enabled: item.enabled };
  });
}

function mapPolicy(record: { enabled: boolean; timezone: string; weekdaysOnly: boolean; slots: unknown; updatedAt?: Date | null }): WorkspaceReminderPolicy {
  const slots = Array.isArray(record.slots) ? record.slots : DEFAULT_SLOTS;
  return {
    enabled: record.enabled,
    timezone: record.timezone,
    weekdaysOnly: record.weekdaysOnly,
    slots: slots.map((slot) => {
      const item = slot as { slot?: string; time?: string; enabled?: boolean };
      const code = item.slot && item.slot in SLOT_LABELS ? item.slot as WorkspaceReminderSlot["slot"] : "morning_plan";
      return {
        slot: code,
        time: typeof item.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) ? item.time : DEFAULT_SLOTS.find((candidate) => candidate.slot === code)!.time,
        label: SLOT_LABELS[code],
        enabled: item.enabled !== false
      };
    }),
    updatedAt: record.updatedAt?.toISOString()
  };
}

function defaultPolicy(): WorkspaceReminderPolicy {
  return { enabled: true, timezone: "Asia/Ho_Chi_Minh", weekdaysOnly: true, slots: DEFAULT_SLOTS };
}

@Injectable()
export class WorkspaceAdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private policyRecord(principal: PrincipalContext) {
    return this.prisma.workspaceReminderPolicy.findUnique({ where: { workspaceId: principal.workspaceId } });
  }

  async overview(principal: PrincipalContext) {
    assertAdmin(principal);
    const workspace = await this.prisma.tenantWorkspace.findUnique({ where: { id: principal.workspaceId }, select: { id: true, name: true } });
    if (!workspace) throw new ForbiddenException("Workspace is not available");
    const today = dateOnly(localDateKey());
    const now = new Date();
    const [activeDayOffs, upcomingDayOffs, overdueTasks, openTasks, policy] = await Promise.all([
      this.prisma.workspaceDayOff.count({ where: { workspaceId: principal.workspaceId, isActive: true } }),
      this.prisma.workspaceDayOff.count({ where: { workspaceId: principal.workspaceId, isActive: true, date: { gte: today } } }),
      this.prisma.projectTask.count({ where: { workspaceId: principal.workspaceId, archivedAt: null, status: { notIn: TERMINAL_TASK_STATUSES }, dueAt: { lt: now } } }),
      this.prisma.projectTask.count({ where: { workspaceId: principal.workspaceId, archivedAt: null, status: { notIn: TERMINAL_TASK_STATUSES } } }),
      this.policyRecord(principal)
    ]);
    const reminderPolicy = policy ? mapPolicy(policy) : defaultPolicy();
    const alerts: AdminOverviewAlert[] = [];
    if (activeDayOffs === 0) alerts.push({ id: "day-off-missing", severity: "info", title: "Chưa có ngày nghỉ workspace", detail: "Đăng ký ngày lễ nhà nước hoặc ngày nghỉ nội bộ để Calendar và Timesheet loại ngày đó khỏi ngày làm việc.", href: "#day-offs" });
    if (overdueTasks > 0) alerts.push({ id: "overdue-tasks", severity: "warning", title: `${overdueTasks} task đã quá hạn`, detail: "Kiểm tra deadline, assignee và kế hoạch của các task đang mở.", href: "/admin#alerts" });
    if (!reminderPolicy.enabled) alerts.push({ id: "reminders-disabled", severity: "warning", title: "Lịch nhắc Lark đang tắt", detail: "Bật lịch nhắc sau khi đã cấu hình custom-bot webhook trên worker.", href: "#reminders" });
    if (alerts.length === 0) alerts.push({ id: "all-clear", severity: "info", title: "Workspace đang ổn định", detail: "Không có cảnh báo cần xử lý ngay trong phạm vi admin." });
    return {
      data: {
        workspace: { ...workspace, timezone: "Asia/Ho_Chi_Minh" },
        metrics: { activeDayOffs, upcomingDayOffs, overdueTasks, openTasks },
        alerts,
        reminderPolicy
      }
    };
  }

  async getReminderPolicy(principal: PrincipalContext) {
    assertAdmin(principal);
    const record = await this.policyRecord(principal);
    return { data: record ? mapPolicy(record) : defaultPolicy() };
  }

  async reminderRecipients(principal: PrincipalContext): Promise<WorkspaceReminderRecipientsResponse> {
    assertAdmin(principal);
    const [teams, users] = await Promise.all([
      this.prisma.workspaceTeam.findMany({
        where: { workspaceId: principal.workspaceId, active: true },
        include: { _count: { select: { members: true } } },
        orderBy: { name: "asc" }
      }),
      this.prisma.user.findMany({
        where: { status: "ACTIVE", subjectType: "INTERNAL_USER" },
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
          departmentCode: true,
          roleBindings: {
            where: { endsAt: null },
            select: { role: { select: { code: true } } }
          },
          workspaceTeamMemberships: { where: { workspaceId: principal.workspaceId, effectiveTo: null }, select: { teamId: true } }
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }]
      })
    ]);
    return {
      data: {
        users: users.map((user) => ({
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          avatarUrl: user.avatarUrl ?? undefined,
          departmentCode: user.departmentCode ?? undefined,
          roleCodes: user.roleBindings.map((binding) => binding.role.code),
          teamIds: user.workspaceTeamMemberships.map((membership) => membership.teamId)
        })),
        teams: teams.map((team) => ({ id: team.id, name: team.name, memberCount: team._count.members }))
      }
    };
  }

  async sendReminder(input: SendWorkspaceReminderInput, principal: PrincipalContext): Promise<SendWorkspaceReminderResponse> {
    assertAdmin(principal);
    const localDate = validateLocalDate(input.localDate);
    if (!(input.slot in REMINDER_SLOT_TITLES)) throw new BadRequestException("Mốc nhắc Lark không hợp lệ.");
    if (input.userId && input.teamId) throw new BadRequestException("Chọn một người hoặc một team, không chọn đồng thời cả hai.");

    const workspace = await this.prisma.tenantWorkspace.findUnique({ where: { id: principal.workspaceId }, select: { tenantKey: true } });
    if (!workspace) throw new ForbiddenException("Workspace is not available");

    let scopedUserIds: string[] | undefined;
    if (input.userId) {
      const selected = await this.prisma.user.findFirst({ where: { id: input.userId, status: "ACTIVE", subjectType: "INTERNAL_USER" }, select: { id: true } });
      if (!selected) throw new BadRequestException("Người nhận không tồn tại hoặc đã bị khóa.");
      scopedUserIds = [selected.id];
    } else if (input.teamId) {
      const team = await this.prisma.workspaceTeam.findFirst({
        where: { id: input.teamId, workspaceId: principal.workspaceId, active: true },
        select: { id: true }
      });
      if (!team) throw new BadRequestException("Team không tồn tại trong workspace.");
      const memberships = await this.prisma.workspaceTeamMember.findMany({ where: { workspaceId: principal.workspaceId, teamId: team.id, effectiveTo: null }, select: { userId: true } });
      scopedUserIds = memberships.map((membership) => membership.userId);
    }

    const users = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        subjectType: "INTERNAL_USER",
        ...(scopedUserIds ? { id: { in: scopedUserIds } } : {}),
        projectMembers: { some: { workspaceId: principal.workspaceId, project: { status: { notIn: ["completed", "cancelled", "closed", "archived"] } } } }
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        identities: { where: { provider: { in: ["lark", "lark_user_id"] }, tenantKey: workspace.tenantKey }, select: { id: true, provider: true, providerUserId: true }, take: 10 }
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }]
    });
    if (!users.length) throw new BadRequestException("Không có nhân sự phù hợp bộ lọc hoặc chưa tham gia project active.");

    const { startAt, endAt } = dayWindow(localDate);
    const userIds = users.map((user) => user.id);
    const [tasks, planningBlocks, timeEntries] = await Promise.all([
      this.prisma.projectTask.findMany({
        where: {
          workspaceId: principal.workspaceId,
          archivedAt: null,
          status: { notIn: TERMINAL_TASK_STATUSES },
          OR: [{ assigneeUserId: { in: userIds } }, { assigneeUserId: null, ownerUserId: { in: userIds } }]
        },
        select: { id: true, title: true, assigneeUserId: true, ownerUserId: true, plannedStartAt: true, dueAt: true, estimateMinutes: true, project: { select: { name: true } } },
        orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }]
      }),
      this.prisma.taskPlanningBlock.findMany({ where: { workspaceId: principal.workspaceId, userId: { in: userIds }, status: { not: "cancelled" }, startAt: { lt: endAt }, endAt: { gt: startAt } }, select: { userId: true, taskId: true, plannedMinutes: true } }),
      this.prisma.taskTimeEntry.findMany({ where: { workspaceId: principal.workspaceId, userId: { in: userIds }, approvalStatus: { in: ["submitted", "approved", "done"] }, OR: [{ startAt: { gte: startAt, lt: endAt } }, { startAt: null, workDate: { gte: startAt, lt: endAt } }] }, select: { userId: true, taskId: true, minutes: true } })
    ]);

    const at = (openId?: string) => openId ? `<at id=${openId}></at> ` : "";
    const userFacts = users.map((user) => {
      const operationalTasks = tasks.filter((task) => (task.assigneeUserId ?? task.ownerUserId) === user.id);
      const userPlan = planningBlocks.filter((block) => block.userId === user.id);
      const userActual = timeEntries.filter((entry) => entry.userId === user.id);
      const actualMinutes = userActual.reduce((sum, entry) => sum + entry.minutes, 0);
      const taskById = new Map(operationalTasks.map((task) => [task.id, task]));
      const plannedTasks = userPlan.flatMap((block) => {
        const task = taskById.get(block.taskId);
        return task ? [task] : [];
      });
      const planIssues = plannedTasks.flatMap((task) => {
        const missingFields = taskMissingFields(task);
        return missingFields.length ? [{ task, missingFields }] : [];
      });
      const actualTaskIds = new Set(userActual.map((entry) => entry.taskId));
      const missingActualTasks = plannedTasks.filter((task) => !actualTaskIds.has(task.id));
      return { user, operationalTasks, userPlan, actualMinutes, planIssues, missingActualTasks };
    });
    const directDeliveryRequested = Boolean(input.userId || input.teamId);
    const renderUserLines = ({ user, operationalTasks, userPlan, actualMinutes, planIssues, missingActualTasks }: typeof userFacts[number]) => {
      const projects = [...new Set(operationalTasks.map((task) => task.project?.name).filter((name): name is string => Boolean(name)))].join(", ") || "các Project đang active";
      // Legacy open_ids are scoped to the previous Lark app. Do not embed them
      // in a card sent by the custom app; an unresolved recipient falls back to
      // email delivery below and the card should remain valid without a stale
      // cross-app mention.
      const mention = directDeliveryRequested ? "" : at(user.identities[0]?.providerUserId);
      if (input.slot === "pm_follow_up") {
        const taskNames = planIssues.length ? planIssues.slice(0, 3).map(({ task }) => task.title).join(", ") : "Chưa có Task";
        const missingFields = planIssues.length ? [...new Set(planIssues.flatMap(({ missingFields }) => missingFields))].join(", ") : "Chưa lập kế hoạch Task";
        return [
          `1. **${user.displayName}**`,
          `• Trạng thái: ${userPlan.length ? "Kế hoạch chưa đủ dữ liệu" : "Chưa có kế hoạch"}`,
          `• Task liên quan: ${taskNames}`,
          `• Nội dung còn thiếu: ${missingFields}`,
          "• Lần nhắc tự động: 08:30"
        ];
      }
      if (input.slot === "evening_actual") {
        const missingMinutes = Math.max(0, 480 - actualMinutes);
        return [
          `${mention}Chào **${user.displayName}**,`,
          `Đến 17:00 ngày ${localDate}, dữ liệu Actual Hour của bạn chưa đầy đủ.`,
          "Tổng giờ trong ngày:",
          `• Đã ghi nhận: ${reminderMinutesLabel(actualMinutes)}`,
          "• Giờ tiêu chuẩn: 8 giờ",
          `• Còn thiếu: ${reminderMinutesLabel(missingMinutes)}`,
          "",
          "Task chưa có Actual Hour:",
          ...(missingActualTasks.length ? missingActualTasks.slice(0, 5).map((task, index) => `${index + 1}. **${task.title}**${task.project?.name ? ` · ${task.project.name}` : ""}\n— Estimate Hour: ${reminderMinutesLabel(task.estimateMinutes)}`) : ["• Không có Task nào thiếu Actual Hour; vui lòng bổ sung đủ giờ trong ngày."]),
          `Vui lòng ghi Actual Hour thực tế đã làm trong ngày. Không tự động sử dụng Estimate Hour thay cho Actual Hour; chuyển Task sang Hoàn tất cũng không thay thế việc ghi giờ. Trường hợp có OT, số giờ vượt 8 giờ chỉ được ghi nhận theo quy tắc đã được phê duyệt.`
        ];
      }
      return [
        `${mention}Chào **${user.displayName}**,`,
        `Đến 08:30 ngày ${localDate}, kế hoạch Task của các Project ${projects} hôm nay của bạn chưa đầy đủ.`,
        "Nội dung cần bổ sung:",
        ...(userPlan.length ? (planIssues.length ? planIssues.slice(0, 5).map(({ task, missingFields }) => `• **${task.title}**${task.project?.name ? ` · ${task.project.name}` : ""} — còn thiếu: ${missingFields.join(", ")}.`) : ["• Kế hoạch đã đủ trường bắt buộc."]) : ["• Bạn chưa lập Task cho ngày hôm nay."]),
        "Vui lòng hoàn tất kế hoạch Task trước 09:00 hôm nay để bảo đảm dữ liệu kế hoạch được ghi nhận đầy đủ."
      ];
    };
    const origin = appPublicOrigin();
    const manualButton = input.slot === "morning_plan"
      ? { text: "Cập nhật kế hoạch Task", url: origin + "/calendar?date=" + encodeURIComponent(localDate) }
      : input.slot === "pm_follow_up"
        ? { text: "Xem Timesheet", url: origin + "/timesheet?view=daily&date=" + encodeURIComponent(localDate) }
        : { text: "Mở Timesheet hôm nay", url: origin + "/timesheet?view=daily&date=" + encodeURIComponent(localDate) };
    const buildPayload = (facts: typeof userFacts) => {
      const lines = facts.flatMap(renderUserLines);
      const pmActions = input.slot === "pm_follow_up"
        ? facts.flatMap(({ user }) => [{ tag: "action", actions: [
          { tag: "button", type: "primary", text: { tag: "plain_text", content: "Gửi nhắc" }, url: origin + "/admin?tab=reminders&scope=user&userId=" + encodeURIComponent(user.id) + "&date=" + encodeURIComponent(localDate) },
          { tag: "button", type: "default", text: { tag: "plain_text", content: "Xem Timesheet" }, url: origin + "/timesheet?view=daily&date=" + encodeURIComponent(localDate) + "&userId=" + encodeURIComponent(user.id) }
        ] }])
        : [];
      return {
        msg_type: "interactive",
        card: {
          config: { wide_screen_mode: true },
          header: { template: input.slot === "evening_actual" ? "red" : input.slot === "pm_follow_up" ? "orange" : "blue", title: { tag: "plain_text", content: REMINDER_SLOT_TITLES[input.slot] } },
          elements: [
            { tag: "div", text: { tag: "lark_md", content: [`**Ngày:** ${localDate}`, `**Người nhận:** ${facts.length}`, "", ...lines].join("\n") } },
            ...pmActions,
            { tag: "hr" },
            { tag: "note", elements: [{ tag: "plain_text", content: "Thông báo được gửi thủ công từ Admin workspace; ngày off/ngày lễ và dữ liệu đã hoàn tất vẫn được loại trừ theo nghiệp vụ." }] },
            ...(input.slot === "pm_follow_up" ? [] : [{ tag: "action", actions: [{ tag: "button", type: "primary", text: { tag: "plain_text", content: manualButton.text }, url: manualButton.url }] }])
          ]
        }
      };
    };
    const payload = buildPayload(userFacts);
    if (directDeliveryRequested) {
      const config = directMessageConfig();
      if (!config) throw new BadRequestException("Chưa cấu hình LARK_APP_ID/LARK_APP_SECRET để gửi tin nhắn riêng. Không dùng webhook group cho lựa chọn Một người/Team.");
      const missingIdentity = users.find((user) => !user.email && !user.identities[0]?.providerUserId);
      if (missingIdentity) throw new BadRequestException(`Người nhận ${missingIdentity.displayName} chưa có email workspace hoặc Lark open_id, không thể gửi tin nhắn riêng.`);
      const tenantAccessToken = await fetchTenantAccessToken(config);
      for (const fact of userFacts) {
        let resolvedOpenId = fact.user.email
          ? await resolveLarkOpenIdByEmail(config, tenantAccessToken, fact.user.email)
          : null;
        // The CRM may still hold a tenant User ID (for example HCM273) while
        // the directory email has changed. Resolve that tenant ID to the
        // custom app's current Open ID before sending the direct message.
        if (!resolvedOpenId) {
          const legacyUserId = fact.user.identities.find((identity) => identity.provider === "lark_user_id")?.providerUserId;
          if (legacyUserId) resolvedOpenId = await resolveLarkOpenIdByUserId(config, tenantAccessToken, legacyUserId);
        }
        if (resolvedOpenId && !fact.user.identities.some((identity) => identity.provider === "lark" && identity.providerUserId === resolvedOpenId)) {
          const larkIdentity = fact.user.identities.find((identity) => identity.provider === "lark");
          if (larkIdentity) {
            await this.prisma.portalIdentity.update({ where: { id: larkIdentity.id }, data: { providerUserId: resolvedOpenId } });
          } else {
            await this.prisma.portalIdentity.create({ data: { userId: fact.user.id, provider: "lark", providerUserId: resolvedOpenId, tenantKey: workspace.tenantKey } });
          }
        }
        // Never send an email fallback when the custom app cannot resolve the
        // recipient. Lark's message API may accept `email` in some tenants,
        // but in this workspace it returns `invalid receive_id`; using an old
        // app-scoped open_id is also invalid for the current custom app.
        if (fact.user.email && !resolvedOpenId) {
          throw new BadRequestException(
            `Người nhận ${fact.user.displayName} chưa được liên kết với custom app Lark hiện tại (${fact.user.email}). ` +
            "Không thể dùng Open ID cũ của app trước; hãy xác minh email Lark workspace hoặc liên kết lại tài khoản."
          );
        }
        const receiveId = resolvedOpenId;
        const receiveIdType = "open_id" as const;
        if (!receiveId) throw new BadRequestException(`Người nhận ${fact.user.displayName} chưa có email workspace hoặc Lark open_id, không thể gửi tin nhắn riêng.`);
        await postReminderDirectMessage(config, tenantAccessToken, receiveId, receiveIdType, buildPayload([fact]));
      }
    } else {
      await postReminderWebhook(payload);
    }
    const conditionKey = `manual:${randomUUID()}`;
    await this.prisma.reminderDeliveryLog.createMany({
      data: users.map((user) => ({
        workspaceId: principal.workspaceId,
        localDate: dateOnly(localDate),
        moment: input.slot,
        userId: user.id,
        missingType: "manual",
        conditionKey,
        channel: "lark",
        deliveryStatus: "SENT",
        attemptCount: 1,
        payload: { slot: input.slot, scope: input.userId ? "user" : input.teamId ? "team" : "all" },
        lastAttemptAt: new Date(),
        sentAt: new Date()
      }))
    });
    return { data: { sent: true, localDate, slot: input.slot, recipientCount: users.length, recipientNames: users.map((user) => user.displayName) } };
  }

  async alerts(principal: PrincipalContext) {
    assertAdmin(principal);
    const now = new Date();
    const projects = await this.prisma.project.findMany({
      where: { workspaceId: principal.workspaceId },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        tasks: {
          where: { workspaceId: principal.workspaceId, archivedAt: null },
          select: {
            id: true,
            status: true,
            dueAt: true,
            estimateMinutes: true,
            ownerUserId: true,
            assigneeUserId: true,
            timeEntries: { select: { minutes: true, approvalStatus: true } }
          }
        }
      }
    });
    const rows: AdminAlertDetailRow[] = [];
    const add = (project: typeof projects[number], type: AdminAlertType, severity: AdminAlertDetailRow["severity"], detail: string, taskIds: string[], estimateMinutes: number, actualMinutes: number) => {
      if (!taskIds.length) return;
      rows.push({
        id: `alert_${project.id}_${type}`,
        type,
        severity,
        project: { id: project.id, code: project.code, name: project.name },
        estimateMinutes,
        actualMinutes,
        varianceMinutes: actualMinutes - estimateMinutes,
        affectedTaskCount: taskIds.length,
        detail,
        taskIds,
        href: `/projects/${project.id}?tab=Tasks`
      });
    };
    for (const project of projects) {
      const tasks = project.tasks;
      const estimateMinutes = tasks.reduce((sum, task) => sum + Math.max(0, task.estimateMinutes ?? 0), 0);
      const actualMinutes = tasks.reduce((sum, task) => sum + task.timeEntries.reduce((entries, entry) => entries + (ACTUAL_ENTRY_STATUSES.has(entry.approvalStatus) ? entry.minutes : 0), 0), 0);
      const openTasks = tasks.filter((task) => !TERMINAL_TASK_STATUSES.includes(task.status.toLowerCase()));
      const overdue = openTasks.filter((task) => task.dueAt && task.dueAt < now);
      const waiting = openTasks.filter((task) => WAITING_TASK_STATUSES.has(task.status.toLowerCase()));
      const missingEstimate = openTasks.filter((task) => !task.estimateMinutes || task.estimateMinutes <= 0);
      const startedWithoutActual = openTasks.filter((task) => ["in_progress", "active", "started", "completed"].includes(task.status.toLowerCase()) && !task.timeEntries.some((entry) => ACTUAL_ENTRY_STATUSES.has(entry.approvalStatus)));
      const missingDeadline = openTasks.filter((task) => !task.dueAt);
      const missingMapping = openTasks.filter((task) => !task.ownerUserId && !task.assigneeUserId);
      if (overdue.length) add(project, "delay_risk", overdue.length >= 10 ? "critical" : "warning", `${overdue.length} task chưa hoàn thành đã quá Deadline.`, overdue.map((task) => task.id), estimateMinutes, actualMinutes);
      if (actualMinutes > estimateMinutes && estimateMinutes > 0) add(project, "over_estimate", actualMinutes - estimateMinutes > estimateMinutes * 0.2 ? "critical" : "warning", `Actual Hour đang cao hơn Estimate ${(actualMinutes - estimateMinutes) / 60}h; cần xem task gây vượt.`, tasks.map((task) => task.id), estimateMinutes, actualMinutes);
      if (waiting.length) add(project, "waiting_task", "warning", `${waiting.length} task đang chờ; cần cập nhật blocker và người xử lý.`, waiting.map((task) => task.id), estimateMinutes, actualMinutes);
      if (missingEstimate.length) add(project, "missing_estimate", "info", `${missingEstimate.length} task chưa có Estimate Hour; chưa đủ căn cứ đánh giá hiệu suất.`, missingEstimate.map((task) => task.id), estimateMinutes, actualMinutes);
      if (startedWithoutActual.length) add(project, "missing_actual", "info", `${startedWithoutActual.length} task đã bắt đầu nhưng chưa có Actual Hour đã ghi nhận.`, startedWithoutActual.map((task) => task.id), estimateMinutes, actualMinutes);
      if (missingDeadline.length) add(project, "missing_deadline", "info", `${missingDeadline.length} task đang mở chưa có Deadline để kiểm soát tiến độ.`, missingDeadline.map((task) => task.id), estimateMinutes, actualMinutes);
      if (missingMapping.length) add(project, "missing_mapping", "info", `${missingMapping.length} task chưa có người phụ trách; cần cập nhật owner hoặc assignee.`, missingMapping.map((task) => task.id), estimateMinutes, actualMinutes);
    }
    const severityRank = { critical: 0, warning: 1, info: 2 } as const;
    rows.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.affectedTaskCount - a.affectedTaskCount || a.project.name.localeCompare(b.project.name));
    const counts = rows.reduce<Partial<Record<AdminAlertType, number>>>((acc, row) => { acc[row.type] = (acc[row.type] ?? 0) + 1; return acc; }, {});
    return { data: rows, meta: { total: rows.length, generatedAt: new Date().toISOString(), counts } };
  }

  async updateReminderPolicy(input: UpdateWorkspaceReminderPolicyInput, principal: PrincipalContext) {
    assertAdmin(principal);
    const slots = parseSlots(input.slots);
    const enabled = input.enabled ?? true;
    const weekdaysOnly = input.weekdaysOnly ?? true;
    const updated = await this.prisma.workspaceReminderPolicy.upsert({
      where: { workspaceId: principal.workspaceId },
      create: {
        id: `wrp_${randomUUID()}`,
        workspaceId: principal.workspaceId,
        enabled,
        weekdaysOnly,
        timezone: "Asia/Ho_Chi_Minh",
        slots: slots as unknown as Prisma.InputJsonValue,
        updatedByUserId: principal.subjectId
      },
      update: {
        enabled,
        weekdaysOnly,
        slots: slots as unknown as Prisma.InputJsonValue,
        updatedByUserId: principal.subjectId
      }
    });
    await this.prisma.auditEvent.create({
      data: {
        workspaceId: principal.workspaceId,
        actorUserId: principal.subjectId,
        action: "workspace.reminder_policy_updated",
        resource: "workspace_reminder_policy",
        resourceId: updated.id,
        before: Prisma.JsonNull,
        after: { enabled, weekdaysOnly, slots: slots as unknown as Prisma.InputJsonValue },
        requestId: randomUUID()
      }
    });
    return { data: mapPolicy(updated) };
  }
}
