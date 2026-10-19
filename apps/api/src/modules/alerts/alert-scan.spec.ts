import { describe, expect, it, vi } from "vitest";
import { MANUAL_CLOSE_ACTION, REARM_ACTION } from "../delivery-handoff/project-warnings";
import { CONDITION_ABSENT_ACTION } from "./alert-evaluators";
import { NOTIFIED_ACTION } from "./alert-notifications";
import { runAlertScan, TRIGGER_OVERRIDES_KEY } from "./alert-scan";

const vn = (date: string, time = "09:00") => new Date(`${date}T${time}:00.000+07:00`);
const WED = vn("2026-10-14", "07:30");
const THU = vn("2026-10-15", "07:30");
const FRI = vn("2026-10-16", "07:30");

/** Just enough of Prisma for the scan: plain arrays, and the `where` shapes the scan and project-warnings.ts use. */
function fakePrisma(seed: { tasks?: any[]; stages?: any[]; blocks?: any[]; logs?: any[]; changes?: any[]; milestones?: any[]; projects?: any[]; parameters?: any[] }) {
  const db = {
    projects: seed.projects ?? [{ id: "p1", name: "Dự án A", status: "in_progress", members: [] }],
    tasks: seed.tasks ?? [], stages: seed.stages ?? [], blocks: seed.blocks ?? [], logs: seed.logs ?? [], changes: seed.changes ?? [], milestones: seed.milestones ?? [],
    warnings: [] as any[], notifications: [] as any[], clock: new Date("2026-10-01T00:00:00.000Z")
  };
  let seq = 0;
  const match = (row: any, where: any = {}): boolean => Object.entries(where).every(([key, cond]: [string, any]) => {
    if (cond === undefined) return true;
    if (key === "OR") return cond.some((item: any) => match(row, item));
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return cond.in.includes(row[key]);
      if ("gte" in cond) return row[key] != null && row[key] >= cond.gte;
      return true;
    }
    return row[key] === cond;
  });
  const withEvents = (warning: any) => ({ ...warning, events: [...warning.events] });
  const addEvent = (warning: any, event: any) => warning.events.push({ at: event.at ?? db.clock, ...event });
  const prisma = {
    project: { findMany: async () => db.projects },
    projectTask: { findMany: async () => db.tasks.map(({ loggedMinutes, ...task }: any) => task) },
    projectStage: { findMany: async () => db.stages },
    taskTimeEntry: {
      groupBy: async ({ by }: any) => by.length === 1
        ? db.tasks.map((task: any) => ({ taskId: task.id, _sum: { minutes: task.loggedMinutes ?? 0 } }))
        : db.logs.map((log: any) => ({ taskId: log.taskId, userId: log.userId, _max: { workDate: log.workDate } }))
    },
    taskPlanningBlock: { findMany: async () => db.blocks },
    taskTimelineChangeRequest: { findMany: async () => db.changes },
    projectMilestone: { findMany: async () => db.milestones },
    projectRisk: { findMany: async () => [] },
    user: { findMany: async () => [{ id: "admin" }] },
    systemParameter: { findMany: async ({ where }: any) => (seed.parameters ?? []).filter((row: any) => where.key.in.includes(row.key)) },
    appNotification: { create: async ({ data }: any) => { db.notifications.push(data); return data; } },
    projectWarningEvent: { create: async ({ data }: any) => { addEvent(db.warnings.find((warning) => warning.id === data.warningId), data); return data; } },
    projectWarning: {
      findMany: async ({ where }: any) => db.warnings.filter((warning) => match(warning, where)).map(withEvents),
      findFirst: async ({ where }: any) => { const found = db.warnings.filter((warning) => match(warning, where)).pop(); return found ? withEvents(found) : null; },
      create: async ({ data }: any) => {
        const { events, ...fields } = data;
        const warning = { id: `w${++seq}`, status: "open", openedAt: db.clock, closedAt: null, dueAt: null, ownerUserId: null, ...fields, events: [] as any[] };
        addEvent(warning, events.create);
        db.warnings.push(warning);
        return warning;
      },
      update: async ({ where, data }: any) => {
        const warning = db.warnings.find((item) => item.id === where.id);
        const { events, ...fields } = data;
        Object.assign(warning, fields);
        if (events?.create) addEvent(warning, events.create);
        return warning;
      }
    }
  };
  return { prisma, db };
}

