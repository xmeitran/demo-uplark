import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { NotificationsService } from "./notifications.service";

const principal: PrincipalContext = {
  subjectType: "internal_user",
  subjectId: "usr-requester",
  displayName: "Delivery User",
  email: "delivery@example.com",
  tenantKey: "tenant",
  workspaceId: "ws-1",
  workspaceKey: "workspace",
  roleCodes: ["DELIVERY_LEAD"],
  accountIds: [],
  projectIds: [],
  customerAccountIds: [],
  customerProjectIds: [],
  roleVersion: "1",
  grantVersion: "1"
};

function milestone(overrides: Record<string, unknown> = {}) {
  return {
    id: "ms-1",
    projectId: "project-1",
    workspaceId: "ws-1",
    name: "Kick-off",
    sortOrder: 10,
    gateStatus: "open",
    reviewerMode: "workspace_admin",
    reviewerUserId: null,
    approvalRequestedAt: null,
    approvalRequestedByUserId: null,
    approvalRequestedByName: null,
    updatedAt: new Date("2026-10-04T08:00:00.000Z"),
    project: { id: "project-1", code: "PRJ-001", name: "CRM rollout" },
    ...overrides
  };
}

function fakePrisma(row = milestone()) {
  return {
    projectMilestone: {
      findFirst: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: row.approvalRequestedAt ? 0 : 1 }),
      findMany: vi.fn()
    },
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: "usr-admin", displayName: "Workspace Admin" }])
    },
    appNotification: {
      upsert: vi.fn().mockResolvedValue({})
    }
  };
}

describe("NotificationsService milestone approval requests", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("creates a deduped in-app notification and sends a Lark card with the project link", async () => {
    vi.stubEnv("LARK_TASK_REMINDER_WEBHOOK_URL", "https://lark.example/webhook");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const prisma = fakePrisma();
    const service = new NotificationsService(prisma as never);

    const result = await service.createMilestoneApprovalRequest({ projectId: "project-1", milestoneId: "ms-1", principal });

    expect(result).toMatchObject({ gateStatus: "pending_review", reviewerLabel: "Admin workspace", notificationCount: 1, larkDelivery: "sent" });
    expect(prisma.appNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { dedupeKey: "milestone-approval:ms-1:usr-admin" },
      create: expect.objectContaining({ href: "/projects/project-1?tab=Overview" })
    }));
    expect(fetcher).toHaveBeenCalledWith("https://lark.example/webhook", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(expect.objectContaining({ msg_type: "interactive" }));
  });

  it("does not send another Lark message when the same request is already pending", async () => {
    vi.stubEnv("LARK_TASK_REMINDER_WEBHOOK_URL", "https://lark.example/webhook");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const prisma = fakePrisma(milestone({ gateStatus: "pending_review", approvalRequestedAt: new Date("2026-10-04T08:00:00.000Z") }));
    const service = new NotificationsService(prisma as never);

    const result = await service.createMilestoneApprovalRequest({ projectId: "project-1", milestoneId: "ms-1", principal });

    expect(result.larkDelivery).toBe("skipped");
    expect(fetcher).not.toHaveBeenCalled();
    expect(prisma.appNotification.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationsService project risk notifications", () => {
  it("creates an issue notification with a deep link to the assigned issue", async () => {
    const prisma = fakePrisma();
    const service = new NotificationsService(prisma as never);

    await service.notifyProjectRiskOwner({
      workspaceId: "ws-1",
      recipientUserId: "usr-owner",
      projectId: "project-1",
      projectCode: "PRJ-001",
      projectName: "CRM rollout",
      riskId: "risk-1",
      riskCategory: "Issue",
      riskDescription: "Customer data is missing",
      event: "created"
    });

    expect(prisma.appNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { dedupeKey: "project-risk-owner:risk-1:usr-owner:created" },
      create: expect.objectContaining({
        kind: "project_risk_owner",
        entityType: "project_risk",
        entityId: "risk-1",
        href: "/projects/project-1?tab=Issues&issueId=risk-1",
        data: expect.objectContaining({ riskId: "risk-1", event: "created" })
      })
    }));
  });
});
