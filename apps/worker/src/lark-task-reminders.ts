import { createHmac, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  dueReminderSlots,
  findActualIssues,
  findPlanIssues,
  getVietnamWorkdayWindow,
  isWorkingDay,
  normalizeReminderSchedule,
  TASK_REMINDER_SCHEDULE,
  type ActualReminderIssue,
  type PlanReminderIssue,
  type ReminderUserFacts,
  type TaskReminderSlot,
  type VietnamWorkdayWindow
} from "./task-reminder-rules.js";

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
  if (!workspaceId) throw new Error("LARK_TASK_REMINDER_WORKSPACE_ID is required when task reminders are enabled.");
  if (!webhookUrl) throw new Error("LARK_TASK_REMINDER_WEBHOOK_URL is required when task reminders are enabled.");
  if (!publicAppUrl) throw new Error("PUBLIC_APP_URL or PUBLIC_WEB_URL is required when task reminders are enabled.");

  return {
    enabled,
    workspaceId,
    webhookUrl: validateWebhookUrl(webhookUrl),
    webhookSecret: env.LARK_TASK_REMINDER_WEBHOOK_SECRET?.trim() || undefined,
    publicAppUrl: validatePublicAppUrl(publicAppUrl),
    targetMinutes: positiveInteger(env.LARK_TASK_REMINDER_TARGET_MINUTES, 480, "LARK_TASK_REMINDER_TARGET_MINUTES"),
    catchUpMinutes: positiveInteger(env.LARK_TASK_REMINDER_CATCH_UP_MINUTES, 60, "LARK_TASK_REMINDER_CATCH_UP_MINUTES"),
    pollIntervalMs: positiveInteger(env.LARK_TASK_REMINDER_POLL_INTERVAL_MS, 30_000, "LARK_TASK_REMINDER_POLL_INTERVAL_MS"),
    startupDelayMs: positiveInteger(env.LARK_TASK_REMINDER_STARTUP_DELAY_MS, 5_000, "LARK_TASK_REMINDER_STARTUP_DELAY_MS"),
    excludedDates: new Set(csv(env.LARK_TASK_REMINDER_EXCLUDED_DATES)),
    includedUserIds: new Set(csv(env.LARK_TASK_REMINDER_USER_IDS)),
    pmOpenIds: csv(env.LARK_TASK_REMINDER_PM_OPEN_IDS)
  };
}

function at(openId?: string) {
  return openId ? `<at id=${openId}></at> ` : "";
}

