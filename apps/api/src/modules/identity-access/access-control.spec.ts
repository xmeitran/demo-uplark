import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_ROLE_CODES, BUSINESS_ROLE_CATALOGUE, BUSINESS_ROLE_CODES, LEADER_ROLE_CODES, PERMISSION_MATRIX, ROLE_CATALOGUE,
  accountTypeOf, businessRoleOf, can, expandRoleCodes, isAdminAccount, type PermissionAction, type PrincipalContext
} from "@b2b-crm/contracts";
import { canApproveCost, canEditCost, canExportCost, canViewCost } from "../resource-controls/cost-permissions";
import { isWorkspaceAdmin } from "../delivery-handoff/milestone-reviewer";
import { AuthService } from "./auth.service";

describe("role catalogue — Hai loại tài khoản: Admin và User", () => {
  it("gives every role the document names its account type", () => {
    const type = Object.fromEntries(BUSINESS_ROLE_CATALOGUE.map((role) => [role.label, role.accountType]));
    expect(type).toEqual({ PM: "ADMIN", "Dx Director": "ADMIN", "BD Lead": "ADMIN", BD: "USER", Dx: "USER", PQA: "USER", CS: "USER", "Kế toán": "USER" });
  });

  it("maps the existing technical roles: Founder/GM and Workspace Admin are Admin, the rest stay User as today", () => {
    const technical = Object.fromEntries(ROLE_CATALOGUE.filter((role) => role.kind === "technical").map((role) => [role.code, role.accountType]));
    expect(technical).toEqual({ FOUNDER_GM: "ADMIN", WORKSPACE_ADMIN: "ADMIN", DELIVERY_LEAD: "USER", SALES_OWNER: "USER", WORKSPACE_USER: "USER" });
    expect(ROLE_CATALOGUE.filter((role) => role.kind === "technical").every((role) => role.equivalentTo)).toBe(true);
    expect([...ADMIN_ROLE_CODES].sort()).toEqual(["BD_LEAD", "DX_DIRECTOR", "FOUNDER_GM", "PM", "WORKSPACE_ADMIN"]);
  });

  it("has no Leader role: the document uses Leader for Dx Director and BD Lead", () => {
    expect(ROLE_CATALOGUE.some((role) => role.code === "LEADER")).toBe(false);
    expect(LEADER_ROLE_CODES).toEqual(["DX_DIRECTOR", "BD_LEAD"]);
  });

  it("derives the account type from the roles held", () => {
    expect(accountTypeOf(["PM"])).toBe("ADMIN");
    expect(accountTypeOf(["BD", "COST_VIEW"])).toBe("USER");
    expect(accountTypeOf(["DELIVERY_LEAD", "SALES_OWNER", "FINANCE_ADMIN", "WORKSPACE_USER"])).toBe("USER");
    expect(accountTypeOf([])).toBe("USER");
    expect(isAdminAccount({ roleCodes: ["WORKSPACE_USER", "BD_LEAD"] })).toBe(true);
    expect(businessRoleOf(["FOUNDER_GM", "DX", "COST_VIEW"])).toBe("DX");
  });

  it("makes the role strings other modules compare against real: a business role implies its technical codes", () => {
    expect(expandRoleCodes(["PM"])).toEqual(["PM", "WORKSPACE_ADMIN", "DELIVERY_LEAD"]);
    expect(expandRoleCodes(["BD_LEAD"])).toEqual(["BD_LEAD", "WORKSPACE_ADMIN", "SALES_OWNER"]);
    expect(expandRoleCodes(["DX_DIRECTOR"])).toEqual(["DX_DIRECTOR", "WORKSPACE_ADMIN"]);
    expect(expandRoleCodes(["BD", "COST_VIEW"])).toEqual(["BD", "SALES_OWNER", "COST_VIEW"]);
    expect(expandRoleCodes(["FOUNDER_GM", "DELIVERY_LEAD"])).toEqual(["FOUNDER_GM", "DELIVERY_LEAD"]);
    for (const code of ["PM", "DX_DIRECTOR", "BD_LEAD"]) expect(isWorkspaceAdmin(expandRoleCodes([code]))).toBe(true);
    for (const code of ["BD", "DX", "PQA", "CS", "FINANCE_ADMIN"]) expect(isWorkspaceAdmin(expandRoleCodes([code]))).toBe(false);
  });
});

