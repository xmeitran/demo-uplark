import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { IssueLogActor } from "./issue-log";
import { createIssueLogRecord, mapIssueLogRecord, nextIssueLogCode, syncIssueLogWarnings, transitionIssueLogRecord, updateIssueLogRecord, type IssueLogContext } from "./issue-log.service";

const project = { id: "prj-1", accountId: "acc-1", code: "P-1", name: "Dự án A" };
const principal = { subjectType: "internal_user", subjectId: "usr-pm", displayName: "PM", workspaceId: "twk-1", tenantKey: "t", roleCodes: [] } as any;
const pm: IssueLogActor = { userId: "usr-pm", isAdmin: false, isPm: true, isBd: false, isMember: true };
const admin: IssueLogActor = { userId: "usr-admin", isAdmin: true, isPm: true, isBd: false, isMember: false };
const member: IssueLogActor = { userId: "usr-member", isAdmin: false, isPm: false, isBd: false, isMember: true };

/** Just enough of Prisma for the issue log: rows in arrays, a transaction that runs its callback. */
function fakePrisma() {
  const risks: any[] = [];
  const events: any[] = [];
  const warnings: any[] = [];
  const counters = new Map<string, number>();
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => (value && typeof value === "object" && "in" in value ? value.in.includes(row[key]) : row[key] === value));
  const withEvents = (risk: any) => ({ ...risk, events: events.filter((event) => event.riskId === risk.id) });
  const client: any = {
    risks, events, warnings,
    projectRiskCounter: {
      upsert: vi.fn(async ({ where }: any) => {
        const key = `${where.projectId_prefix.projectId}:${where.projectId_prefix.prefix}`;
        counters.set(key, (counters.get(key) ?? 0) + 1);
        return { last: counters.get(key) };
      })
    },
    projectRisk: {
      create: vi.fn(async ({ data }: any) => {
        if (risks.some((risk) => risk.projectId === data.projectId && risk.code === data.code)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row = { id: `risk-${risks.length + 1}`, createdAt: new Date(), closedAt: null, ...data };
        risks.push(row);
        return withEvents(row);
      }),
      update: vi.fn(async ({ where, data }: any) => withEvents(Object.assign(risks.find((risk) => risk.id === where.id), data))),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const rows = risks.filter((risk) => matches({ ...risk, crStep: risk.crStep ?? null }, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      }),
      findFirst: vi.fn(async ({ where }: any) => { const row = risks.find((risk) => matches(risk, where)); return row ? withEvents(row) : null; }),
      delete: vi.fn()
    },
    projectRiskEvent: { create: vi.fn(async ({ data }: any) => { events.push({ id: `evt-${events.length + 1}`, ...data }); }), findMany: vi.fn(async ({ where }: any) => events.filter((event) => event.riskId === where.riskId)) },
    projectWarning: {
      findFirst: vi.fn(async ({ where }: any) => warnings.filter((warning) => matches(warning, where)).at(-1) ?? null),
      findMany: vi.fn(async ({ where }: any) => warnings.filter((warning) => matches(warning, where))),
      create: vi.fn(async ({ data }: any) => { const { events: _events, ...row } = data; warnings.push({ id: `w-${warnings.length + 1}`, status: "open", ...row }); return warnings.at(-1); }),
      update: vi.fn(async ({ where, data }: any) => { const { events: _events, ...row } = data; return Object.assign(warnings.find((warning) => warning.id === where.id), row); })
    },
    projectTask: { findFirst: vi.fn(async ({ where }: any) => (where.id === "task-1" ? { stageId: "stage-1" } : null)) },
    projectStage: { findFirst: vi.fn(async ({ where }: any) => (where.id === "stage-1" ? { milestoneId: "ms-1" } : null)) },
    projectMilestone: { findFirst: vi.fn(async ({ where }: any) => (where.id === "ms-1" ? { id: "ms-1" } : null)) },
    auditEvent: { create: vi.fn() }
  };
  client.$transaction = async (run: any) => run(client);
  return client;
}

const context = (prisma: any, actor = pm, extra: Partial<IssueLogContext> = {}): IssueLogContext => ({ prisma, principal: { ...principal, subjectId: actor.userId }, actor, ...extra });
const openKeys = (prisma: any) => prisma.warnings.filter((warning: any) => warning.status === "open").map((warning: any) => warning.dedupeKey);

