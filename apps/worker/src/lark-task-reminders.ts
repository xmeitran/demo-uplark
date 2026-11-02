import { createHmac, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  CLOSED_TASK_STATUSES,
  REMINDER_INACTIVE_PROJECT_STATUSES,
  dueReminderSlots,
  findPlanIssues,
  getVietnamWorkdayWindow,
  isWorkingDay,
  normalizeReminderSchedule,
  TASK_REMINDER_SCHEDULE,
  type PlanReminderIssue,
  type ReminderUserFacts,
  businessRole,
  type TaskReminderSlot,
  type VietnamWorkdayWindow
} from "./task-reminder-rules.js";
import { deliverReminder, directMessageConfigFromEnv, loadLeaveMinutes, type DirectMessageConfig } from "./lark-direct-message.js";

type RedisLike = {
  get: (key: string) => Promise<string | null>;
  set: (...args: any[]) => Promise<unknown>;
  eval: (...args: any[]) => Promise<unknown>;
};

export type TaskReminderConfig = {
  enabled: boolean;
  workspaceId: string;
  webhookUrl: string;
  webhookSecret?: string;
  publicAppUrl: string;
  targetMinutes: number;
  catchUpMinutes: number;
  pollIntervalMs: number;
  startupDelayMs: number;
  excludedDates: Set<string>;
  includedUserIds: Set<string>;
  pmOpenIds: string[];
  /** Set when LARK_MESSAGING_ENABLED=true and the app credentials exist: reminders go as private messages. */
  directMessage?: DirectMessageConfig;
};

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function csv(value?: string) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function validateWebhookUrl(raw: string) {
  const url = new URL(raw);
  const allowedHosts = new Set(["open.larksuite.com", "open.feishu.cn"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || !url.pathname.startsWith("/open-apis/bot/v2/hook/")) {
    throw new Error("LARK_TASK_REMINDER_WEBHOOK_URL must be an official Lark/Feishu custom-bot HTTPS webhook.");
  }
  return url.toString();
}

function validatePublicAppUrl(raw: string) {
  const url = new URL(raw);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("PUBLIC_APP_URL must use HTTP or HTTPS.");
  return url.toString().replace(/\/$/, "");
}

export function taskReminderConfigFromEnv(env: NodeJS.ProcessEnv): TaskReminderConfig {
  const enabled = env.LARK_TASK_REMINDER_ENABLED === "true";
  if (!enabled) {
    return {
      enabled,
      workspaceId: "",
      webhookUrl: "",
      publicAppUrl: "",
      targetMinutes: 480,
      catchUpMinutes: 60,
      pollIntervalMs: 30_000,
      startupDelayMs: 5_000,
      excludedDates: new Set(),
      includedUserIds: new Set(),
      pmOpenIds: []
    };
  }

  const workspaceId = env.LARK_TASK_REMINDER_WORKSPACE_ID?.trim();
  const webhookUrl = env.LARK_TASK_REMINDER_WEBHOOK_URL?.trim();
  const publicAppUrl = (env.PUBLIC_APP_URL ?? env.PUBLIC_WEB_URL)?.trim();
  const directMessage = directMessageConfigFromEnv(env);
  if (!workspaceId) throw new Error("LARK_TASK_REMINDER_WORKSPACE_ID is required when task reminders are enabled.");
  // Private messages (LARK_MESSAGING_ENABLED) need no group: the webhook is then only the fallback, and optional.
  if (!webhookUrl && !directMessage) throw new Error("LARK_TASK_REMINDER_WEBHOOK_URL is required when task reminders are enabled without LARK_MESSAGING_ENABLED.");
  if (!publicAppUrl) throw new Error("PUBLIC_APP_URL or PUBLIC_WEB_URL is required when task reminders are enabled.");

  return {
    enabled,
    workspaceId,
    webhookUrl: webhookUrl ? validateWebhookUrl(webhookUrl) : "",
    webhookSecret: env.LARK_TASK_REMINDER_WEBHOOK_SECRET?.trim() || undefined,
    publicAppUrl: validatePublicAppUrl(publicAppUrl),
    targetMinutes: positiveInteger(env.LARK_TASK_REMINDER_TARGET_MINUTES, 480, "LARK_TASK_REMINDER_TARGET_MINUTES"),
    catchUpMinutes: positiveInteger(env.LARK_TASK_REMINDER_CATCH_UP_MINUTES, 60, "LARK_TASK_REMINDER_CATCH_UP_MINUTES"),
    pollIntervalMs: positiveInteger(env.LARK_TASK_REMINDER_POLL_INTERVAL_MS, 30_000, "LARK_TASK_REMINDER_POLL_INTERVAL_MS"),
    startupDelayMs: positiveInteger(env.LARK_TASK_REMINDER_STARTUP_DELAY_MS, 5_000, "LARK_TASK_REMINDER_STARTUP_DELAY_MS"),
    excludedDates: new Set(csv(env.LARK_TASK_REMINDER_EXCLUDED_DATES)),
    includedUserIds: new Set(csv(env.LARK_TASK_REMINDER_USER_IDS)),
    pmOpenIds: csv(env.LARK_TASK_REMINDER_PM_OPEN_IDS),
    directMessage
  };
}

function at(openId?: string) {
  return openId ? `<at id=${openId}></at> ` : "";
}

/** Tags only in the group webhook; a private message is already addressed to the person. */
function mention(config: TaskReminderConfig, ...openIds: Array<string | undefined>) {
  return config.directMessage ? "" : openIds.map((openId) => at(openId)).join("");
}

function minutesLabel(minutes: number) {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} giờ`;
}

function calendarUrl(config: TaskReminderConfig, localDate: string) {
  return `${config.publicAppUrl}/calendar?date=${encodeURIComponent(localDate)}`;
}

/** "Gửi nhắc" on the PM card: the Admin page sends a private reminder to everyone still without a plan that day. */
function nudgeUnplannedUrl(config: TaskReminderConfig, localDate: string) {
  return `${config.publicAppUrl}/admin?${new URLSearchParams({ nudge: "unplanned", date: localDate }).toString()}`;
}

function clock(localMinute: number) {
  return `${String(Math.floor(localMinute / 60)).padStart(2, "0")}:${String(localMinute % 60).padStart(2, "0")}`;
}

function divider() {
  return { tag: "hr" };
}

function note(content: string) {
  return { tag: "note", elements: [{ tag: "plain_text", content }] };
}

function card(template: string, title: string, lines: string[], footer: string, button: { text: string; url: string }) {
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template, title: { tag: "plain_text", content: title } },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: lines.join("\n") } },
        divider(),
        note(footer),
        { tag: "action", actions: [{ tag: "button", type: "primary", text: { tag: "plain_text", content: button.text }, url: button.url }] }
      ]
    }
  };
}

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

/** "Thứ Hai, 02/11/2026" */
function dayLabel(localDate: string) {
  const [year, month, day] = localDate.split("-");
  return `${WEEKDAYS[new Date(`${localDate}T00:00:00Z`).getUTCDay()]}, ${day}/${month}/${year}`;
}

/** Today's planned Tasks, one line per Task (several blocks of one Task add up; done when every block is completed). */
function plannedTasks(fact: ReminderUserFacts) {
  const tasks = new Map<string, { title: string; projectName?: string; minutes: number; done: boolean }>();
  for (const block of fact.planningBlocks) {
    const task = tasks.get(block.taskId) ?? { title: block.taskTitle ?? "Task", projectName: block.projectName, minutes: 0, done: true };
    tasks.set(block.taskId, { ...task, minutes: task.minutes + block.plannedMinutes, done: task.done && block.status === "completed" });
  }
  return [...tasks.values()];
}

/** Đầu ngày, to everyone: plan today's Tasks; lists a planned Task that lacks a field. */
function planCard(config: TaskReminderConfig, fact: ReminderUserFacts, issue: PlanReminderIssue | undefined, localDate: string) {
  const fieldIssues = fact.planningBlocks.length ? issue?.taskFieldIssues ?? [] : [];
  const lines = [
    `${mention(config, fact.larkOpenId)}Chào **${fact.displayName}**,`,
    `Hôm nay, ${dayLabel(localDate)}, vui lòng lập kế hoạch các Task sẽ làm trong ngày và ghi giờ kế hoạch cho từng Task.`,
    ...(fieldIssues.length ? ["", "Task cần bổ sung thông tin:", ...fieldIssues.slice(0, 5).map((task) => `• **${task.taskTitle}**${task.projectName ? ` · ${task.projectName}` : ""} — còn thiếu: ${task.missingFields.join(", ")}`)] : []),
    ...(fieldIssues.length > 5 ? [`• Và ${fieldIssues.length - 5} Task khác.`] : [])
  ];
  return card("blue", "Lập kế hoạch Task hôm nay", lines, "Nhắc đầu ngày · gửi mọi người; ngày nghỉ và người nghỉ phép cả ngày được bỏ qua.", { text: "Lập kế hoạch hôm nay", url: calendarUrl(config, localDate) });
}

/**
 * Cuối ngày, to everyone. With a plan: finish the Tasks planned today (each with its project and status). Without one:
 * plan today's Tasks and finish them, so the day still gets its hours.
 */
function finishPlanCard(config: TaskReminderConfig, fact: ReminderUserFacts, targetMinutes: number, localDate: string) {
  const tasks = plannedTasks(fact);
  const actualMinutes = fact.timeEntries.reduce((total, entry) => total + entry.minutes, 0);
  const hours = `• Giờ thực tế đã ghi: ${minutesLabel(actualMinutes)} / ${minutesLabel(targetMinutes)}`;
  const note = "Nhắc cuối ngày · gửi mọi người; ngày nghỉ và người nghỉ phép cả ngày được bỏ qua.";
  const button = { text: "Mở Calendar hôm nay", url: calendarUrl(config, localDate) };
  if (!tasks.length) {
    return card("red", "Yêu cầu lập kế hoạch và hoàn thành Task hôm nay", [
      `${mention(config, fact.larkOpenId)}Chào **${fact.displayName}**,`,
      `Đến cuối ngày ${dayLabel(localDate)}, bạn chưa có kế hoạch Task nào trong ngày.`,
      "",
      "Vui lòng:",
      "1. Lập kế hoạch các Task đã làm hôm nay (Task, dự án và giờ kế hoạch).",
      "2. Bấm “Hoàn thành kế hoạch” cho từng Task để ghi giờ thực tế."
    ], note, { ...button, text: "Lập và hoàn thành kế hoạch" });
  }
  const open = tasks.filter((task) => !task.done);
  return card(open.length ? "orange" : "green", open.length ? "Hoàn thành Task hôm nay" : "Kế hoạch hôm nay đã hoàn thành", [
    `${mention(config, fact.larkOpenId)}Chào **${fact.displayName}**,`,
    open.length
      ? `Cuối ngày ${dayLabel(localDate)}, vui lòng hoàn thành các Task đã lập kế hoạch hôm nay và bấm “Hoàn thành kế hoạch” trên Calendar để ghi giờ thực tế.`
      : `Bạn đã hoàn thành toàn bộ kế hoạch ngày ${dayLabel(localDate)}. Cảm ơn bạn!`,
    "",
    "Task đã lập kế hoạch hôm nay:",
    ...tasks.slice(0, 8).map((task, index) => `${index + 1}. **${task.title}**${task.projectName ? ` · ${task.projectName}` : ""} — ${minutesLabel(task.minutes)} · ${task.done ? "Đã hoàn thành" : "**Chưa hoàn thành**"}`),
    ...(tasks.length > 8 ? [`Và ${tasks.length - 8} Task khác.`] : []),
    "",
    `• Còn ${open.length}/${tasks.length} Task chưa hoàn thành`,
    hours
  ], note, button);
}

/** Buổi trưa, to the PMs: who still has no plan today, and one button that reminds them a second time. */
function pmFollowUpCard(config: TaskReminderConfig, issues: PlanReminderIssue[], localDate: string, time: string, mentionOpenIds: string[]) {
  const lines = [
    `${mention(config, ...mentionOpenIds)}Chào PM,`,
    `Đến ${time}, ${dayLabel(localDate)}, có **${issues.length} nhân sự** chưa lập kế hoạch Task trong ngày:`,
    "",
    ...issues.map((issue, index) => `${index + 1}. **${issue.displayName}** · ${issue.role ?? "Chưa gán vai trò"}`),
    "",
    "Bấm “Gửi nhắc lần 2” để nhắc riêng những người vẫn chưa lập kế hoạch tại thời điểm bấm."
  ];
  return card("orange", "Nhân sự chưa lập kế hoạch Task hôm nay", lines, "Danh sách được kiểm tra lại khi bấm; mỗi người nhận nhắc lần 2 tối đa một lần mỗi ngày.", { text: "Gửi nhắc lần 2", url: nudgeUnplannedUrl(config, localDate) });
}

function signPayload(payload: Record<string, unknown>, secret?: string) {
  if (!secret) return payload;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = createHmac("sha256", stringToSign).update("").digest("base64");
  return { timestamp, sign, ...payload };
}

async function postWebhook(config: TaskReminderConfig, payload: Record<string, unknown>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(signPayload(payload, config.webhookSecret)),
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({})) as { code?: number; StatusCode?: number; msg?: string; StatusMessage?: string };
      if (!response.ok || (body.code !== undefined && body.code !== 0) || (body.StatusCode !== undefined && body.StatusCode !== 0)) {
        throw new Error(`Lark webhook rejected message: HTTP ${response.status}, code ${body.code ?? body.StatusCode ?? "unknown"}, message ${body.msg ?? body.StatusMessage ?? "unknown"}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

/** 7.5: a private message per person when Lark messaging is enabled; today's group webhook otherwise. */
async function send(options: { prisma: PrismaClient; config: TaskReminderConfig }, payload: Record<string, unknown>, openId?: string) {
  const logModel = (options.prisma as unknown as { larkDeliveryLog?: { create: (input: unknown) => Promise<unknown> } }).larkDeliveryLog;
  await deliverReminder({
    directMessage: options.config.directMessage, openId, payload,
    postWebhook: options.config.webhookUrl ? () => postWebhook(options.config, payload) : undefined,
    log: async (entry) => logModel?.create({ data: { workspaceId: options.config.workspaceId, bot: "Nhắc việc hằng ngày", action: "send_message", ...entry } })
  });
}

async function loadReminderFacts(prisma: PrismaClient, config: TaskReminderConfig, window: VietnamWorkdayWindow): Promise<ReminderUserFacts[]> {
  const workspace = await prisma.tenantWorkspace.findUnique({
    where: { id: config.workspaceId },
    select: { id: true, tenantKey: true, status: true }
  });
  if (!workspace || workspace.status !== "active") throw new Error("Task reminder workspace is missing or inactive.");

  const includedUserIds = [...config.includedUserIds];
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      subjectType: "INTERNAL_USER",
      ...(includedUserIds.length ? { id: { in: includedUserIds } } : {}),
      projectMembers: {
        some: {
          workspaceId: config.workspaceId,
          project: { status: { notIn: REMINDER_INACTIVE_PROJECT_STATUSES } }
        }
      }
    },
    select: {
      id: true,
      displayName: true,
      departmentCode: true,
      resourceProfile: { select: { displayRole: true } },
      roleBindings: { where: { workspaceId: config.workspaceId }, select: { role: { select: { code: true } } } },
      identities: {
        where: { provider: "lark", tenantKey: workspace.tenantKey },
        select: { providerUserId: true },
        take: 1
      },
      projectMembers: {
        where: { workspaceId: config.workspaceId, project: { status: { notIn: REMINDER_INACTIVE_PROJECT_STATUSES } } },
        select: { project: { select: { id: true, name: true } } }
      }
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }]
  });
  const userIds = users.map((user) => user.id);
  if (!userIds.length) return [];
  const pics = await projectPics(prisma, config.workspaceId, workspace.tenantKey, [...new Set(users.flatMap((user) => user.projectMembers.map((member) => member.project.id)))]);

  const [tasks, planningBlocks, timeEntries] = await Promise.all([
    prisma.projectTask.findMany({
      where: {
        workspaceId: config.workspaceId,
        archivedAt: null,
        status: { notIn: CLOSED_TASK_STATUSES },
        OR: [
          { assigneeUserId: { in: userIds } },
          { assigneeUserId: null, ownerUserId: { in: userIds } }
        ],
        // Work on an On Hold or completed project is not something to plan or chase today.
        AND: [{ OR: [{ projectId: null }, { project: { status: { notIn: REMINDER_INACTIVE_PROJECT_STATUSES } } }] }]
      },
      select: {
        id: true,
        title: true,
        assigneeUserId: true,
        ownerUserId: true,
        plannedStartAt: true,
        dueAt: true,
        estimateMinutes: true,
        project: { select: { name: true } }
      },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }]
    }),
    prisma.taskPlanningBlock.findMany({
      where: {
        workspaceId: config.workspaceId,
        userId: { in: userIds },
        status: { not: "cancelled" },
        startAt: { lt: window.endAt },
        endAt: { gt: window.startAt }
      },
      select: { userId: true, taskId: true, plannedMinutes: true, status: true, task: { select: { title: true, project: { select: { name: true } } } } }
    }),
    prisma.taskTimeEntry.findMany({
      where: {
        workspaceId: config.workspaceId,
        userId: { in: userIds },
        approvalStatus: { in: ["submitted", "approved", "done"] },
        OR: [
          { startAt: { gte: window.startAt, lt: window.endAt } },
          { startAt: null, workDate: { gte: window.startAt, lt: window.endAt } }
        ]
      },
      select: { userId: true, taskId: true, minutes: true }
    })
  ]);

  return users.map((user) => ({
    userId: user.id,
    displayName: user.displayName,
    // Lark custom webhooks only resolve an explicit person mention by open_id.
    larkOpenId: user.identities[0]?.providerUserId,
    role: businessRole({ displayRole: user.resourceProfile?.displayRole, departmentCode: user.departmentCode, roleCodes: user.roleBindings.map((binding) => binding.role.code) }),
    activeProjects: [...new Set(user.projectMembers.map((member) => member.project.name))],
    projectPms: [...new Map(user.projectMembers.flatMap((member) => {
      const pic = pics.get(member.project.id);
      return pic ? [[pic.userId, pic] as const] : [];
    })).values()],
    tasks: tasks.flatMap((task) => {
      const operationalUserId = task.assigneeUserId ?? task.ownerUserId;
      return operationalUserId === user.id ? [{
        id: task.id,
        title: task.title,
        projectName: task.project?.name,
        assigneeUserId: task.assigneeUserId ?? undefined,
        plannedStartAt: task.plannedStartAt ?? undefined,
        dueAt: task.dueAt ?? undefined,
        estimateMinutes: task.estimateMinutes
      }] : [];
    }),
    planningBlocks: planningBlocks.filter((block) => block.userId === user.id).map((block) => ({
      taskId: block.taskId,
      plannedMinutes: block.plannedMinutes,
      status: block.status,
      taskTitle: block.task.title,
      projectName: block.task.project?.name
    })),
    timeEntries: timeEntries.filter((entry) => entry.userId === user.id).map((entry) => ({ taskId: entry.taskId, minutes: entry.minutes }))
  }));
}