describe("permission matrix — mục 7.7 Quyền xem và sửa", () => {
  const staff = { roleCodes: expandRoleCodes(["DX"]) };
  const member = { ...staff, isProjectMember: true };
  const pic = { ...staff, isProjectPic: true };
  const admin = { roleCodes: expandRoleCodes(["BD_LEAD"]), heldRoleCodes: ["BD_LEAD"] };
  const row = (action: PermissionAction) => [can(action, staff), can(action, member), can(action, pic), can(action, admin)];

  // One entry per line of 7.7: [outsider User, project member, project PIC, Admin (BD Lead, no cost permission)].
  const expected: Record<PermissionAction, boolean[]> = {
    // User - nhân sự: Thấy
    "project.view": [false, true, true, true],
    "project.tasks.view": [false, true, true, true],
    "warning.view_own": [true, true, true, true],
    "project.financials.view": [false, false, false, false],
    "project.status_proposal.view": [false, false, true, true],
    // User - nhân sự: Sửa
    "subtask.edit_own": [true, true, true, true],
    "time_entry.edit_own": [true, true, true, true],
    "issue.report": [false, true, true, true],
    "task.create": [false, true, true, true],
    "client.create": [true, true, true, true],
    "project.create": [true, true, true, true],
    // User - PIC dự án
    "project.view_full": [false, false, true, true],
    "project.status.confirm": [false, false, true, true],
    "project.plan.update": [false, false, true, true],
    "gate.submit": [false, false, true, true],
    // Admin - PM, Dx Director, BD Lead
    "project.view_all": [false, false, false, true],
    "warning.view_all": [false, false, false, true],
    "admin.tab": [false, false, false, true],
    "admin.config.milestone_templates": [false, false, false, true],
    "admin.config.alert_thresholds": [false, false, false, true],
    "admin.config.days_off": [false, false, false, true],
    "admin.config.lark_reminders": [false, false, false, true],
    "admin.config.pnl": [false, false, false, true],
    "admin.audit_history": [false, false, false, true],
    "staff_profile.manage": [false, false, false, true],
    "project.pic.change": [false, false, false, false], // PM and Dx Director only — not BD Lead
    "gate.approve": [false, false, false, true],
    "plan.approve": [false, false, false, true],
    "issue.classify": [false, false, false, true],
    // Admin - nhóm quyền chi phí: granted per person, not implied by Admin
    "cost.view": [false, false, false, false],
    "cost.edit": [false, false, false, false],
    "cost.approve": [false, false, false, false],
    "cost.export": [false, false, false, false],
    "view_mode.switch": [false, false, false, true]
  };

  it("enumerates every line of the matrix", () => {
    expect(Object.keys(expected).sort()).toEqual(Object.keys(PERMISSION_MATRIX).sort());
    for (const action of Object.keys(PERMISSION_MATRIX) as PermissionAction[]) expect([action, row(action)]).toEqual([action, expected[action]]);
  });

  it("ghi User thì Admin cũng làm được; ghi Admin thì User không làm được", () => {
    for (const [action, { grant }] of Object.entries(PERMISSION_MATRIX) as Array<[PermissionAction, { grant: string }]>) {
      if (["USER", "PROJECT_MEMBER", "PROJECT_PIC", "ADMIN"].includes(grant)) expect([action, can(action, admin)]).toEqual([action, true]);
      if (grant === "ADMIN") expect([action, can(action, { ...staff, isProjectMember: true, isProjectPic: true })]).toEqual([action, false]);
    }
  });

  it("PM và Dx Director đổi PIC; Founder/GM and Workspace Admin hold every Admin right", () => {
    for (const code of ["PM", "DX_DIRECTOR", "FOUNDER_GM", "WORKSPACE_ADMIN"]) expect(can("project.pic.change", { roleCodes: expandRoleCodes([code]), heldRoleCodes: [code] })).toBe(true);
    for (const code of ["BD_LEAD", "BD", "DELIVERY_LEAD"]) expect(can("project.pic.change", { roleCodes: expandRoleCodes([code]), heldRoleCodes: [code] })).toBe(false);
  });

  it("cost lines agree with the cost permission helpers the endpoints use", () => {
    const principal = (roleCodes: string[]) => ({ roleCodes }) as PrincipalContext;
    for (const roleCodes of [["FOUNDER_GM"], ["WORKSPACE_ADMIN"], ["PM"], ["COST_VIEW"], ["COST_EDIT"], ["COST_APPROVE"], ["COST_EXPORT"], ["WORKSPACE_USER"]]) {
      expect([roleCodes, can("cost.view", { roleCodes }), can("cost.edit", { roleCodes }), can("cost.approve", { roleCodes }), can("cost.export", { roleCodes })])
        .toEqual([roleCodes, canViewCost(principal(roleCodes)), canEditCost(principal(roleCodes)), canApproveCost(principal(roleCodes)), canExportCost(principal(roleCodes))]);
    }
  });
});