describe("issue log codes", () => {
  it("numbers each type on its own inside the creating transaction and never reuses a number", async () => {
    const prisma = fakePrisma();
    const ctx = context(prisma);
    const create = (type: string, extension: any) => createIssueLogRecord(ctx, project, { type, description: "Mô tả", extension } as any);
    const first = await create("issue", { actualImpact: "Trễ" });
    const blocker = await create("blocker", { causeSide: "customer" });
    const second = await create("issue", { actualImpact: "Trễ" });
    expect([first.code, blocker.code, second.code]).toEqual(["ISS-001", "BLK-001", "ISS-002"]);
    // Cancelling keeps the row and its code; the next record gets the next number.
    await transitionIssueLogRecord(context(prisma, admin), project, await prisma.projectRisk.findFirst({ where: { id: second.id } }), { action: "cancel", note: "Nhập nhầm" });
    expect((await create("issue", { actualImpact: "Trễ" })).code).toBe("ISS-003");
    expect(await nextIssueLogCode(prisma, "prj-other", "risk")).toBe("RSK-001");
  });

  it("gives a reclassified record a new code of its new type and keeps the old one in its history", async () => {
    const prisma = fakePrisma();
    const record = await createIssueLogRecord(context(prisma), project, { type: "issue", description: "Khách muốn thêm báo cáo", extension: { actualImpact: "Chưa rõ" } } as any);
    const moved = await transitionIssueLogRecord(context(prisma), project, record, { action: "reclassify", targetType: "risk", extension: { likelihood: "High" } });
    expect(moved).toMatchObject({ code: "RSK-001", type: "risk", status: "pending" });
    expect(moved.events.at(-1).note).toContain("ISS-001 → RSK-001");
  });
});

describe("issue log create and edit", () => {
  it("only lets project members report, enforces the type's fields and fills the location upwards", async () => {
    const prisma = fakePrisma();
    await expect(createIssueLogRecord(context(prisma, { ...member, isMember: false }), project, { type: "issue", description: "x", extension: { actualImpact: "y" } } as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(createIssueLogRecord(context(prisma, member), project, { type: "blocker", description: "x" } as any)).rejects.toThrow(/Nguyên nhân/);
    await expect(createIssueLogRecord(context(prisma, member), project, { type: "issue", description: "x", taskId: "task-9", extension: { actualImpact: "y" } } as any)).rejects.toThrow(/Task không thuộc dự án/);
    const record = await createIssueLogRecord(context(prisma, member), project, { type: "issue", description: "x", taskId: "task-1", extension: { actualImpact: "y" } } as any);
    expect(record).toMatchObject({ status: "pending", taskId: "task-1", stageId: "stage-1", milestoneId: "ms-1", createdByUserId: "usr-member" });
    expect(prisma.events[0]).toMatchObject({ action: "created", toStatus: "pending", actorUserId: "usr-member" });
  });

  it("no longer takes a change request, and a stored one is read-only and unlisted by the warning refresh", async () => {
    const prisma = fakePrisma();
    await expect(createIssueLogRecord(context(prisma), project, { type: "change_request", description: "Thêm báo cáo", extension: { requesterName: "Chị Lan" } } as any)).rejects.toThrow(/Blocker, Risk hoặc Issue/);
    expect(prisma.risks).toEqual([]);
    const legacy = { id: "risk-old", workspaceId: "twk-1", projectId: "prj-1", code: "CR-001", type: "change_request", status: "assessing", severity: "medium", extension: {}, createdAt: new Date(), closedAt: null, events: [] };
    expect(mapIssueLogRecord(legacy, admin)).toMatchObject({ allowedActions: [], canEdit: false });
    await expect(transitionIssueLogRecord(context(prisma, admin), project, legacy, { action: "cancel", note: "x" })).rejects.toThrow();
  });

  it("refuses a direct status edit and records field edits in the history", async () => {
    const prisma = fakePrisma();
    const record = await createIssueLogRecord(context(prisma), project, { type: "issue", description: "x", extension: { actualImpact: "y" } } as any);
    await expect(updateIssueLogRecord(context(prisma), project, record, { status: "resolved" } as any)).rejects.toThrow(/Trạng thái chỉ đổi qua/);
    await expect(updateIssueLogRecord(context(prisma, member), project, record, { nextStep: "Gọi khách" })).rejects.toBeInstanceOf(ForbiddenException);
    const updated = await updateIssueLogRecord(context(prisma), project, record, { severity: "critical", nextStep: "Gọi khách" });
    expect(updated.events.at(-1)).toMatchObject({ action: "updated", note: expect.stringContaining("Trung bình → Nghiêm trọng") });
    expect(openKeys(prisma)).toEqual(["BRI-01:risk-1", "BRI-03:risk-1"]);
  });
});

describe("cancel instead of delete", () => {
  it("keeps the row, stores the reason, writes history and audit, and closes its warnings", async () => {
    const prisma = fakePrisma();
    const record = await createIssueLogRecord(context(prisma), project, { type: "risk", description: "x" } as any);
    await expect(transitionIssueLogRecord(context(prisma, pm), project, record, { action: "cancel", note: "Nhập nhầm" })).rejects.toBeInstanceOf(ForbiddenException);
    const cancelled = await transitionIssueLogRecord(context(prisma, admin), project, record, { action: "cancel", note: "Nhập nhầm" });
    expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "Nhập nhầm" });
    expect(prisma.risks).toHaveLength(1);
    expect(prisma.projectRisk.delete).not.toHaveBeenCalled();
    expect(cancelled.events.at(-1)).toMatchObject({ action: "cancel", fromStatus: "pending", toStatus: "cancelled", note: "Nhập nhầm", actorUserId: "usr-admin" });
    expect(prisma.auditEvent.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "issue_log.cancel", resourceId: record.id }) }));
    expect(openKeys(prisma)).toEqual([]);
  });
});