/** Each project's PIC, read as the API reads it (owner of the first stage), with their Lark open_id. */
async function projectPics(prisma: PrismaClient, workspaceId: string, tenantKey: string, projectIds: string[]) {
  const pics = new Map<string, { userId: string; larkOpenId?: string }>();
  if (!projectIds.length) return pics;
  const stages = await prisma.projectStage.findMany({
    where: { workspaceId, projectId: { in: projectIds } },
    orderBy: [{ milestone: { sortOrder: "asc" } }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { projectId: true, ownerUserId: true }
  });
  const firstOwner = new Map<string, string | null>();
  for (const stage of stages) if (!firstOwner.has(stage.projectId)) firstOwner.set(stage.projectId, stage.ownerUserId);
  const openIds = await larkOpenIds(prisma, tenantKey, [...new Set([...firstOwner.values()].filter((id): id is string => Boolean(id)))]);
  for (const [projectId, userId] of firstOwner) if (userId && openIds.has(userId)) pics.set(projectId, { userId, larkOpenId: openIds.get(userId) });
  return pics;
}

/** Active users' Lark open_id (undefined when they have none), keyed by user id. */
async function larkOpenIds(prisma: PrismaClient, tenantKey: string, userIds: string[]) {
  const users = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds }, status: "ACTIVE" },
    select: { id: true, identities: { where: { provider: "lark", tenantKey }, select: { providerUserId: true }, take: 1 } }
  }) : [];
  return new Map(users.map((user) => [user.id, user.identities[0]?.providerUserId]));
}