describe("granting a business role (Users › Vai trò nghiệp vụ)", () => {
  function setup(actor: { subjectId?: string; roleCodes: string[] }, targetRoleCodes: string[] = ["DELIVERY_LEAD"]) {
    const bindings = targetRoleCodes.map((code) => ({ id: `rb-${code}`, role: { code }, startsAt: new Date(0), endsAt: null }));
    const tx: any = {
      $executeRaw: vi.fn(),
      user: { findFirst: vi.fn().mockResolvedValue({ id: "usr-target", status: "ACTIVE", resourceProfile: null, roleBindings: bindings }), update: vi.fn().mockResolvedValue({ id: "usr-target", status: "ACTIVE" }), count: vi.fn().mockResolvedValue(1) },
      role: { findUnique: vi.fn(async ({ where }: any) => ({ id: `role-${where.code}`, code: where.code })), findUniqueOrThrow: vi.fn(async ({ where }: any) => ({ id: `role-${where.code}`, code: where.code })) },
      roleBinding: { findFirst: vi.fn(async ({ where }: any) => (where.role?.code?.in ? (where.role.code.in.some((code: string) => actor.roleCodes.includes(code)) ? { id: "rb-actor" } : null) : null)), updateMany: vi.fn(), upsert: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      portalSession: { updateMany: vi.fn() },
      resourceProfile: { upsert: vi.fn().mockResolvedValue({ displayRole: null }) },
      auditEvent: { create: vi.fn() }
    };
    const prisma: any = { ...tx, $transaction: vi.fn(async (fn: any) => fn(tx)) };
    const principal = { subjectType: "internal_user", subjectId: actor.subjectId ?? "usr-actor", workspaceId: "twk-1", tenantKey: "prod", roleCodes: expandRoleCodes(actor.roleCodes), heldRoleCodes: actor.roleCodes };
    const service = new AuthService(prisma, {} as any, { resolveFromAuthorization: vi.fn().mockResolvedValue(principal) } as any);
    const audits = () => tx.auditEvent.create.mock.calls.map((call: any) => call[0].data);
    const bound = () => tx.roleBinding.upsert.mock.calls.map((call: any) => call[0].create.roleId);
    return { service, tx, audits, bound };
  }

  it("an Admin grants PM: a real binding, the default cost permission group, and an audit row saying the account became Admin", async () => {
    const { service, tx, audits, bound } = setup({ roleCodes: ["WORKSPACE_ADMIN"] });
    await service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: "PM" });
    expect(bound()).toEqual(["role-PM", "role-COST_VIEW", "role-COST_EDIT", "role-COST_APPROVE", "role-COST_EXPORT"]);
    expect(tx.portalSession.updateMany).toHaveBeenCalled();
    expect(audits().find((audit: any) => audit.action === "auth.member.business_role_changed")).toMatchObject({
      actorUserId: "usr-actor", resourceId: "usr-target",
      before: { businessRoleCodes: [], accountType: "USER" }, after: { businessRoleCode: "PM", accountType: "ADMIN" }
    });
  });

  it("never touches the Founder/GM binding or any role outside the business catalogue", async () => {
    const { service, tx, bound } = setup({ roleCodes: ["FOUNDER_GM"] }, ["FOUNDER_GM", "DELIVERY_LEAD", "BD"]);
    await service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: "DX" });
    expect(tx.roleBinding.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.roleBinding.updateMany.mock.calls[0][0].where.role).toEqual({ code: { in: BUSINESS_ROLE_CODES } });
    expect(bound()).toEqual(["role-DX"]);
  });

  it("a business role held by an Admin (PM) is enough to grant; a User account (BD, Delivery Lead) cannot grant anything", async () => {
    await expect(setup({ roleCodes: ["PM"] }).service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: "BD_LEAD" })).resolves.toBeTruthy();
    for (const roleCodes of [["BD"], ["DELIVERY_LEAD"], ["DX", "COST_EDIT"]]) {
      const { service, tx } = setup({ roleCodes });
      await expect(service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: "PM" })).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.roleBinding.upsert).not.toHaveBeenCalled();
    }
  });

  it("setting a person inactive in one workspace does not suspend their login while another workspace still has them", async () => {
    const shared = setup({ roleCodes: ["WORKSPACE_ADMIN"] });
    shared.tx.roleBinding.count.mockResolvedValue(1);
    await shared.service.updateResourceProfile("Bearer a", "usr-target", { employmentStatus: "INACTIVE" });
    expect(shared.tx.user.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "SUSPENDED" } }));
    expect(shared.tx.roleBinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: "twk-1" }), data: { endsAt: expect.any(Date) } }));

    const only = setup({ roleCodes: ["WORKSPACE_ADMIN"] });
    await only.service.updateResourceProfile("Bearer a", "usr-target", { employmentStatus: "INACTIVE" });
    expect(only.tx.user.update).toHaveBeenCalledWith({ where: { id: "usr-target" }, data: { status: "SUSPENDED" } });
  });

  it("restoring an ended Founder/GM membership through the profile needs a Founder/GM, like reactivateUser", async () => {
    const founderBinding = { id: "rb-old", role: { code: "FOUNDER_GM" }, startsAt: new Date(0), endsAt: new Date(1) };
    const restore = (roleCodes: string[]) => {
      const ctx = setup({ roleCodes }, []);
      const base = ctx.tx.roleBinding.findFirst.getMockImplementation();
      ctx.tx.roleBinding.findFirst.mockImplementation(async (args: any) => (args.where.role?.code?.notIn ? founderBinding : base(args)));
      return ctx;
    };
    const admin = restore(["WORKSPACE_ADMIN"]);
    await expect(admin.service.updateResourceProfile("Bearer a", "usr-target", { employmentStatus: "ACTIVE" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.tx.roleBinding.upsert).not.toHaveBeenCalled();
    await expect(restore(["FOUNDER_GM"]).service.updateResourceProfile("Bearer a", "usr-target", { employmentStatus: "ACTIVE" })).resolves.toBeTruthy();
  });

  it("no self-escalation: only a Founder/GM changes their own business role", async () => {
    const admin = setup({ subjectId: "usr-target", roleCodes: ["WORKSPACE_ADMIN"] });
    await expect(admin.service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: "PM" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.tx.roleBinding.upsert).not.toHaveBeenCalled();
    const founder = setup({ subjectId: "usr-target", roleCodes: ["FOUNDER_GM"] }, ["FOUNDER_GM"]);
    await expect(founder.service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: "PM" })).resolves.toBeTruthy();
  });

  it("rejects a code outside the catalogue and does nothing when the role is unchanged", async () => {
    const { service, tx } = setup({ roleCodes: ["FOUNDER_GM"] }, ["BD"]);
    await expect(service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: "FOUNDER_GM" as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: "LEADER" as any })).rejects.toBeInstanceOf(BadRequestException);
    await service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: "BD" });
    expect(tx.roleBinding.upsert).not.toHaveBeenCalled();
  });

  it("one business role per account: the previous one is ended; clearing ends it without binding another", async () => {
    const { service, tx, audits, bound } = setup({ roleCodes: ["FOUNDER_GM"] }, ["PM", "COST_VIEW"]);
    await service.updateResourceProfile("Bearer a", "usr-target", { businessRoleCode: null });
    expect(tx.roleBinding.updateMany).toHaveBeenCalledTimes(1);
    expect(bound()).toEqual([]);
    expect(audits().find((audit: any) => audit.action === "auth.member.business_role_changed")).toMatchObject({ before: { businessRoleCodes: ["PM"], accountType: "ADMIN" }, after: { businessRoleCode: null, accountType: "USER" } });
  });

  it("only an Admin switches view mode, and the switch is audited", async () => {
    const user = setup({ roleCodes: ["BD"] });
    await expect(user.service.setViewMode("Bearer a", "user")).rejects.toBeInstanceOf(ForbiddenException);
    const admin = setup({ roleCodes: ["DX_DIRECTOR"] });
    await expect(admin.service.setViewMode("Bearer a", "sideways")).rejects.toBeInstanceOf(BadRequestException);
    await expect(admin.service.setViewMode("Bearer a", "user")).resolves.toEqual({ viewMode: "user" });
    expect(admin.tx.user.update).toHaveBeenCalledWith({ where: { id: "usr-actor" }, data: { viewMode: "user" } });
    expect(admin.audits()[0]).toMatchObject({ action: "auth.view_mode_changed", before: { viewMode: "admin" }, after: { viewMode: "user" } });
  });
});