describe("issue log warnings", () => {
  it("opens BRI-01 on report, adds BRI-02 once overdue without duplicating, and closes all on resolve", async () => {
    const prisma = fakePrisma();
    const record = await createIssueLogRecord(context(prisma, pm, { now: new Date("2026-10-09T03:00:00.000Z") }), project, { type: "issue", description: "x", ownerUserId: "usr-pm", dueAt: "2026-10-10", extension: { actualImpact: "y" } } as any);
    expect(openKeys(prisma)).toEqual(["BRI-01:risk-1"]);
    const later = new Date("2026-10-13T03:00:00.000Z");
    await syncIssueLogWarnings(prisma, record, null, later);
    await syncIssueLogWarnings(prisma, record, null, later);
    expect(openKeys(prisma)).toEqual(["BRI-01:risk-1", "BRI-02:risk-1"]);
    expect(prisma.warnings.find((warning: any) => warning.dedupeKey === "BRI-02:risk-1")).toMatchObject({ typeCode: "BRI-02", projectId: "prj-1", ownerUserId: "usr-pm" });

    const working = await transitionIssueLogRecord(context(prisma), project, record, { action: "start" });
    const resolved = await transitionIssueLogRecord(context(prisma), project, working, { action: "resolve", resolutionEvidence: "Đã vá, link PR" });
    expect(resolved.status).toBe("resolved");
    expect(openKeys(prisma)).toEqual([]);
    expect(prisma.warnings.every((warning: any) => warning.closeReason?.includes("Đã xử lý"))).toBe(true);
  });

  it("notifies the PM of a new record and the leaders of an escalation (in-app)", async () => {
    const prisma = fakePrisma();
    prisma.projectStage.findFirst = vi.fn(async () => ({ ownerUserId: "usr-pm", milestoneId: "ms-1" }));
    prisma.user = { findMany: vi.fn(async () => [{ id: "usr-admin" }]), findFirst: vi.fn(async () => ({ id: "x" })) };
    const notifications = { notifyProjectRiskOwner: vi.fn(), resolveProjectRiskNotifications: vi.fn(), notifyIssueLogEvent: vi.fn() };
    const owner: IssueLogActor = { ...member, userId: "usr-owner" };
    const record = await createIssueLogRecord(context(prisma, member, { notifications }), project, { type: "issue", description: "x", ownerUserId: "usr-owner", extension: { actualImpact: "y" } } as any);
    expect(notifications.notifyProjectRiskOwner).toHaveBeenCalledWith(expect.objectContaining({ recipientUserId: "usr-owner", event: "created" }));
    expect(notifications.notifyIssueLogEvent).toHaveBeenCalledWith(expect.objectContaining({ recipientUserIds: ["usr-pm"], event: "created" }));
    const escalated = await transitionIssueLogRecord(context(prisma, owner, { notifications }), project, record, { action: "escalate", impactArea: "timeline", note: "Trễ" });
    expect(escalated).toMatchObject({ escalationLevel: "bd_lead", status: "pending" });
    expect(notifications.notifyIssueLogEvent).toHaveBeenLastCalledWith(expect.objectContaining({ recipientUserIds: ["usr-admin"], event: "escalated" }));
  });
});