/**
 * Who gets "Nhắc lại cho PM": the PMs set on the server (LARK_TASK_REMINDER_PM_OPEN_IDS) receive every issue; without
 * them each project's PIC receives the people of their own projects ("phạm vi phụ trách của bạn"), never themselves.
 */
export function pmDeliveries(config: Pick<TaskReminderConfig, "pmOpenIds" | "directMessage">, facts: ReminderUserFacts[], issues: PlanReminderIssue[]) {
  if (config.pmOpenIds.length) {
    // Without private messages every send lands in the same group webhook (the card already tags every PM): send it once.
    const openIds = config.directMessage ? config.pmOpenIds : config.pmOpenIds.slice(0, 1);
    return openIds.map((openId) => ({ openId, mentionOpenIds: config.pmOpenIds, issues }));
  }
  const pmsByUser = new Map(facts.map((fact) => [fact.userId, fact.projectPms ?? []]));
  const byPm = new Map<string, PlanReminderIssue[]>();
  for (const issue of issues) {
    for (const pm of pmsByUser.get(issue.userId) ?? []) {
      if (!pm.larkOpenId || pm.userId === issue.userId) continue;
      const list = byPm.get(pm.larkOpenId) ?? [];
      if (!list.includes(issue)) byPm.set(pm.larkOpenId, [...list, issue]);
    }
  }
  return [...byPm].map(([openId, pmIssues]) => ({ openId, mentionOpenIds: [openId], issues: pmIssues }));
}

