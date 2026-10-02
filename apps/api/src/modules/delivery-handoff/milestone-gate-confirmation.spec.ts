import { describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { ProjectsService } from "./projects.service";

const principal: PrincipalContext = {
  subjectType: "internal_user",
  subjectId: "usr-delivery-lead",
  displayName: "Delivery Lead",
  email: "delivery@example.com",
  tenantKey: "prod",
  workspaceId: "workspace-1",
  workspaceKey: "default",
  roleCodes: ["DELIVERY_LEAD"],
  accountIds: [],
  projectIds: [],
  customerAccountIds: [],
  customerProjectIds: [],
  roleVersion: "test",
  grantVersion: "test"
};

function createPrisma(milestone: Record<string, unknown>) {
  const prisma: Record<string, any> = {
    project: { findFirst: vi.fn().mockResolvedValue({ id: "project-1", workspaceId: "workspace-1" }) },
    projectMilestone: {
      findFirst: vi.fn().mockResolvedValue(milestone),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ ...milestone, ...data }))
    },
    projectDocumentVersion: { count: vi.fn().mockResolvedValue(0) },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) }
  };
  prisma.$transaction = vi.fn(async (operation: any) => typeof operation === "function" ? operation(prisma) : Promise.all(operation));
  return prisma;
}

describe("ProjectsService milestone customer confirmation", () => {
  it("persists the customer confirmation tick with the acting user", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "open", requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: true, customerConfirmationAt: null, customerConfirmationByUserId: null };
    const prisma = createPrisma(milestone);
    const service = new ProjectsService(prisma as any);

    await service.updateProjectMilestoneGate("project-1", "milestone-1", { customerConfirmationConfirmed: true }, principal);

    expect(prisma.projectMilestone.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "milestone-1" },
      data: expect.objectContaining({ customerConfirmationByUserId: principal.subjectId, customerConfirmationAt: expect.any(Date) })
    }));
  });

  it("keeps a confirmation-gated milestone locked until the tick is recorded", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "open", requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: true, customerConfirmationAt: null };
    const pendingPrisma = createPrisma(milestone);
    const pending = await new ProjectsService(pendingPrisma as any).evaluateProjectMilestoneGate("project-1", "milestone-1", principal);
    expect(pending.gateStatus).toBe("open");
    expect(pending.confirmationSatisfied).toBe(false);

    const confirmedPrisma = createPrisma({ ...milestone, customerConfirmationAt: new Date("2026-10-02T08:00:00.000Z") });
    const confirmed = await new ProjectsService(confirmedPrisma as any).evaluateProjectMilestoneGate("project-1", "milestone-1", principal);
    expect(confirmed.gateStatus).toBe("approved");
    expect(confirmed.confirmationSatisfied).toBe(true);
  });
});
