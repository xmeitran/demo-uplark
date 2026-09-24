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

const REMINDER_SLOT_TITLES: Record<WorkspaceReminderSlotCode, string> = {
  morning_plan: "Kế hoạch đầu ngày",
  pm_follow_up: "Nhắc lại cho PM",
  evening_actual: "Actual Hour cuối ngày"
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
          displayName: true,
          workspaceTeamMemberships: { where: { workspaceId: principal.workspaceId, effectiveTo: null }, select: { teamId: true } }
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }]
      })
    ]);
    return {
      data: {
        users: users.map((user) => ({ id: user.id, displayName: user.displayName, teamIds: user.workspaceTeamMemberships.map((membership) => membership.teamId) })),
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
        identities: { where: { provider: "lark", tenantKey: workspace.tenantKey }, select: { providerUserId: true }, take: 1 }
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
    const lines = users.map((user) => {
      const operationalTasks = tasks.filter((task) => (task.assigneeUserId ?? task.ownerUserId) === user.id);
      const userPlan = planningBlocks.filter((block) => block.userId === user.id);
      const userActual = timeEntries.filter((entry) => entry.userId === user.id);
      const actualMinutes = userActual.reduce((sum, entry) => sum + entry.minutes, 0);
      const missingEstimate = operationalTasks.filter((task) => !task.estimateMinutes || task.estimateMinutes <= 0).length;
      const detail = input.slot === "evening_actual"
        ? `đã ghi ${Math.round(actualMinutes / 6) / 10}h / 8h, ${userPlan.length} task có kế hoạch`
        : input.slot === "pm_follow_up"
          ? `${userPlan.length} task có kế hoạch, ${missingEstimate} task thiếu Estimate Hour`
          : `${userPlan.length} task có kế hoạch, ${operationalTasks.length} task đang mở`;
      return `• ${at(user.identities[0]?.providerUserId)}**${user.displayName}**: ${detail}.`;
    });
    const payload = {
      msg_type: "interactive",
      card: {
        config: { wide_screen_mode: true },
        header: { template: input.slot === "evening_actual" ? "red" : input.slot === "pm_follow_up" ? "orange" : "blue", title: { tag: "plain_text", content: `${REMINDER_SLOT_TITLES[input.slot]} · gửi thủ công` } },
        elements: [
          { tag: "div", text: { tag: "lark_md", content: [`**Ngày:** ${localDate}`, `**Người nhận:** ${users.length}`, "", ...lines].join("\n") } },
          { tag: "hr" },
          { tag: "note", elements: [{ tag: "plain_text", content: "Thông báo được gửi thủ công từ Admin workspace." }] }
        ]
      }
    };
    await postReminderWebhook(payload);
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
