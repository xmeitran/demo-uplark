import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { expandRoleCodes, type PrincipalContext } from "@b2b-crm/contracts";
import { ProjectVisibilityGuard, canSeeProject, seesAllProjects, visibleProjectWhere, withoutProjectFinancials } from "./project-visibility";
import { ProjectPermissionsService } from "./project-permissions.service";
import { ProjectsService } from "./projects.service";

const as = (subjectId: string, held: string[], extra: Partial<PrincipalContext> = {}): PrincipalContext => ({
  subjectType: "internal_user", subjectId, displayName: subjectId, tenantKey: "prod", workspaceId: "twk-1", workspaceKey: "default",
  roleCodes: expandRoleCodes(held), heldRoleCodes: held, accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [], roleVersion: "r", grantVersion: "g", ...extra
});

/** A tiny in-memory Project table that understands exactly the where clause visibleProjectWhere builds. */
const projects: Array<{ id: string; workspaceId: string; accountId: string; projectType: string; members: string[]; stageOwners: string[]; taskPeople: string[]; accountPic: string | null }> = [
  { id: "prj-member", workspaceId: "twk-1", accountId: "acc-1", projectType: "delivery", members: ["usr-dx"], stageOwners: [], taskPeople: [], accountPic: null },
  { id: "prj-pic", workspaceId: "twk-1", accountId: "acc-1", projectType: "delivery", members: [], stageOwners: ["usr-dx"], taskPeople: [], accountPic: null },
  { id: "prj-assignee", workspaceId: "twk-1", accountId: "acc-1", projectType: "delivery", members: [], stageOwners: [], taskPeople: ["usr-dx"], accountPic: null },
  { id: "prj-client-of-bd", workspaceId: "twk-1", accountId: "acc-1", projectType: "delivery", members: [], stageOwners: [], taskPeople: [], accountPic: "usr-bd" },
  { id: "prj-worklog", workspaceId: "twk-1", accountId: "acc-1", projectType: "internal_worklog", members: [], stageOwners: [], taskPeople: [], accountPic: null },
  { id: "prj-other", workspaceId: "twk-1", accountId: "acc-1", projectType: "delivery", members: ["usr-else"], stageOwners: ["usr-else"], taskPeople: ["usr-else"], accountPic: "usr-else" }
];
function matches(project: (typeof projects)[number], where: any): boolean {
  if (!where || Object.keys(where).length === 0) return true;
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === "OR") return value.some((clause: any) => matches(project, clause));
    if (key === "AND") return value.every((clause: any) => matches(project, clause));
    if (key === "id" || key === "workspaceId") return (project as any)[key] === value;
    if (key === "members") return project.members.includes(value.some.userId);
    if (key === "stages") return project.stageOwners.includes(value.some.ownerUserId);
    if (key === "tasks") return value.some.OR.some((clause: any) => project.taskPeople.includes(clause.assigneeUserId ?? clause.ownerUserId));
    if (key === "account") return project.accountPic === value.picUserId;
    if (key === "projectType") return project.projectType === value.equals;
    throw new Error(`unexpected where key ${key}`);
  });
}
const visibleTo = (principal: PrincipalContext) => projects.filter((project) => matches(project, visibleProjectWhere(principal))).map((project) => project.id);
const fakePrisma = () => ({
  project: { findFirst: vi.fn(async ({ where }: any) => projects.find((project) => matches(project, where)) ?? null) },
  policyDecisionLog: { create: vi.fn() }
});