async function sendOnce(redis: RedisLike, key: string, send: () => Promise<void>) {
  if (await redis.get(`${key}:sent`)) return false;
  const ownerId = randomUUID();
  const lockKey = `${key}:lock`;
  const acquired = await redis.set(lockKey, ownerId, "PX", 60_000, "NX") === "OK";
  if (!acquired) return false;
  try {
    if (await redis.get(`${key}:sent`)) return false;
    await send();
    await redis.set(`${key}:sent`, "1", "EX", 8 * 24 * 60 * 60);
    return true;
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, lockKey, ownerId).catch(() => 0);
  }
}

/** "Giờ chuẩn một ngày" (Admin › Tham số), the same cap logging uses; LARK_TASK_REMINDER_TARGET_MINUTES is only the fallback. */
export async function workspaceTargetMinutes(prisma: PrismaClient, config: TaskReminderConfig): Promise<number> {
  const row = await (prisma as any).systemParameter?.findFirst?.({ where: { workspaceId: config.workspaceId, key: "standardDayHours" }, orderBy: { createdAt: "desc" }, select: { value: true } });
  const hours = Number(row?.value);
  return Number.isFinite(hours) && hours > 0 && hours <= 24 ? Math.round(hours * 60) : config.targetMinutes;
}

export async function runTaskReminderSlot(input: {
  prisma: PrismaClient;
  redis: RedisLike;
  config: TaskReminderConfig;
  slot: TaskReminderSlot;
  weekdaysOnly?: boolean;
  /** "Người nhận" of "Nhắc lại cho PM" in Admin › Nhắc Lark; they replace LARK_TASK_REMINDER_PM_OPEN_IDS. */
  pmUserIds?: string[];
  now?: Date;
}) {
  const options = { ...input, config: { ...input.config, targetMinutes: await workspaceTargetMinutes(input.prisma, input.config) } };
  const now = options.now ?? new Date();
  const window = getVietnamWorkdayWindow(now);
  if (!(await isWorkspaceWorkday(options.prisma, options.config, window, options.weekdaysOnly ?? true))) return { skipped: "non_working_day", sent: 0 };
  const prefix = `b2b-crm:task-reminder:${options.config.workspaceId}:${window.localDate}:${options.slot}`;
  if (await options.redis.get(`${prefix}:complete`)) return { skipped: "already_complete", sent: 0 };
  // D-09 / V-06: a person on approved leave for the whole day is not reminded; half a day off halves the day's target.
  const leave = await loadLeaveMinutes(options.prisma, options.config.workspaceId, window.localDate, options.config.targetMinutes);
  const facts = (await loadReminderFacts(options.prisma, options.config, window)).filter((user) => (leave.get(user.userId) ?? 0) < options.config.targetMinutes);
  let sent = 0;

  const unaddressable = facts.filter((fact) => !fact.larkOpenId).length;

  if (options.slot === "pm_follow_up") {
    // Only the people with no plan at all today are listed for the PMs.
    const issues = findPlanIssues(facts, window).filter((issue) => !issue.hasPlan);
    let pmConfig = options.config;
    if (options.pmUserIds?.length) {
      const workspace = await options.prisma.tenantWorkspace.findUnique({ where: { id: options.config.workspaceId }, select: { tenantKey: true } });
      const openIds = await larkOpenIds(options.prisma, workspace?.tenantKey ?? "", options.pmUserIds);
      // The PMs picked in Admin who have a Lark account; none of them reachable means nobody, not every project's PIC.
      pmConfig = { ...options.config, pmOpenIds: options.pmUserIds.flatMap((id) => openIds.get(id) ?? []) };
      if (!pmConfig.pmOpenIds.length) return { issues: issues.length, sent: 0, skipped: "pm_recipients_without_lark" };
    }
    for (const delivery of issues.length ? pmDeliveries(pmConfig, facts, issues) : []) {
      if (await sendOnce(options.redis, `${prefix}:pm:${delivery.openId}`, () => send(options, pmFollowUpCard(options.config, delivery.issues, window.localDate, clock(window.localMinute), delivery.mentionOpenIds), delivery.openId))) sent += 1;
    }
    await options.redis.set(`${prefix}:complete`, "1", "EX", 8 * 24 * 60 * 60);
    return { issues: issues.length, sent };
  }

  // Morning and evening go to everyone: plan today's hours, then finish today's plan.
  const planIssues = new Map(findPlanIssues(facts, window).map((issue) => [issue.userId, issue]));
  for (const fact of facts) {
    if (!fact.larkOpenId) continue;
    const payload = options.slot === "evening_actual"
      // Half a day of approved leave halves the day's target.
      ? finishPlanCard(options.config, fact, options.config.targetMinutes - (leave.get(fact.userId) ?? 0), window.localDate)
      : planCard(options.config, fact, planIssues.get(fact.userId), window.localDate);
    if (await sendOnce(options.redis, `${prefix}:user:${fact.userId}`, () => send(options, payload, fact.larkOpenId))) sent += 1;
  }
  await options.redis.set(`${prefix}:complete`, "1", "EX", 8 * 24 * 60 * 60);
  return { recipients: facts.length, unaddressable, sent };
}