function minutesLabel(minutes: number) {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)} giờ`;
}

function taskUrl(config: TaskReminderConfig, taskId?: string) {
  return taskId ? `${config.publicAppUrl}/tasks/${encodeURIComponent(taskId)}` : `${config.publicAppUrl}/calendar`;
}

function divider() {
  return { tag: "hr" };
}

function note(content: string) {
  return { tag: "note", elements: [{ tag: "plain_text", content }] };
}

function planCard(config: TaskReminderConfig, issue: PlanReminderIssue, localDate: string) {
  const lines = [
    `${at(issue.larkOpenId)}**${issue.displayName}**, kế hoạch ngày ${localDate} chưa hoàn tất.`,
    !issue.hasPlan ? "• Chưa có kế hoạch Task trên Calendar." : "",
    ...issue.taskFieldIssues.slice(0, 5).map((task) =>
      `• **${task.taskTitle}**${task.projectName ? ` · ${task.projectName}` : ""}: thiếu ${task.missingFields.join(", ")}.`
    ),
    issue.taskFieldIssues.length > 5 ? `• Và ${issue.taskFieldIssues.length - 5} Task khác chưa đủ trường.` : ""
  ].filter(Boolean);
  const firstTaskId = issue.taskFieldIssues[0]?.taskId;
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: "Kế hoạch Task cần cập nhật · 08:30" }
      },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: lines.join("\n") } },
        divider(),
        note("Mốc 08:30 · Hoàn tất kế hoạch Task trước khi bắt đầu ngày làm việc."),
        { tag: "action", actions: [{
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: firstTaskId ? "Mở Task cần cập nhật" : "Lập kế hoạch trên Calendar" },
          url: taskUrl(config, firstTaskId)
        }] }
      ]
    }
  };
}

function actualCard(config: TaskReminderConfig, issue: ActualReminderIssue, localDate: string) {
  const missingMinutes = Math.max(0, issue.targetMinutes - issue.totalMinutes);
  const lines = [
    `${at(issue.larkOpenId)}**${issue.displayName}**, Actual Hour ngày ${localDate} chưa hoàn tất.`,
    `• Đã ghi: **${minutesLabel(issue.totalMinutes)} / ${minutesLabel(issue.targetMinutes)}**${missingMinutes ? ` · còn thiếu ${minutesLabel(missingMinutes)}` : ""}.`,
    ...issue.taskWithoutActual.slice(0, 5).map((task) =>
      `• **${task.taskTitle}**${task.projectName ? ` · ${task.projectName}` : ""}: chưa có Actual Hour hôm nay.`
    ),
    issue.taskWithoutActual.length > 5 ? `• Và ${issue.taskWithoutActual.length - 5} Task đã lên kế hoạch chưa có Actual Hour.` : ""
  ];
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template: "red", title: { tag: "plain_text", content: "Actual Hour cần cập nhật · 17:00" } },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: lines.join("\n") } },
        divider(),
        note("Mốc 17:00 · Ghi Actual Hour cho từng Task và đủ tối thiểu 8 giờ/ngày."),
        { tag: "action", actions: [{
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: issue.taskWithoutActual.length ? "Mở Task để Log Work" : "Mở Calendar / Actual" },
          url: taskUrl(config, issue.taskWithoutActual[0]?.taskId)
        }] }
      ]
    }
  };
}

function pmFollowUpCard(config: TaskReminderConfig, issues: PlanReminderIssue[], localDate: string) {
  const lines = [
    `${config.pmOpenIds.map((openId) => at(openId)).join("")}Danh sách nhắc kế hoạch Task · ${localDate}`,
    ...issues.slice(0, 12).map((issue) => `• **${issue.displayName}**: ${issue.hasPlan ? `${issue.taskFieldIssues.length} Task còn thiếu trường` : "chưa có kế hoạch"}`),
    issues.length > 12 ? `• Và ${issues.length - 12} nhân sự khác.` : ""
  ].filter(Boolean);
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: { template: "orange", title: { tag: "plain_text", content: "PM cần gửi nhắc · 14:00" } },
      elements: [
        { tag: "div", text: { tag: "lark_md", content: lines.join("\n") } },
        divider(),
        note("Kiểm tra danh sách và gửi nhắc đúng người; hệ thống loại trừ ngày nghỉ và dữ liệu đã hoàn tất."),
        { tag: "action", actions: [{ tag: "button", type: "primary", text: { tag: "plain_text", content: "Mở danh sách cần nhắc" }, url: `${config.publicAppUrl}/calendar?view=week` }] }
      ]
    }
  };
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
          project: { status: { notIn: ["completed", "cancelled", "closed", "archived"] } }
        }
      }
    },
    select: {
      id: true,
      displayName: true,
      identities: {
        where: { provider: "lark", tenantKey: workspace.tenantKey },
        select: { providerUserId: true },
        take: 1
      }
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }]
  });
  const userIds = users.map((user) => user.id);
  if (!userIds.length) return [];

  const [tasks, planningBlocks, timeEntries] = await Promise.all([
    prisma.projectTask.findMany({
      where: {
        workspaceId: config.workspaceId,
        archivedAt: null,
        status: { notIn: ["completed", "done", "cancelled", "closed"] },
        OR: [
          { assigneeUserId: { in: userIds } },
          { assigneeUserId: null, ownerUserId: { in: userIds } }
        ]
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
      select: { userId: true, taskId: true, plannedMinutes: true }
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
    planningBlocks: planningBlocks.filter((block) => block.userId === user.id).map((block) => ({ taskId: block.taskId, plannedMinutes: block.plannedMinutes })),
    timeEntries: timeEntries.filter((entry) => entry.userId === user.id).map((entry) => ({ taskId: entry.taskId, minutes: entry.minutes }))
  }));
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

export async function runTaskReminderSlot(options: {
  prisma: PrismaClient;
  redis: RedisLike;
  config: TaskReminderConfig;
  slot: TaskReminderSlot;
  weekdaysOnly?: boolean;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const window = getVietnamWorkdayWindow(now);
  if (!(await isWorkspaceWorkday(options.prisma, options.config, window, options.weekdaysOnly ?? true))) return { skipped: "non_working_day", sent: 0 };
  const prefix = `b2b-crm:task-reminder:${options.config.workspaceId}:${window.localDate}:${options.slot}`;
  if (await options.redis.get(`${prefix}:complete`)) return { skipped: "already_complete", sent: 0 };
  const facts = await loadReminderFacts(options.prisma, options.config, window);
  let sent = 0;

  if (options.slot === "pm_follow_up") {
    const issues = findPlanIssues(facts, window);
    if (issues.length === 0 || options.config.pmOpenIds.length === 0) return { issues: issues.length, sent: 0 };
    for (const openId of options.config.pmOpenIds) {
      if (await sendOnce(options.redis, `${prefix}:pm:${openId}`, () => postWebhook(options.config, pmFollowUpCard(options.config, issues, window.localDate)))) sent += 1;
    }
    await options.redis.set(`${prefix}:complete`, "1", "EX", 8 * 24 * 60 * 60);
    return { issues: issues.length, sent };
  }

  if (options.slot === "evening_actual") {
    const issues = findActualIssues(facts, options.config.targetMinutes);
    for (const issue of issues) {
      if (!issue.larkOpenId) continue;
      if (await sendOnce(options.redis, `${prefix}:user:${issue.userId}`, () => postWebhook(options.config, actualCard(options.config, issue, window.localDate)))) sent += 1;
    }
    await options.redis.set(`${prefix}:complete`, "1", "EX", 8 * 24 * 60 * 60);
    return { issues: issues.length, unaddressable: issues.filter((issue) => !issue.larkOpenId).length, sent };
  }

  const issues = findPlanIssues(facts, window);
  for (const issue of issues) {
    if (!issue.larkOpenId) continue;
    if (await sendOnce(options.redis, `${prefix}:user:${issue.userId}`, () => postWebhook(options.config, planCard(options.config, issue, window.localDate)))) sent += 1;
  }
  await options.redis.set(`${prefix}:complete`, "1", "EX", 8 * 24 * 60 * 60);
  return { issues: issues.length, unaddressable: issues.filter((issue) => !issue.larkOpenId).length, sent };
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
  if (!model) return { enabled: true, weekdaysOnly: true, schedule: TASK_REMINDER_SCHEDULE };
  const policy = await model.findUnique({ where: { workspaceId }, select: { enabled: true, weekdaysOnly: true, slots: true } });
  if (!policy) return { enabled: true, weekdaysOnly: true, schedule: TASK_REMINDER_SCHEDULE };
  return { enabled: policy.enabled, weekdaysOnly: policy.weekdaysOnly, schedule: normalizeReminderSchedule(policy.slots) };
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
        results.push({ slot, result: await runTaskReminderSlot({ ...options, prisma, slot, weekdaysOnly: policy.weekdaysOnly, now: at }) });
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