describe("project visibility (7.7)", () => {
  it("a User sees the projects they take part in: member, PIC / stage owner, task owner or assignee — and the internal worklog", () => {
    expect(visibleTo(as("usr-dx", ["DX"]))).toEqual(["prj-member", "prj-pic", "prj-assignee", "prj-worklog"]);
    expect(visibleTo(as("usr-dx", ["DELIVERY_LEAD"]))).toEqual(["prj-member", "prj-pic", "prj-assignee", "prj-worklog"]);
  });

  it("a BD also sees the projects of the clients they are the PIC of", () => {
    expect(visibleTo(as("usr-bd", ["BD"]))).toEqual(["prj-client-of-bd", "prj-worklog"]);
  });

  it("a User who takes part in nothing sees only the internal worklog", () => {
    expect(visibleTo(as("usr-new", ["PQA"]))).toEqual(["prj-worklog"]);
    expect(visibleTo(as("usr-new", ["WORKSPACE_USER", "COST_VIEW"]))).toEqual(["prj-worklog"]);
  });

  it("every Admin sees all projects — unless working in user view", () => {
    for (const code of ["FOUNDER_GM", "WORKSPACE_ADMIN", "PM", "DX_DIRECTOR", "BD_LEAD"]) {
      expect(visibleProjectWhere(as("usr-admin", [code]))).toEqual({});
      expect(seesAllProjects(as("usr-admin", [code]))).toBe(true);
    }
    expect(visibleTo(as("usr-dx", ["PM"], { viewMode: "user" }))).toEqual(["prj-member", "prj-pic", "prj-assignee", "prj-worklog"]);
  });

  it("narrows portal (customer) principals to their granted projects and clients; service accounts see all", () => {
    expect(visibleProjectWhere(as("portal-1", [], { subjectType: "portal_user", customerProjectIds: ["prj-a"], customerAccountIds: ["acc-b"] })))
      .toEqual({ OR: [{ id: { in: ["prj-a"] } }, { accountId: { in: ["acc-b"] } }] });
    expect(visibleProjectWhere(as("portal-2", [], { subjectType: "portal_user" }))).toEqual({ OR: [{ id: { in: [] } }, { accountId: { in: [] } }] });
    expect(visibleProjectWhere(as("svc", [], { subjectType: "service_account" }))).toEqual({});
  });

  it("hides revenue, cost and margin from everyone outside the cost permission group", () => {
    const summary = { id: "prj-1", name: "P", marginPercent: 31, budgetAmount: 900, spentAmount: 400, budgetCurrency: "VND", loggedMinutes: 60 };
    expect(withoutProjectFinancials(summary, as("usr-dx", ["DX"]))).toEqual({ id: "prj-1", name: "P", loggedMinutes: 60 });
    expect(JSON.parse(JSON.stringify(withoutProjectFinancials(summary, as("usr-admin", ["WORKSPACE_ADMIN"]))))).toEqual({ id: "prj-1", name: "P", loggedMinutes: 60 });
    expect(withoutProjectFinancials(summary, as("usr-dx", ["DX", "COST_VIEW"]))).toBe(summary);
    expect(withoutProjectFinancials(summary, as("usr-admin", ["FOUNDER_GM"]))).toBe(summary);
  });
});

describe("timesheet record visibility (7.7)", () => {
  it("gives an Admin in admin view the whole workspace, including business Admin roles", () => {
    const permissions = new ProjectPermissionsService({} as any);

    expect(permissions.timeRecordVisibilityWhere(as("usr-admin", ["PM"]))).toEqual({});
    expect(permissions.timeRecordVisibilityWhere(as("usr-admin", ["DX_DIRECTOR"]))).toEqual({});
    expect(permissions.timeRecordVisibilityWhere(as("usr-admin", ["BD_LEAD"]))).toEqual({});
  });

  it("narrows an Admin in user view back to their own/project records", () => {
    const permissions = new ProjectPermissionsService({} as any);
    const where = permissions.timeRecordVisibilityWhere(as("usr-admin", ["PM"], { viewMode: "user" }));

    expect(where).toHaveProperty("AND");
  });
});