const task = (over: any = {}) => ({ id: "t1", projectId: "p1", title: "Build", status: "in_progress", parentTaskId: null, stageId: "s1", ownerUserId: null, assigneeUserId: "u1", dueAt: null, estimateMinutes: 600, loggedMinutes: 0, ...over });
const stage = (over: any = {}) => ({ id: "s1", projectId: "p1", activity: "Build", status: "in_progress", ownerUserId: "pm", milestoneId: "m1", plannedStartAt: null, plannedEndAt: null, sortOrder: 10, milestone: { sortOrder: 1 }, ...over });
const scan = (prisma: any, now: Date, extra: any = {}) => runAlertScan(prisma, "w", { now, deliverLark: async () => "chưa cấu hình kênh Lark", loadPendingHours: async () => [], ...extra });
const open = (db: any) => db.warnings.filter((warning: any) => warning.status === "open").map((warning: any) => warning.dedupeKey).sort();

describe("daily scan", () => {
  it("TD-04 / TD-05 / BRI-05: stage SLA, approved stage extensions and the customer step of a gate", async () => {
    const { prisma, db } = fakePrisma({ stages: [stage({ slaDays: 2, actualStartAt: vn("2026-10-05"), actualEndAt: null, slaPausedAt: null, customerWaitDays: 0, milestone: { sortOrder: 1, name: "Milestone 1" } })] });
    const extensions: any[] = [];
    const gates: any[] = [{ projectId: "p1", milestoneId: "m1", code: "G1", customerRequestedAt: vn("2026-10-06") }];
    Object.assign(prisma, { projectStageExtension: { findMany: async () => extensions }, projectGate: { findMany: async ({ where }: any) => (where.status === "awaiting_customer" ? gates : []) } });
    const extension = (newDueAt: Date) => ({ id: `e${extensions.length}`, stageId: "s1", previousDueAt: null, newDueAt, reason: "Khách đổi lịch", approvedByName: "PM", approvedAt: WED });

    // Started Mon 05/10 with a 2-day SLA and still open on Wed 14/10; G1 was sent on 06/10 and 3 working days passed.
    expect((await scan(prisma, WED)).opened).toEqual({ "TD-04": 1, "BRI-05": 1 });
    expect(open(db)).toEqual(["BRI-05:milestone:m1", "TD-04:stage:s1"]);
    expect(db.warnings.find((warning: any) => warning.typeCode === "BRI-05").detail).toContain("Nguyên nhân từ khách");

    // "Gia hạn được duyệt" closes TD-04; one extension is not abnormal yet. The customer confirms: BRI-05 closes.
    extensions.push(extension(vn("2026-10-20")));
    gates.length = 0;
    expect((await scan(prisma, WED)).closed).toEqual({ "TD-04": 1, "BRI-05": 1 });
    expect(open(db)).toEqual([]);

    // TD-05 is an event trigger owned by stage-extension.ts: the scan neither opens it nor closes the one the event opened.
    db.warnings.push({ id: "w-td05", workspaceId: "w", projectId: "p1", typeCode: "TD-05", dedupeKey: "TD-05:stage:s1", status: "open", title: "Gia hạn stage bất thường", openedAt: WED, events: [] });
    extensions.push(extension(vn("2026-10-21")), extension(vn("2026-10-22")));
    const third = await scan(prisma, WED);
    expect(third.opened).toEqual({});
    expect(third.closed).toEqual({});
    expect(open(db)).toEqual(["TD-05:stage:s1"]);
  });

  it("recomputes the status proposal of every scanned project, after the warnings are reconciled (V-17)", async () => {
    const { prisma, db } = fakePrisma({ tasks: [task({ dueAt: vn("2026-10-12") })], stages: [stage()] });
    const seen: string[][] = [];
    await scan(prisma, WED, { syncProjectStatus: async (projectId: string) => { seen.push([projectId, ...open(db)]); } });
    expect(seen).toEqual([["p1", "TD-02:task:t1"]]);
  });

  it("sends 'admins' alerts to every Admin account type, and resolves the PM by the shared first-stage rule", async () => {
    const { prisma, db } = fakePrisma({
      tasks: [task({ assigneeUserId: null, dueAt: vn("2026-10-12") })],
      // Stage order is numbered per milestone: the first stage is the first one of the FIRST milestone, so its owner is the PM.
      stages: [stage({ id: "s2", sortOrder: 20, ownerUserId: "pm", milestone: { sortOrder: 1 } }), stage({ id: "s1", sortOrder: 10, ownerUserId: "later-milestone", milestone: { sortOrder: 2 } })]
    });
    const wheres: any[] = [];
    (prisma.user as any).findMany = async (args: any) => { wheres.push(args.where); return [{ id: "admin" }]; };
    await scan(prisma, WED);
    expect([...wheres[0].roleBindings.some.role.code.in].sort()).toEqual(["BD_LEAD", "DX_DIRECTOR", "FOUNDER_GM", "PM", "WORKSPACE_ADMIN"]);
    expect(db.warnings.find((warning: any) => warning.dedupeKey === "TD-02:task:t1").ownerUserId).toBe("pm");
  });

  it("BRI-04 reads gate submissions (one record per gate), not only the legacy milestone approval request", async () => {
    const { prisma, db } = fakePrisma({ stages: [stage({ milestone: { sortOrder: 1, name: "Milestone 2" } })] });
    const gates: any[] = [
      { id: "g2", projectId: "p1", milestoneId: "m1", code: "G2", status: "submitted", submittedAt: vn("2026-10-09", "15:00") },
      { id: "g3", projectId: "p1", milestoneId: "m1", code: "G3", status: "submitted", submittedAt: vn("2026-10-09", "15:00") }
    ];
    Object.assign(prisma, { projectGate: { findMany: async ({ where }: any) => gates.filter((gate) => gate.status === where.status) } });
    expect((await scan(prisma, WED)).opened).toEqual({ "BRI-04": 2 });
    expect(open(db)).toEqual(["BRI-04:gate:g2", "BRI-04:gate:g3"]);
    expect(db.warnings.find((warning: any) => warning.dedupeKey === "BRI-04:gate:g2").detail).toContain("G2 – Milestone 2");
    // "Kết thúc khi: Có kết quả duyệt".
    gates[0].status = "approved";
    expect((await scan(prisma, WED)).closed).toEqual({ "BRI-04": 1 });
    expect(open(db)).toEqual(["BRI-04:gate:g3"]);
  });

  it("opens each finding once, refreshes it on the next run, and closes it when the condition is gone", async () => {
    const { prisma, db } = fakePrisma({ tasks: [task({ dueAt: vn("2026-10-12"), loggedMinutes: 500 })], stages: [stage()] });
    const first = await scan(prisma, WED);
    expect(first.opened).toEqual({ "TD-01": 2, "TD-02": 1 });
    expect(open(db)).toEqual(["TD-01:stage:s1", "TD-01:task:t1", "TD-02:task:t1"]);
    expect(db.warnings.find((warning: any) => warning.dedupeKey === "TD-02:task:t1")).toMatchObject({ typeCode: "TD-02", ownerUserId: "u1", projectId: "p1" });
    // A stage warning has no named person of its own: it goes to the PM (the owner of the first stage).
    expect(db.warnings.find((warning: any) => warning.dedupeKey === "TD-01:stage:s1").ownerUserId).toBe("pm");

    // Idempotent: the same data on the same day and on the next day changes nothing but the refresh count.
    const second = await scan(prisma, WED);
    const third = await scan(prisma, THU);
    expect(second.opened).toEqual({});
    expect(second.refreshed).toEqual({ "TD-01": 2, "TD-02": 1 });
    expect(third.opened).toEqual({});
    expect(db.warnings).toHaveLength(3);

    // The task is completed: TD-02 and the task-level TD-01 close with the catalogue's close condition; the stage one stays.
    db.tasks[0].status = "done";
    const fourth = await scan(prisma, FRI);
    expect(fourth.closed).toEqual({ "TD-01": 1, "TD-02": 1 });
    expect(open(db)).toEqual(["TD-01:stage:s1"]);
    expect(db.warnings.find((warning: any) => warning.dedupeKey === "TD-02:task:t1")).toMatchObject({ status: "closed", closeReason: "Điều kiện kết thúc: Hoàn thành hoặc hạn mới được duyệt" });
  });

  it("sends each warning once, again only when its level rises, and the closure once (V-37)", async () => {
    const { prisma, db } = fakePrisma({ tasks: [task({ loggedMinutes: 500 })], stages: [] });
    const first = await scan(prisma, WED);
    // One merged in-app message per recipient for the group: the assignee and the Admin.
    expect(first.notifications).toEqual({ inApp: 2, lark: "chưa cấu hình kênh Lark" });
    expect(db.notifications.map((item: any) => item.recipientUserId).sort()).toEqual(["admin", "u1"]);
    expect(db.notifications[0]).toMatchObject({ kind: "project_warning", href: "/projects/p1" });
    const notified = () => db.warnings[0].events.filter((event: any) => event.action === NOTIFIED_ACTION).map((event: any) => event.note.split("|").slice(0, 2).join("|"));
    expect(notified()).toEqual(["new|medium"]);

    expect((await scan(prisma, WED)).notifications.inApp).toBe(0);
    expect((await scan(prisma, THU)).notifications.inApp).toBe(0);

    db.tasks[0].loggedMinutes = 700; // over 100%: the level rises
    expect((await scan(prisma, THU)).notifications.inApp).toBe(2);
    expect(notified()).toEqual(["new|medium", "escalated|high"]);
    expect((await scan(prisma, FRI)).notifications.inApp).toBe(0);

    db.tasks[0].estimateMinutes = 2000; // new plan approved: closes
    expect((await scan(prisma, FRI)).notifications.inApp).toBe(2);
    expect(notified()).toEqual(["new|medium", "escalated|high", "closed|high"]);
    expect((await scan(prisma, FRI)).notifications.inApp).toBe(0);
  });

  it("does not send a second message for a warning that was already overdue when it opened", async () => {
    const { prisma } = fakePrisma({ tasks: [task({ dueAt: vn("2026-10-12") })], stages: [] });
    expect((await scan(prisma, WED)).notifications.inApp).toBe(2);
    expect((await scan(prisma, WED)).notifications.inApp).toBe(0);
    expect((await scan(prisma, THU)).notifications.inApp).toBe(0);
  });

  it("merges several warnings of one group into one message per recipient", async () => {
    const { prisma, db } = fakePrisma({ tasks: [task({ dueAt: vn("2026-10-12"), loggedMinutes: 500 }), task({ id: "t2", title: "Test", dueAt: vn("2026-10-09") })], stages: [] });
    await scan(prisma, WED);
    const toAssignee = db.notifications.filter((item: any) => item.recipientUserId === "u1");
    expect(toAssignee).toHaveLength(1);
    expect(toAssignee[0].title).toBe("Cảnh báo Tiến độ: 3 thay đổi");
    expect(toAssignee[0].body.split("\n")).toHaveLength(3);
  });

  it("does not notify when asked to reconcile only, and announces those warnings on the next notifying run", async () => {
    const { prisma, db } = fakePrisma({ tasks: [task({ dueAt: vn("2026-10-12") })], stages: [] });
    await scan(prisma, WED, { notify: false });
    expect(db.notifications).toHaveLength(0);
    expect((await scan(prisma, THU)).notifications.inApp).toBe(2);
  });

  it("keeps a warning a person closed by hand closed while its cause lasts, and re-arms it once the cause is gone", async () => {
    const { prisma, db } = fakePrisma({ tasks: [task({ dueAt: vn("2026-10-12") })], stages: [] });
    await scan(prisma, WED);
    Object.assign(db.warnings[0], { status: "closed", closedAt: WED });
    db.warnings[0].events.push({ action: MANUAL_CLOSE_ACTION, at: WED });
    expect((await scan(prisma, THU)).opened).toEqual({});
    expect(db.warnings).toHaveLength(1);
    db.tasks[0].dueAt = vn("2026-10-30");
    await scan(prisma, THU);
    expect(db.warnings[0].events.at(-1).action).toBe(REARM_ACTION);
    expect(db.warnings[0].events.map((event: any) => event.action)).toContain(NOTIFIED_ACTION); // the send log does not lift the suppression
    db.tasks[0].dueAt = vn("2026-10-12");
    expect((await scan(prisma, FRI)).opened).toEqual({ "TD-02": 1 });
    expect(db.warnings).toHaveLength(2);
  });

  it("closes TD-03 only after two consecutive clear working days", async () => {
    const tasks = [task({ id: "a", estimateMinutes: 50, status: "done" }), task({ id: "b", estimateMinutes: 950 })];
    const { prisma, db } = fakePrisma({ tasks, stages: [stage({ plannedStartAt: vn("2026-10-05"), plannedEndAt: vn("2026-11-27", "18:00") })] });
    expect((await scan(prisma, WED)).opened).toEqual({ "TD-03": 1 });
    db.tasks[0].estimateMinutes = 900; // 90% done: the condition is gone
    db.tasks[1].estimateMinutes = 100;
    expect((await scan(prisma, THU)).closed).toEqual({});
    expect(db.warnings[0].events.at(-1).action).toBe(CONDITION_ABSENT_ACTION);
    expect((await scan(prisma, THU)).closed).toEqual({}); // a second run on the same day does not count twice
    expect((await scan(prisma, FRI)).closed).toEqual({ "TD-03": 1 });
    expect(db.warnings[0].closeReason).toContain("2 ngày làm việc liên tiếp");
  });

  it("evaluates the remaining scan triggers through to a stored record", async () => {
    const { prisma, db } = fakePrisma({
      tasks: [task({ assigneeUserId: null, estimateMinutes: 0 })],
      stages: [stage()],
      blocks: [
        { taskId: "t1", projectId: "p1", userId: "u2", startAt: vn("2026-10-08"), plannedMinutes: 3000, status: "planned", user: { displayName: "Lan" } },
        { taskId: "t1", projectId: "p1", userId: "u2", startAt: vn("2026-10-13"), plannedMinutes: 3000, status: "planned", user: { displayName: "Lan" } }
      ],
      changes: [{ id: "r1", projectId: "p1", taskId: "t1", createdAt: WED, reason: "Đổi phạm vi", task: { title: "Build", stageId: "s1" } }],
      milestones: [{ id: "m1", projectId: "p1", name: "Milestone 2", approvalRequestedAt: vn("2026-10-09", "15:00"), reviewerUserId: null }]
    });
    const result = await scan(prisma, WED, { loadPendingHours: async () => [{ projectId: "p1", minutes: 60, loggedAt: vn("2026-09-21") }] });
    expect(result.opened).toEqual({ "NL-03": 1, "NL-04": 1, "NL-05": 1, "TD-06": 1, "BRI-04": 1, "DL-01": 1 });
    expect(open(db)).toEqual(["BRI-04:milestone:m1", "DL-01:pending-hours", "NL-03:task:t1", "NL-04:task:t1:user:u2", "NL-05:user:u2:week:2026-10-12", "TD-06:request:r1"]);
    expect(result.skipped).toEqual([]); // TD-04, TD-05 and BRI-05 are evaluated now (next test)
    expect((await scan(prisma, WED, { loadPendingHours: async () => [{ projectId: "p1", minutes: 60, loggedAt: vn("2026-09-21") }] })).opened).toEqual({});
  });

  it("skips progress triggers for a project that is not running, a closed project entirely, and a trigger the Admin switched off", async () => {
    const tasks = [task({ dueAt: vn("2026-10-12") }), task({ id: "t2", projectId: "p2", dueAt: vn("2026-10-12") }), task({ id: "t3", projectId: "p3", dueAt: vn("2026-10-12"), assigneeUserId: null })];
    const projects = [{ id: "p1", name: "A", status: "on_hold", members: [] }, { id: "p2", name: "B", status: "in_progress", members: [] }, { id: "p3", name: "C", status: "closed", members: [] }];
    const { prisma, db } = fakePrisma({ tasks, projects });
    const result = await scan(prisma, WED);
    expect(result.projects).toBe(2);
    expect(open(db)).toEqual(["TD-02:task:t2"]);

    const off = fakePrisma({ tasks, projects, parameters: [{ key: TRIGGER_OVERRIDES_KEY, value: { "TD-02": { enabled: false } }, createdAt: WED }] });
    const skipped = await scan(off.prisma, WED);
    expect(off.db.warnings).toHaveLength(0);
    expect(skipped.skipped).toContainEqual({ code: "TD-02", reason: "Admin đã tắt điểm kích hoạt" });
  });

  it("leaves DL-01 untouched when the run has no pending-hours source", async () => {
    const { prisma } = fakePrisma({});
    const result = await runAlertScan(prisma, "w", { now: WED, deliverLark: vi.fn() });
    expect(result.skipped).toContainEqual({ code: "DL-01", reason: "Lượt quét này không được cấp nguồn giờ Chờ xử lý" });
  });

  it("closes what is still open of a retired trigger (YC-01, gone with the change-request flow), on any project of the workspace", async () => {
    const { prisma, db } = fakePrisma({});
    db.warnings.push({ id: "w-yc", workspaceId: "w", projectId: "p-closed", typeCode: "YC-01", dedupeKey: "YC-01:risk-1:CR-03", status: "open", title: "Yêu cầu thay đổi quá SLA", openedAt: WED, events: [] });
    expect((await scan(prisma, WED)).closed).toEqual({ "YC-01": 1 });
    expect(db.warnings[0]).toMatchObject({ status: "closed", closeReason: "Loại cảnh báo đã bỏ khỏi danh mục" });
    expect((await scan(prisma, THU)).closed).toEqual({});
  });
});
