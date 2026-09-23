import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { describe, expect, it, vi } from "vitest";
import { ProjectsService } from "./projects.service";

const editor: PrincipalContext = {
  subjectId: "user-delivery",
  subjectType: "internal_user",
  displayName: "Delivery Lead",
  tenantKey: "tenant-test",
  workspaceId: "workspace-a",
  workspaceKey: "workspace-a",
  roleCodes: ["DELIVERY_LEAD"],
  accountIds: [],
  projectIds: [],
  customerAccountIds: [],
  customerProjectIds: [],
  roleVersion: "test",
  grantVersion: "test"
};

function hierarchyPrisma(options: {
  version?: number;
  milestoneIds?: string[];
  updatedVersion?: number;
} = {}) {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{
      id: "project-a",
      hierarchyOrderVersion: options.version ?? 3
    }]),
    projectMilestone: {
      findMany: vi.fn().mockResolvedValue((options.milestoneIds ?? ["milestone-a", "milestone-b"]).map((id) => ({ id }))),
      update: vi.fn().mockResolvedValue({})
    },
    projectStage: {
      findMany: vi.fn(),
      update: vi.fn()
    },
    projectTask: {
      findMany: vi.fn(),
      update: vi.fn()
    },
    project: {
      update: vi.fn().mockResolvedValue({
        hierarchyOrderVersion: options.updatedVersion ?? 4
      })
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({})
    }
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction))
  };
  return { prisma, transaction };
}

describe("ProjectsService.reorderProjectHierarchy", () => {
  it("persists one complete reorder, increments once, and audits once", async () => {
    const { prisma, transaction } = hierarchyPrisma();
    const service = new ProjectsService(prisma as never);

    await expect(service.reorderProjectHierarchy("project-a", {
      kind: "milestone",
      parentId: null,
      orderedIds: ["milestone-b", "milestone-a"],
      expectedVersion: 3
    }, editor)).resolves.toEqual({
      kind: "milestone",
      parentId: null,
      orderedIds: ["milestone-b", "milestone-a"],
      hierarchyOrderVersion: 4
    });

    expect(transaction.projectMilestone.update).toHaveBeenCalledTimes(2);
    expect(transaction.project.update).toHaveBeenCalledTimes(1);
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it("does not write, audit, or increment for a no-op", async () => {
    const { prisma, transaction } = hierarchyPrisma();
    const service = new ProjectsService(prisma as never);

    await service.reorderProjectHierarchy("project-a", {
      kind: "milestone",
      parentId: null,
      orderedIds: ["milestone-a", "milestone-b"],
      expectedVersion: 3
    }, editor);

    expect(transaction.projectMilestone.update).not.toHaveBeenCalled();
    expect(transaction.project.update).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it("returns canonical state in a stale-version conflict without writes", async () => {
    const { prisma, transaction } = hierarchyPrisma({ version: 4 });
    const service = new ProjectsService(prisma as never);

    await expect(service.reorderProjectHierarchy("project-a", {
      kind: "milestone",
      parentId: null,
      orderedIds: ["milestone-b", "milestone-a"],
      expectedVersion: 3
    }, editor)).rejects.toBeInstanceOf(ConflictException);

    expect(transaction.projectMilestone.update).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it("locks the project before reading canonical recovery state after a serialization conflict", async () => {
    const { prisma, transaction } = hierarchyPrisma({
      version: 4,
      milestoneIds: ["milestone-b", "milestone-a"]
    });
    prisma.$transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementationOnce(async (callback: (tx: typeof transaction) => unknown) => callback(transaction));
    const service = new ProjectsService(prisma as never);

    const error = await service.reorderProjectHierarchy("project-a", {
      kind: "milestone",
      parentId: null,
      orderedIds: ["milestone-b", "milestone-a"],
      expectedVersion: 3
    }, editor).catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
    expect(transaction.projectMilestone.findMany).toHaveBeenCalledTimes(1);
    expect(transaction.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(transaction.projectMilestone.findMany.mock.invocationCallOrder[0]);
    expect((error as ConflictException).getResponse()).toMatchObject({
      current: {
        orderedIds: ["milestone-b", "milestone-a"],
        hierarchyOrderVersion: 4
      },
      canonical: {
        orderedIds: ["milestone-b", "milestone-a"],
        hierarchyOrderVersion: 4
      }
    });
  });

  it.each([
    {
      ...editor,
      subjectType: "portal_user" as const,
      roleCodes: []
    },
    {
      ...editor,
      roleCodes: ["SALES_OWNER"]
    }
  ])("fails closed for portal/read-only principals", async (principal) => {
    const { prisma } = hierarchyPrisma();
    const service = new ProjectsService(prisma as never);

    await expect(service.reorderProjectHierarchy("project-a", {
      kind: "milestone",
      parentId: null,
      orderedIds: [],
      expectedVersion: 0
    }, principal)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
