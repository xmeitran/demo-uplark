import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { accountTypeOf, expandRoleCodes, type PrincipalContext } from "@b2b-crm/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { ProjectVisibilityGuard, visibleProjectWhere } from "../delivery-handoff/project-visibility";
import { AuthService } from "./auth.service";

/**
 * What the owner sets on the Users screen must be in the database afterwards, with an audit row.
 * Runs every save path of the screen against the real schema, inside ONE transaction that is always rolled back:
 * nothing this spec writes survives it, so it is safe on any database (it checks that itself at the end).
 *
 *   DATABASE_URL=… npx vitest run --config vitest.integration.config.ts src/modules/identity-access/business-role-roundtrip.integration-spec.ts
 */
const ROLLBACK = new Error("rollback");
const run = `roundtrip-${Date.now()}`;

describe.runIf(Boolean(process.env.DATABASE_URL))("Users screen saves → database round trip (rolled back)", () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it("business role, system role, cost permissions and view mode are stored and audited; grant rules hold on real rows", async () => {
    const bindingsBefore = await prisma.roleBinding.count();
    const auditsBefore = await prisma.auditEvent.count();

    await prisma.$transaction(async (tx) => {
      // The services open their own transaction; inside this spec that is the outer one, so the rollback covers everything.
      const db: any = new Proxy(tx, { get: (target: any, key) => (key === "$transaction" ? (input: any) => (typeof input === "function" ? input(tx) : Promise.all(input)) : target[key]) });
      const workspace = await tx.tenantWorkspace.findFirstOrThrow({ where: { status: "active", roleBindings: { some: { role: { code: "FOUNDER_GM" } } } } });
      const roleId = async (code: string) => (await tx.role.findUniqueOrThrow({ where: { code } })).id;
      const person = async (name: string, ...codes: string[]) => {
        const user = await tx.user.create({ data: { email: `${run}-${name}@example.test`, displayName: `${run} ${name}` } });
        for (const code of codes) await tx.roleBinding.create({ data: { userId: user.id, roleId: await roleId(code), tenantKey: workspace.tenantKey, workspaceId: workspace.id } });
        return user;
      };
      const founder = await person("founder", "FOUNDER_GM");
      const pm = await person("pm", "PM");
      const staff = await person("staff", "BD");
      const target = await person("target", "DELIVERY_LEAD");
      const principalOf = async (userId: string): Promise<PrincipalContext> => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { roleBindings: { where: { endsAt: null }, include: { role: true } } } });
        const held = user.roleBindings.map((binding) => binding.role.code);
        return { subjectType: "internal_user", subjectId: userId, displayName: user.displayName, tenantKey: workspace.tenantKey, workspaceId: workspace.id, workspaceKey: workspace.workspaceKey,
          roleCodes: expandRoleCodes(held), heldRoleCodes: held, accountType: accountTypeOf(held), viewMode: user.viewMode === "user" ? "user" : "admin",
          accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [], roleVersion: "r", grantVersion: "g" };
      };
      let actor = founder.id;
      const service = new AuthService(db, {} as any, { resolveFromAuthorization: () => principalOf(actor) } as any);
      const activeCodes = async (userId: string) => (await tx.roleBinding.findMany({ where: { userId, workspaceId: workspace.id, endsAt: null }, include: { role: true } })).map((binding) => binding.role.code).sort();
      const lastAudit = (userId: string, action: string) => tx.auditEvent.findFirst({ where: { resourceId: userId, action }, orderBy: { createdAt: "desc" } });
      const readBack = async (userId: string) => (await service.getUser("Bearer x", userId, true)).data;

      // 1. Business role → a real binding (not only the displayRole label), default cost group for PM, audit row.
      await service.updateResourceProfile("Bearer x", target.id, { businessRoleCode: "PM", systemRole: "WORKSPACE_USER", employmentStatus: "ACTIVE" });
      expect(await activeCodes(target.id)).toEqual(["COST_APPROVE", "COST_EDIT", "COST_EXPORT", "COST_VIEW", "DELIVERY_LEAD", "PM"]);
      expect(await lastAudit(target.id, "auth.member.business_role_changed")).toMatchObject({ actorUserId: founder.id, workspaceId: workspace.id, before: { businessRoleCodes: [], accountType: "USER" }, after: { businessRoleCode: "PM", accountType: "ADMIN" } });
      expect(await readBack(target.id)).toMatchObject({ businessRoleCode: "PM", accountType: "ADMIN", systemRole: "WORKSPACE_USER" });
      expect((await principalOf(target.id)).roleCodes).toEqual(expect.arrayContaining(["PM", "WORKSPACE_ADMIN", "DELIVERY_LEAD"]));

      // 2. Changing it replaces the binding (one business role per account) and the account is a User again.
      await service.updateResourceProfile("Bearer x", target.id, { businessRoleCode: "DX" });
      expect(await activeCodes(target.id)).toEqual(["COST_APPROVE", "COST_EDIT", "COST_EXPORT", "COST_VIEW", "DELIVERY_LEAD", "DX"]);
      expect(await tx.roleBinding.count({ where: { userId: target.id, role: { code: "PM" }, endsAt: { not: null } } })).toBe(1);
      expect(await lastAudit(target.id, "auth.member.business_role_changed")).toMatchObject({ before: { businessRoleCodes: ["PM"], accountType: "ADMIN" }, after: { businessRoleCode: "DX", accountType: "USER" } });
      expect(await readBack(target.id)).toMatchObject({ businessRoleCode: "DX", accountType: "USER" });

      // 3. Cost permissions: exactly the set chosen, audited.
      await service.updateCostPermissions("Bearer x", target.id, ["COST_VIEW"]);
      expect((await activeCodes(target.id)).filter((code) => code.startsWith("COST_"))).toEqual(["COST_VIEW"]);
      expect(await lastAudit(target.id, "auth.member.cost_permissions_changed")).toMatchObject({ after: { permissionCodes: ["COST_VIEW"] } });

      // 4. System role (binds WORKSPACE_ADMIN, a role row the migration adds) keeps the business role and the cost permission.
      await service.updateResourceProfile("Bearer x", target.id, { systemRole: "WORKSPACE_ADMIN", employmentStatus: "ACTIVE" });
      expect(await activeCodes(target.id)).toEqual(["COST_VIEW", "DX", "WORKSPACE_ADMIN"]);
      expect(await lastAudit(target.id, "auth.member.role_changed")).toMatchObject({ after: { systemRole: "WORKSPACE_ADMIN" } });
      expect(await readBack(target.id)).toMatchObject({ systemRole: "WORKSPACE_ADMIN", businessRoleCode: "DX", accountType: "ADMIN", costPermissionCodes: ["COST_VIEW"] });
      await service.updateResourceProfile("Bearer x", target.id, { systemRole: "WORKSPACE_USER", employmentStatus: "ACTIVE" });
      expect(await activeCodes(target.id)).toEqual(["COST_VIEW", "DX", "WORKSPACE_USER"]);

      // 5. Clearing the business role ends the binding and is audited.
      await service.updateResourceProfile("Bearer x", target.id, { businessRoleCode: null });
      expect(await activeCodes(target.id)).toEqual(["COST_VIEW", "WORKSPACE_USER"]);
      expect(await lastAudit(target.id, "auth.member.business_role_changed")).toMatchObject({ after: { businessRoleCode: null, accountType: "USER" } });

      // 6. Grant rules on real rows: a User account grants nothing; an Admin by business role (PM) grants; nobody but a Founder changes their own.
      actor = staff.id;
      await expect(service.updateResourceProfile("Bearer x", target.id, { businessRoleCode: "BD_LEAD" })).rejects.toBeInstanceOf(ForbiddenException);
      actor = pm.id;
      await expect(service.updateResourceProfile("Bearer x", pm.id, { businessRoleCode: "DX_DIRECTOR" })).rejects.toBeInstanceOf(ForbiddenException);
      await service.updateResourceProfile("Bearer x", target.id, { businessRoleCode: "BD_LEAD" });
      expect(await activeCodes(target.id)).toEqual(["BD_LEAD", "COST_VIEW", "WORKSPACE_USER"]); // already had a cost grant: defaults are not forced on top
      expect(await lastAudit(target.id, "auth.member.business_role_changed")).toMatchObject({ actorUserId: pm.id, after: { businessRoleCode: "BD_LEAD", accountType: "ADMIN" } });
      // The founder's own binding is untouched by a business-role save on the founder.
      actor = founder.id;
      await service.updateResourceProfile("Bearer x", founder.id, { businessRoleCode: "DX_DIRECTOR" });
      expect(await activeCodes(founder.id)).toEqual(["COST_APPROVE", "COST_EDIT", "COST_EXPORT", "COST_VIEW", "DX_DIRECTOR", "FOUNDER_GM"]);

      // 7. View mode: stored per account, audited, and it narrows the project list of that Admin.
      actor = target.id;
      await expect(service.setViewMode("Bearer x", "user")).resolves.toEqual({ viewMode: "user" });
      expect((await tx.user.findUniqueOrThrow({ where: { id: target.id } })).viewMode).toBe("user");
      expect(await lastAudit(target.id, "auth.view_mode_changed")).toMatchObject({ actorUserId: target.id, before: { viewMode: "admin" }, after: { viewMode: "user" } });
      actor = staff.id;
      await expect(service.setViewMode("Bearer x", "user")).rejects.toBeInstanceOf(ForbiddenException);

      // 8. Project visibility against the real schema: Admin sees all, an Admin in user view / a User with no assignment sees only the internal worklog,
      //    an existing project member sees their projects; an out-of-scope open is answered 404 and logged.
      const visible = (principal: PrincipalContext) => tx.project.findMany({ where: { workspaceId: workspace.id, AND: [visibleProjectWhere(principal)] }, select: { id: true, projectType: true } });
      const all = await tx.project.count({ where: { workspaceId: workspace.id } });
      expect(await visible(await principalOf(founder.id))).toHaveLength(all);
      for (const userId of [target.id, staff.id]) expect((await visible(await principalOf(userId))).every((project) => project.projectType === "internal_worklog")).toBe(true);
      const membership = await tx.projectMember.findFirst({ where: { workspaceId: workspace.id, project: { projectType: "delivery" } } });
      if (membership) {
        const asMember = { ...(await principalOf(staff.id)), subjectId: membership.userId };
        expect((await visible(asMember)).map((project) => project.id)).toContain(membership.projectId);
        expect((await visible(await principalOf(staff.id))).map((project) => project.id)).not.toContain(membership.projectId);
        const guard = new ProjectVisibilityGuard(db, { resolveFromAuthorization: () => principalOf(staff.id) } as any);
        const request = { method: "GET", headers: {}, query: {}, params: { projectId: membership.projectId }, route: { path: "/projects/:projectId" } };
        await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any)).rejects.toBeInstanceOf(NotFoundException);
        expect(await tx.policyDecisionLog.findFirst({ where: { userId: staff.id, resourceId: membership.projectId } })).toMatchObject({ decision: "DENY", resource: "PROJECT", action: "READ", reason: "project_out_of_scope" });
      }

      throw ROLLBACK;
    }, { timeout: 60000, maxWait: 15000 }).catch((error) => { if (error !== ROLLBACK) throw error; });

    // Nothing survived: no test user, no binding, no audit row.
    expect(await prisma.user.count({ where: { email: { startsWith: run } } })).toBe(0);
    expect(await prisma.roleBinding.count()).toBe(bindingsBefore);
    expect(await prisma.auditEvent.count()).toBeGreaterThanOrEqual(auditsBefore);
    expect(await prisma.auditEvent.count({ where: { action: { in: ["auth.member.business_role_changed", "auth.view_mode_changed"] }, resource: "user", after: { path: ["businessRoleCode"], equals: "BD_LEAD" } } })).toBe(0);
  });
});
