import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { AccountsService } from "./accounts.service";

const base: PrincipalContext = {
  subjectType: "internal_user", subjectId: "usr-1", displayName: "U", tenantKey: "prod", workspaceId: "twk-1", workspaceKey: "default",
  roleCodes: ["SALES_OWNER"], accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [], roleVersion: "r", grantVersion: "g"
};

function setup(account: Record<string, unknown> = { id: "acc-1", code: "ACC", name: "Acme", stage: "new", picUserId: "usr-pic" }) {
  const prisma: any = {
    account: { findFirst: vi.fn().mockResolvedValue(account), create: vi.fn(), update: vi.fn(), delete: vi.fn().mockResolvedValue(account) },
    contact: { findFirst: vi.fn().mockResolvedValue({ id: "ct-1" }), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    project: { count: vi.fn().mockResolvedValue(0) }, opportunity: { count: vi.fn().mockResolvedValue(0) }, projectTask: { count: vi.fn().mockResolvedValue(0) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops))
  };
  return { prisma, service: new AccountsService(prisma) };
}

describe("AccountsService write permissions", () => {
  it("rejects every account and contact write from a portal user", async () => {
    const { prisma, service } = setup();
    const portal: PrincipalContext = { ...base, subjectType: "portal_user", roleCodes: [], customerAccountIds: ["acc-1"] };
    await expect(service.createAccount({ code: "x", name: "x" } as any, portal)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateAccount("acc-1", { name: "y" } as any, portal)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteAccount("acc-1", portal)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createContact("acc-1", { name: "c" } as any, portal)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateContact("acc-1", "ct-1", { name: "c" } as any, portal)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteContact("acc-1", "ct-1", portal)).rejects.toBeInstanceOf(ForbiddenException);
    for (const model of [prisma.account, prisma.contact]) {
      expect(model.create).not.toHaveBeenCalled();
      expect(model.update).not.toHaveBeenCalled();
      expect(model.delete).not.toHaveBeenCalled();
    }
  });

  it("lets only the account PIC or a workspace admin delete an account, and audits it", async () => {
    const { prisma, service } = setup();
    await expect(service.deleteAccount("acc-1", base)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.account.delete).not.toHaveBeenCalled();

    await expect(service.deleteAccount("acc-1", { ...base, subjectId: "usr-pic" })).resolves.toEqual({ deleted: true, id: "acc-1" });
    await expect(service.deleteAccount("acc-1", { ...base, roleCodes: ["WORKSPACE_ADMIN"] })).resolves.toEqual({ deleted: true, id: "acc-1" });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "account.deleted", resourceId: "acc-1", before: expect.objectContaining({ code: "ACC", name: "Acme" }) }) });
  });
});

describe("AccountsService money visibility (annual value is for the cost permission group)", () => {
  const row = { id: "acc-1", code: "ACC", name: "Acme", stage: "new", annualValue: 120000000 };
  const viewers: PrincipalContext[] = ["FOUNDER_GM", "COST_VIEW", "COST_EDIT", "COST_APPROVE", "COST_EXPORT"].map((role) => ({ ...base, roleCodes: ["SALES_OWNER", role] }));

  function setupList() {
    const ctx = setup(row);
    ctx.prisma.account.findMany = vi.fn().mockResolvedValue([row]);
    ctx.prisma.account.count = vi.fn().mockResolvedValue(1);
    ctx.prisma.account.create.mockResolvedValue(row);
    ctx.prisma.account.update.mockResolvedValue(row);
    return ctx;
  }

  it("strips annualValue from list, detail, create and update answers for everyone else", async () => {
    const { service } = setupList();
    for (const principal of [base, { ...base, roleCodes: ["PM", "WORKSPACE_ADMIN"] }]) {
      const list = await service.listAccounts({}, principal);
      expect(list.data[0]).not.toHaveProperty("annualValue");
      expect(list.meta.hiddenFields).toEqual(["annualValue"]);
      expect(await service.getAccount("acc-1", principal)).not.toHaveProperty("annualValue");
      expect(await service.createAccount({ code: "ACC", name: "Acme" } as any, principal)).not.toHaveProperty("annualValue");
      expect(await service.updateAccount("acc-1", { name: "Acme" } as any, principal)).not.toHaveProperty("annualValue");
    }
  });

  it("keeps annualValue for every cost permission and Founder/GM", async () => {
    const { service } = setupList();
    for (const principal of viewers) {
      const list = await service.listAccounts({}, principal);
      expect(list.data[0].annualValue).toBe(120000000);
      expect(list.meta.hiddenFields).toEqual([]);
      expect((await service.getAccount("acc-1", principal)).annualValue).toBe(120000000);
    }
  });

  it("ignores an annualValue written by a viewer who cannot see it", async () => {
    const { prisma, service } = setupList();
    await service.updateAccount("acc-1", { name: "Acme", annualValue: 0 } as any, base);
    expect(prisma.account.update.mock.calls[0][0].data.annualValue).toBeUndefined();
    await service.createAccount({ code: "ACC", name: "Acme", annualValue: 5 } as any, base);
    expect(prisma.account.create.mock.calls[0][0].data.annualValue).toBe(0);
    await service.updateAccount("acc-1", { annualValue: 7 } as any, viewers[1]);
    expect(prisma.account.update.mock.calls[1][0].data.annualValue).toBe(7);
  });
});