async function isWorkspaceWorkday(prisma: PrismaClient, config: TaskReminderConfig, window: ReturnType<typeof getVietnamWorkdayWindow>, weekdaysOnly = true) {
  if (weekdaysOnly && !isWorkingDay(window, config.excludedDates)) return false;
  if (config.excludedDates.has(window.localDate)) return false;
  const dayOffModel = (prisma as unknown as {
    workspaceDayOff?: {
      findUnique: (input: { where: { workspaceId_date: { workspaceId: string; date: Date } }; select: { isActive: true } }) => Promise<{ isActive: boolean } | null>;
    };
  }).workspaceDayOff;
  if (!dayOffModel) return true;
  const dayOff = await dayOffModel.findUnique({
    where: { workspaceId_date: { workspaceId: config.workspaceId, date: new Date(`${window.localDate}T00:00:00.000Z`) } },
    select: { isActive: true }
  });
  return !dayOff?.isActive;
}

async function resolveReminderPolicy(prisma: PrismaClient, workspaceId: string) {
  const model = (prisma as unknown as {
    workspaceReminderPolicy?: {
      findUnique: (input: { where: { workspaceId: string }; select: { enabled: true; weekdaysOnly: true; slots: true } }) => Promise<{ enabled: boolean; weekdaysOnly: boolean; slots: unknown } | null>;
    };
  }).workspaceReminderPolicy;
  if (!model) return { enabled: true, weekdaysOnly: true, schedule: TASK_REMINDER_SCHEDULE, pmUserIds: [] };
  const policy = await model.findUnique({ where: { workspaceId }, select: { enabled: true, weekdaysOnly: true, slots: true } });
  if (!policy) return { enabled: true, weekdaysOnly: true, schedule: TASK_REMINDER_SCHEDULE, pmUserIds: [] };
  return { enabled: policy.enabled, weekdaysOnly: policy.weekdaysOnly, schedule: normalizeReminderSchedule(policy.slots), pmUserIds: reminderPmUserIds(policy.slots) };
}