describe("ProjectVisibilityGuard — every route that names a project", () => {
  const run = (prisma: any, principal: PrincipalContext, request: any) => {
    const guard = new ProjectVisibilityGuard(prisma, { resolveFromAuthorization: vi.fn().mockResolvedValue(principal) } as any);
    return guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method: "GET", headers: {}, params: {}, query: {}, ...request }) }) } as any);
  };

  it("lets a member through and answers 404 to a non-member, logging the out-of-scope access", async () => {
    const prisma = fakePrisma();
    await expect(run(prisma, as("usr-dx", ["DX"]), { params: { projectId: "prj-member" } })).resolves.toBe(true);
    await expect(run(prisma, as("usr-dx", ["DX"]), { params: { projectId: "prj-other" }, route: { path: "/projects/:projectId/hierarchy" } })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.policyDecisionLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.policyDecisionLog.create.mock.calls[0][0].data).toMatchObject({
      userId: "usr-dx", workspaceId: "twk-1", action: "READ", resource: "PROJECT", resourceId: "prj-other", decision: "DENY", reason: "project_out_of_scope",
      context: { path: "/projects/:projectId/hierarchy" }
    });
  });

  it("covers ?projectId= lists too, lets an Admin through, and narrows an Admin in user view", async () => {
    const prisma = fakePrisma();
    await expect(run(prisma, as("usr-dx", ["DX"]), { query: { projectId: "prj-other" } })).rejects.toBeInstanceOf(NotFoundException);
    await expect(run(prisma, as("usr-admin", ["BD_LEAD"]), { params: { projectId: "prj-other" } })).resolves.toBe(true);
    await expect(run(prisma, as("usr-admin", ["BD_LEAD"], { viewMode: "user" }), { method: "PATCH", params: { projectId: "prj-other" } })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.policyDecisionLog.create.mock.calls.map((call: any) => call[0].data.action)).toEqual(["READ", "UPDATE"]);
  });

  it("does not log a project that does not exist, and ignores routes without a project", async () => {
    const prisma = fakePrisma();
    await expect(run(prisma, as("usr-dx", ["DX"]), { params: { projectId: "prj-missing" } })).rejects.toBeInstanceOf(NotFoundException);
    await expect(run(prisma, as("usr-dx", ["DX"]), {})).resolves.toBe(true);
    expect(prisma.policyDecisionLog.create).not.toHaveBeenCalled();
  });
});

describe("ProjectsService applies the scope", () => {
  const service = (prisma: any) => new ProjectsService(prisma, {} as any, {} as any);

  it("listProjects adds the visibility clause for a User and not for an Admin", async () => {
    const prisma: any = { project: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) }, $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)) };
    await service(prisma).listProjects({}, as("usr-dx", ["DX"]));
    await service(prisma).listProjects({}, as("usr-admin", ["WORKSPACE_ADMIN"]));
    const [userWhere, adminWhere] = prisma.project.findMany.mock.calls.map((call: any) => call[0].where);
    expect(userWhere.AND).toEqual([visibleProjectWhere(as("usr-dx", ["DX"]))]);
    expect(prisma.project.count.mock.calls[0][0].where).toEqual(userWhere);
    expect(adminWhere).toEqual({ workspaceId: "twk-1" });
  });

  it("getProject answers 404 for a project outside the account's scope", async () => {
    const prisma: any = fakePrisma();
    await expect(service(prisma).getProject("prj-other", as("usr-dx", ["DX"]))).rejects.toBeInstanceOf(NotFoundException);
    expect(await canSeeProject(prisma, "prj-other", as("usr-dx", ["DX"]))).toBe(false);
    expect(await canSeeProject(prisma, "prj-member", as("usr-dx", ["DX"]))).toBe(true);
  });

  it("createTask: project membership or Admin (V-03)", async () => {
    const prisma: any = fakePrisma();
    prisma.account = { findFirst: vi.fn().mockResolvedValue({ id: "acc-1" }) };
    prisma.projectTask = { create: vi.fn() };
    await expect(service(prisma).createTask({ projectId: "prj-other", title: "T" } as any, as("usr-dx", ["DX"]))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.projectTask.create).not.toHaveBeenCalled();
  });
});
