import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { PaymentsService } from "./finance-signal/payments.service";
import { ProposalPackagesService } from "./proposal-governance/proposal-packages.service";
import { ArtifactsService } from "./artifact-mgmt/artifacts.service";
import { TicketsService } from "./customer-experience/tickets.service";

// Review 19/10/2026, group A: money, approvals, files and tickets follow the same 7.7 scope as projects.
const base: PrincipalContext = {
  subjectType: "internal_user", subjectId: "usr-1", displayName: "U", email: "u@example.com", tenantKey: "prod", workspaceId: "twk-1",
  workspaceKey: "default", roleCodes: ["WORKSPACE_USER"], accountIds: [], projectIds: [], customerAccountIds: [], customerProjectIds: [],
  roleVersion: "r", grantVersion: "g"
};
const as = (overrides: Partial<PrincipalContext>): PrincipalContext => ({ ...base, ...overrides });
const portal = as({ subjectType: "portal_user", subjectId: "portal-1", roleCodes: [], customerAccountIds: ["acc-1"], customerProjectIds: ["prj-1"] });

describe("payments (A1)", () => {
  const prisma: any = {
    paymentSchedule: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    account: { findFirst: vi.fn().mockResolvedValue({ id: "acc-1", code: "ACC" }) },
    contract: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (input: any) => (Array.isArray(input) ? Promise.all(input) : input(prisma)))
  };
  const service = new PaymentsService(prisma);

  it("lists schedules and AR only for internal accounts holding a cost permission", async () => {
    await expect(service.listSchedules({}, as({ roleCodes: ["WORKSPACE_USER"] }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.arAging(portal)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listSchedules({}, as({ roleCodes: ["COST_VIEW"] }))).resolves.toMatchObject({ data: [] });
  });

  it("refuses a contract of another workspace", async () => {
    await expect(service.createSchedule({ accountId: "acc-1", contractId: "ctr-other", title: "T" } as any, as({ roleCodes: ["FOUNDER_GM"] }))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.contract.findFirst).toHaveBeenCalledWith({ where: { id: "ctr-other", workspaceId: "twk-1" }, select: { id: true } });
  });
});

describe("proposal approvals (A2)", () => {
  function setup(request: Record<string, unknown> = {}) {
    const prisma: any = {
      dealApprovalRequest: {
        findFirst: vi.fn().mockResolvedValue({ id: "req-1", proposalPackageId: "pp-1", requiredRoleCode: "FOUNDER_GM", requestedByUserId: "usr-bd", status: "SUBMITTED", ...request }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      dealApprovalDecision: { create: vi.fn() },
      proposalPackage: { update: vi.fn(), findFirst: vi.fn().mockResolvedValue({ id: "pp-1" }) }
    };
    prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
    const service = new ProposalPackagesService(prisma);
    vi.spyOn(service, "get").mockResolvedValue({ id: "pp-1" } as any);
    return { prisma, service };
  }

  it("only the required role decides, never the requester, and only once", async () => {
    const bd = setup();
    await expect(bd.service.recordDecision("pp-1", "req-1", { decision: "approved" } as any, as({ subjectId: "usr-bd", roleCodes: ["BD"] }))).rejects.toBeInstanceOf(ForbiddenException);
    const self = setup({ requestedByUserId: "usr-founder" });
    await expect(self.service.recordDecision("pp-1", "req-1", { decision: "approved" } as any, as({ subjectId: "usr-founder", roleCodes: ["FOUNDER_GM"] }))).rejects.toBeInstanceOf(ForbiddenException);
    const decided = setup();
    decided.prisma.dealApprovalRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(decided.service.recordDecision("pp-1", "req-1", { decision: "approved" } as any, as({ subjectId: "usr-founder", roleCodes: ["FOUNDER_GM"] }))).rejects.toBeInstanceOf(ConflictException);
    expect(decided.prisma.proposalPackage.update).not.toHaveBeenCalled();
    const founder = setup();
    await founder.service.recordDecision("pp-1", "req-1", { decision: "approved" } as any, as({ subjectId: "usr-founder", roleCodes: ["FOUNDER_GM"] }));
    expect(founder.prisma.proposalPackage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "INTERNALLY_APPROVED" }) }));
  });

  it("a plain edit cannot jump to an approved, sent or accepted status", async () => {
    const { service, prisma } = setup();
    await expect(service.update("pp-1", { status: "customer_accepted" } as any, as({}))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.proposalPackage.update).not.toHaveBeenCalled();
  });
});

describe("files (A3)", () => {
  function listWhere(principal: PrincipalContext) {
    const prisma: any = { fileObject: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) } };
    prisma.$transaction = vi.fn(async (input: any[]) => Promise.all(input));
    return new ArtifactsService(prisma).listFiles({}, principal).then(() => prisma.fileObject.findMany.mock.calls[0][0].where);
  }

  it("a User sees files of the projects they may see; customers only shared files of their grants; Admins all", async () => {
    expect((await listWhere(as({ roleCodes: ["WORKSPACE_USER"] }))).AND[0]).toMatchObject({ OR: [{ projectId: null }, { project: expect.any(Object) }] });
    expect((await listWhere(portal)).AND[0]).toEqual({ customerVisible: true, internalOnly: false, OR: [{ projectId: { in: ["prj-1"] } }, { accountId: { in: ["acc-1"] } }] });
    expect((await listWhere(as({ roleCodes: ["FOUNDER_GM"] }))).AND[0]).toEqual({});
  });
});

describe("tickets (A8)", () => {
  const row = { id: "t-1", accountId: "acc-1", status: "open", internalNote: "secret", statusHistory: [{ id: "h-1", internalNote: "secret" }] };
  function setup() {
    const prisma: any = { ticket: { findMany: vi.fn().mockResolvedValue([row]), count: vi.fn().mockResolvedValue(1), findFirst: vi.fn().mockResolvedValue(row) } };
    prisma.$transaction = vi.fn(async (input: any) => (Array.isArray(input) ? Promise.all(input) : input(prisma)));
    return { prisma, service: new TicketsService(prisma) };
  }

  it("customers list only their grants' tickets, never see internal notes and cannot change a ticket", async () => {
    const { prisma, service } = setup();
    const listed = await service.list({}, portal);
    expect(prisma.ticket.findMany.mock.calls[0][0].where).toMatchObject({ OR: [{ accountId: { in: ["acc-1"] } }, { projectId: { in: ["prj-1"] } }] });
    expect(listed.data[0].internalNote).toBeUndefined();
    expect(listed.data[0].statusHistory?.[0].internalNote).toBeUndefined();
    await expect(service.update("t-1", { status: "closed" } as any, portal)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await setup().service.list({}, as({}))).data[0].internalNote).toBe("secret");
  });
});