export function reminderPmUserIds(slots: unknown): string[] {
  const pmSlot = Array.isArray(slots) ? slots.find((slot) => (slot as { slot?: unknown })?.slot === "pm_follow_up") as { recipientUserIds?: unknown } | undefined : undefined;
  return Array.isArray(pmSlot?.recipientUserIds) ? pmSlot.recipientUserIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

export function createTaskReminderScheduler(options: {
  prisma?: PrismaClient;
  redis: RedisLike;
  config: TaskReminderConfig;
  now?: () => Date;
  setTimer?: (handler: () => void, delayMs: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  setRepeatingTimer?: (handler: () => void, delayMs: number) => unknown;
  clearRepeatingTimer?: (timer: unknown) => void;
}) {
  if (!options.config.enabled) return { enabled: false, runNow: async () => [], stop: async () => undefined };
  if (!options.prisma) throw new Error("Prisma is required when Lark task reminders are enabled.");
  const prisma = options.prisma;
  const now = options.now ?? (() => new Date());
  const setTimer = options.setTimer ?? ((handler, delay) => setTimeout(handler, delay));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const setRepeatingTimer = options.setRepeatingTimer ?? ((handler, delay) => setInterval(handler, delay));
  const clearRepeatingTimer = options.clearRepeatingTimer ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
  let startupTimer: unknown;
  let intervalTimer: unknown;
  let stopped = false;
  let active: Promise<unknown> | undefined;

  async function runNow() {
    if (stopped || active) return [];
    active = (async () => {
      const at = now();
      const window = getVietnamWorkdayWindow(at);
      const policy = await resolveReminderPolicy(prisma, options.config.workspaceId);
      if (!policy.enabled) return [];
      if (!(await isWorkspaceWorkday(prisma, options.config, window, policy.weekdaysOnly))) return [];
      const slots = dueReminderSlots(window, options.config.catchUpMinutes, policy.schedule);
      const results = [];
      for (const slot of slots) {
        results.push({ slot, result: await runTaskReminderSlot({ ...options, prisma, slot, weekdaysOnly: policy.weekdaysOnly, pmUserIds: policy.pmUserIds, now: at }) });
      }
      return results;
    })();
    try {
      return await active;
    } finally {
      active = undefined;
    }
  }

  startupTimer = setTimer(() => {
    void runNow().catch((error) => console.error("Scheduled Lark task reminder failed", error));
    if (!stopped) intervalTimer = setRepeatingTimer(() => {
      void runNow().catch((error) => console.error("Scheduled Lark task reminder failed", error));
    }, options.config.pollIntervalMs);
  }, options.config.startupDelayMs);

  async function stop() {
    stopped = true;
    if (startupTimer) clearTimer(startupTimer);
    if (intervalTimer) clearRepeatingTimer(intervalTimer);
    if (active) await active.catch(() => undefined);
    await prisma.$disconnect();
  }

  return { enabled: true, runNow, stop };
}
