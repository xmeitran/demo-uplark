import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { BusinessRolesService } from "./business-roles.service";

const admin = { subjectType: "internal_user", subjectId: "usr-admin", workspaceId: "twk-1", tenantKey: "prod", roleCodes: ["WORKSPACE_ADMIN"] } as any;
const member = { ...admin, subjectId: "usr-dx", roleCodes: ["DX", "WORKSPACE_USER"] };

function setup(rows: Array<{ code: string; label: string; hidden?: boolean }> = []) {
  const prisma: any = {
    workspaceBusinessRole: { findMany: vi.fn().mockResolvedValue(rows.map((row) => ({ hidden: false, ...row }))), create: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    roleBinding: {
      findMany: vi.fn().mockResolvedValue([
        { userId: "u1", role: { code: "PM", baseRoleCode: null } }, { userId: "u1", role: { code: "BR_LEAD", baseRoleCode: "PM" } }, { userId: "u1", role: { code: "FOUNDER_GM", baseRoleCode: null } },
        { userId: "u2", role: { code: "PM", baseRoleCode: null } }, { userId: "u2", role: { code: "WORKSPACE_ADMIN", baseRoleCode: null } }
      ]),
      count: vi.fn().mockResolvedValue(0)
    },
    role: { findMany: vi.fn().mockResolvedValue([{ code: "BR_LEAD", baseRoleCode: "PM" }]), create: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops)
  };
  return { service: new BusinessRolesService(prisma), prisma };
}

describe("BusinessRolesService (Admin › Setting)", () => {
  it("lists renamed built-in roles and own roles; a person with an own role counts there, not under its base", async () => {
    const { service } = setup([{ code: "BD", label: "Business development" }, { code: "BR_LEAD", label: "Team lead" }]);
    const { data } = await service.list(member);
    const byCode = new Map(data.businessRoles.map((role) => [role.code, role]));
    expect(byCode.get("BD")).toMatchObject({ label: "Business development", builtIn: true });
    expect(byCode.get("BR_LEAD")).toMatchObject({ label: "Team lead", baseRoleCode: "PM", accountType: "ADMIN", builtIn: false, memberCount: 1 });
    expect(byCode.get("PM")?.memberCount).toBe(1);
    expect(data.systemRoles.find((role) => role.code === "FOUNDER_GM")?.memberCount).toBe(1);
  });

  it("only an Admin changes the list; a new role needs a built-in base and a name not already used", async () => {
    const { service, prisma } = setup([{ code: "BD", label: "Business development" }]);
    await expect(service.create(member, { label: "Team lead", baseRoleCode: "PM" })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create(admin, { label: "Team lead", baseRoleCode: "FOUNDER_GM" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(admin, { label: "business DEVELOPMENT", baseRoleCode: "BD" })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create(admin, { label: "  Team   lead ", baseRoleCode: "PM" })).resolves.toMatchObject({ label: "Team lead", baseRoleCode: "PM" });
    expect(prisma.role.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "Team lead", baseRoleCode: "PM", code: expect.stringMatching(/^BR_/) }) });
  });

  it("built-in roles are hidden, never deleted; an own role is deleted only once nobody holds it", async () => {
    const { service, prisma } = setup();
    await expect(service.remove(admin, "PM")).rejects.toBeInstanceOf(BadRequestException);
    prisma.workspaceBusinessRole.findUnique.mockResolvedValue({ code: "BR_LEAD", label: "Team lead" });
    prisma.roleBinding.count.mockResolvedValue(2);
    await expect(service.remove(admin, "BR_LEAD")).rejects.toBeInstanceOf(ConflictException);
    prisma.roleBinding.count.mockResolvedValue(0);
    await expect(service.remove(admin, "BR_LEAD")).resolves.toEqual({ deleted: true });
  });
});
