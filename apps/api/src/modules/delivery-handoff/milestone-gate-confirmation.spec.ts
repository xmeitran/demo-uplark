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

const adminPrincipal: PrincipalContext = {
  ...principal,
  subjectId: "usr-admin",
  displayName: "Workspace Admin",
  roleCodes: ["WORKSPACE_ADMIN"]
};

function createPrisma(milestone: Record<string, unknown>, taskStatuses: string[] = []) {
  const prisma: Record<string, any> = {
    project: { findFirst: vi.fn().mockResolvedValue({ id: "project-1", workspaceId: "workspace-1" }) },
    projectMilestone: {
      findFirst: vi.fn().mockResolvedValue(milestone),
      update: vi.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(milestone, data);
        return { ...milestone };
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
        if (where.gateStatus && where.gateStatus !== milestone.gateStatus) return { count: 0 };
        Object.assign(milestone, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ ...milestone }))
    },
    projectTask: { findMany: vi.fn().mockResolvedValue(taskStatuses.map((status) => ({ status }))) },
    projectArtifact: { findMany: vi.fn().mockResolvedValue([]) },
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
    // Ready, but "Chờ duyệt" only starts when someone sends the dossier.
    expect(confirmed.gateStatus).toBe("open");
    expect(confirmed.satisfied).toBe(true);
    expect(confirmed.confirmationSatisfied).toBe(true);
  });

  it("uses milestone tasks as a gate and accepts legacy done status", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "open", requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null };
    const pending = await new ProjectsService(createPrisma(milestone, ["done", "todo"]) as any).evaluateProjectMilestoneGate("project-1", "milestone-1", principal);
    expect(pending.gateStatus).toBe("open");
    expect(pending.tasksSatisfied).toBe(false);
    expect(pending.missingRequirements).toEqual(["Còn 1 task chưa hoàn tất."]);

    const approved = await new ProjectsService(createPrisma(milestone, ["done", "completed"]) as any).evaluateProjectMilestoneGate("project-1", "milestone-1", principal);
    expect(approved.gateStatus).toBe("open");
    expect(approved.satisfied).toBe(true);
    expect(approved.tasksSatisfied).toBe(true);
  });

  it("counts only active top-level tasks from ordinary stages", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "open", requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null };
    const prisma = createPrisma(milestone, ["done"]);

    const result = await new ProjectsService(prisma as any).evaluateProjectMilestoneGate("project-1", "milestone-1", principal);

    expect(result.tasksSatisfied).toBe(true);
    expect(prisma.projectTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        parentTaskId: null,
        stage: { milestoneId: "milestone-1", changeRequestId: null }
      })
    }));
  });

  it("reopens an approved milestone when a new active task makes it incomplete", async () => {
    const milestone = {
      id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1,
      gateStatus: "approved", requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link",
      customerConfirmationRequired: false, customerConfirmationAt: null,
      reviewerApprovedAt: new Date("2026-10-03T08:00:00.000Z"), reviewerApprovedByUserId: "usr-admin",
      approvalRequestedAt: new Date("2026-10-03T07:00:00.000Z"), approvalRequestedByUserId: "usr-lead", approvalRequestedByName: "Lead"
    };
    const prisma = createPrisma(milestone, ["completed", "todo"]);
    prisma.projectMilestone.update.mockImplementation(async ({ data }: any) => ({ ...milestone, ...data }));

    const result = await new ProjectsService(prisma as any).evaluateProjectMilestoneGate("project-1", "milestone-1", principal);

    expect(result.gateStatus).toBe("open");
    expect(result.tasksSatisfied).toBe(false);
    expect(result.reviewerApprovedAt).toBeNull();
    expect(result.reviewerApprovedByUserId).toBeUndefined();
    expect(prisma.projectMilestone.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        gateStatus: "open",
        reviewerApprovedAt: null,
        reviewerApprovedByUserId: null,
        approvalRequestedAt: null
      })
    }));
  });

  it("makes a document-gated milestone ready once all visible requirements pass", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "open", requiredDocumentCount: 1, requiredDocumentTypes: ["BRD"], evidenceMode: "file_or_link", customerConfirmationRequired: true, customerConfirmationAt: new Date("2026-10-02T08:00:00.000Z") };
    const prisma = createPrisma(milestone, ["done"]);
    prisma.projectArtifact.findMany.mockResolvedValue([
      { artifactType: "BRD", versions: [{ fileObject: { storageProvider: "local", status: "active", scanStatus: "clean", deletedAt: null, revokedAt: null } }] }
    ]);

    const result = await new ProjectsService(prisma as any).evaluateProjectMilestoneGate("project-1", "milestone-1", principal);

    expect(result.gateStatus).toBe("open");
    expect(result.satisfied).toBe(true);
    expect(result.documentsSatisfied).toBe(true);
    expect(result.confirmationSatisfied).toBe(true);
    expect(result.missingRequirements).toEqual([]);
  });

  it("counts a usable artifact regardless of its document type", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "open", requiredDocumentCount: 1, requiredDocumentTypes: ["BRD"], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null };
    const prisma = createPrisma(milestone);
    prisma.projectArtifact.findMany.mockResolvedValue([
      { artifactType: "FRD", versions: [{ fileObject: { storageProvider: "local", status: "active", scanStatus: "clean", deletedAt: null, revokedAt: null } }] }
    ]);

    const result = await new ProjectsService(prisma as any).evaluateProjectMilestoneGate("project-1", "milestone-1", principal);

    expect(result.satisfied).toBe(true);
    expect(result.documentsSatisfied).toBe(true);
    expect(result.missingRequirements).toEqual([]);
  });

  it("puts back to open a milestone left in review without a sent dossier (older data)", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "pending_review", approvalRequestedAt: null, requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null };
    const result = await new ProjectsService(createPrisma(milestone, ["done"]) as any).evaluateProjectMilestoneGate("project-1", "milestone-1", principal);
    expect(result.gateStatus).toBe("open");
  });

  it("opens the next milestone only after an authorized workspace admin approves", async () => {
    // Sent by the delivery lead (requestProjectMilestoneApproval), reviewed by an admin.
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "pending_review", approvalRequestedAt: new Date("2026-10-03T07:00:00.000Z"), approvalRequestedByUserId: principal.subjectId, requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null, reviewerMode: "workspace_admin", reviewerUserId: null, reviewerApprovedAt: null, reviewerApprovedByUserId: null };
    const nextMilestone = { id: "milestone-2", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 2, gateStatus: "locked" };
    const prisma = createPrisma(milestone, ["done"]);
    prisma.projectMilestone.findFirst.mockImplementation(({ where }: any) => where.sortOrder ? Promise.resolve(nextMilestone) : Promise.resolve(milestone));
    const service = new ProjectsService(prisma as any);

    const approved = await service.approveProjectMilestone("project-1", "milestone-1", adminPrincipal);

    expect(approved.gateStatus).toBe("approved");
    expect(approved.reviewerApprovedByUserId).toBe(adminPrincipal.subjectId);
    expect(prisma.projectMilestone.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "milestone-2" }, data: { gateStatus: "open" } }));
  });

  it("refuses an approval nobody sent, but lets the sender approve their own dossier (chốt 23/10)", async () => {
    const base = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null, reviewerMode: "workspace_admin", reviewerUserId: null };
    const unsent = createPrisma({ ...base, gateStatus: "pending_review", approvalRequestedAt: null }, ["done"]);
    await expect(new ProjectsService(unsent as any).approveProjectMilestone("project-1", "milestone-1", adminPrincipal)).rejects.toMatchObject({ status: 400 });
    const own = createPrisma({ ...base, gateStatus: "pending_review", approvalRequestedAt: new Date(), approvalRequestedByUserId: adminPrincipal.subjectId }, ["done"]);
    const approved = await new ProjectsService(own as any).approveProjectMilestone("project-1", "milestone-1", adminPrincipal);
    expect(approved.gateStatus).toBe("approved");
    expect(approved.reviewerApprovedByUserId).toBe(adminPrincipal.subjectId);
  });

  it("rejects approval by a non-selected PIC", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "pending_review", approvalRequestedAt: new Date("2026-10-03T07:00:00.000Z"), approvalRequestedByUserId: "usr-lead", requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null, reviewerMode: "specific_user", reviewerUserId: "usr-pic", reviewerApprovedAt: null, reviewerApprovedByUserId: null };
    const prisma = createPrisma(milestone, ["done"]);
    const service = new ProjectsService(prisma as any);

    await expect(service.approveProjectMilestone("project-1", "milestone-1", adminPrincipal)).rejects.toMatchObject({ status: 403 });
  });

  it("allows the selected PIC to approve a specific-user gate", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "pending_review", approvalRequestedAt: new Date("2026-10-03T07:00:00.000Z"), approvalRequestedByUserId: "usr-lead", requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null, reviewerMode: "specific_user", reviewerUserId: "usr-pic", reviewerApprovedAt: null, reviewerApprovedByUserId: null };
    const prisma = createPrisma(milestone, ["done"]);
    const service = new ProjectsService(prisma as any);
    const picPrincipal = { ...principal, subjectId: "usr-pic", displayName: "PIC" };

    const approved = await service.approveProjectMilestone("project-1", "milestone-1", picPrincipal);

    expect(approved.gateStatus).toBe("approved");
    expect(approved.reviewerApprovedByUserId).toBe("usr-pic");
  });

  it("does not let evaluation promote a locked milestone", async () => {
    const milestone = { id: "milestone-2", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 2, gateStatus: "locked", requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null };
    const prisma = createPrisma(milestone, ["done"]);
    const service = new ProjectsService(prisma as any);

    await expect(service.evaluateProjectMilestoneGate("project-1", "milestone-2", adminPrincipal)).rejects.toMatchObject({ status: 400 });
    expect(prisma.projectMilestone.update).not.toHaveBeenCalled();
  });

  it("does not allow a PATCH to impersonate reviewer approval", async () => {
    const milestone = { id: "milestone-1", projectId: "project-1", workspaceId: "workspace-1", sortOrder: 1, gateStatus: "pending_review", requiredDocumentCount: 0, requiredDocumentTypes: [], evidenceMode: "file_or_link", customerConfirmationRequired: false, customerConfirmationAt: null, reviewerMode: "workspace_admin", reviewerUserId: null };
    const prisma = createPrisma(milestone);
    const service = new ProjectsService(prisma as any);

    await expect(service.updateProjectMilestoneGate("project-1", "milestone-1", { gateStatus: "approved" }, adminPrincipal)).rejects.toMatchObject({ status: 400 });
    expect(prisma.projectMilestone.update).not.toHaveBeenCalled();
  });
});
