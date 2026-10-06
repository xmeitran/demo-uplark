import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AdminApprovalsResponse,
  AppNotificationsResponse,
  PrincipalContext,
  ProjectMilestoneReviewerMode
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { canApproveMilestoneReviewer, isWorkspaceAdmin, normalizeMilestoneReviewerMode } from "../delivery-handoff/milestone-reviewer";

const APPROVER_ROLES = ["FOUNDER_GM", "WORKSPACE_ADMIN"];

function appPublicOrigin() {
  return (process.env.PUBLIC_APP_URL ?? process.env.CRM_AUTH_PUBLIC_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
}

function assertInternal(principal: PrincipalContext) {
  if (principal.subjectType !== "internal_user") throw new ForbiddenException("Internal workspace user is required");
}

function assertAdmin(principal: PrincipalContext) {
  assertInternal(principal);
  if (!isWorkspaceAdmin(principal.roleCodes)) throw new ForbiddenException("Founder/GM or Workspace Admin role is required");
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function mapNotification(row: {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  entityType: string;
  entityId: string;
  status: string;
  createdAt: Date;
  readAt: Date | null;
  data: Prisma.JsonValue | null;
}) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    entityType: row.entityType,
    entityId: row.entityId,
    status: row.status === "resolved" ? "resolved" : row.readAt ? "read" : "pending",
    createdAt: row.createdAt.toISOString(),
    ...(row.readAt ? { readAt: row.readAt.toISOString() } : {}),
    ...(jsonObject(row.data) ? { data: jsonObject(row.data) } : {})
  } as const;
}

async function postLarkApprovalCard(input: {
  projectName: string;
  milestoneName: string;
  reviewerLabel: string;
  href: string;
}) {
  const webhook = process.env.LARK_TASK_REMINDER_WEBHOOK_URL?.trim();
  if (!webhook) return "skipped" as const;

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      msg_type: "interactive",
      card: {
        schema: "2.0",
        header: {
          template: "orange",
          title: { tag: "plain_text", content: "Có hồ sơ milestone cần duyệt" }
        },
        body: {
          elements: [
            { tag: "markdown", content: `**${input.projectName}**\nMilestone: **${input.milestoneName}**\nNgười duyệt: ${input.reviewerLabel}` },
            { tag: "action", actions: [{ tag: "button", text: { tag: "plain_text", content: "Mở project & duyệt" }, type: "primary", url: input.href }] }
          ]
        }
      }
    })
  });
  const body = await response.json().catch(() => ({})) as { code?: number; msg?: string };
  if (!response.ok || (body.code !== undefined && body.code !== 0)) {
    throw new Error(body.msg ?? `Lark webhook returned HTTP ${response.status}`);
  }
  return "sent" as const;
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async notifyProjectRiskOwner(input: {
    workspaceId: string;
    recipientUserId: string;
    projectId: string;
    projectCode?: string | null;
    projectName: string;
    riskId: string;
    riskCategory: string;
    riskDescription: string;
    event: "created" | "reassigned";
  }) {
    const dedupeKey = `project-risk-owner:${input.riskId}:${input.recipientUserId}:${input.event}`;
    const href = `/projects/${encodeURIComponent(input.projectId)}?tab=Issues&issueId=${encodeURIComponent(input.riskId)}`;
    const title = input.event === "created" ? "Bạn được giao một vấn đề" : "Bạn được gán lại một vấn đề";
    const body = `${input.projectName} · ${input.riskCategory}: ${input.riskDescription}`;
    const data = {
      projectId: input.projectId,
      projectCode: input.projectCode ?? undefined,
      projectName: input.projectName,
      riskId: input.riskId,
      riskCategory: input.riskCategory,
      riskDescription: input.riskDescription,
      event: input.event
    };

    return this.prisma.appNotification.upsert({
      where: { dedupeKey },
      create: {
        workspaceId: input.workspaceId,
        recipientUserId: input.recipientUserId,
        kind: "project_risk_owner",
        title,
        body,
        href,
        entityType: "project_risk",
        entityId: input.riskId,
        status: "pending",
        dedupeKey,
        data
      },
      update: {
        title,
        body,
        href,
        status: "pending",
        readAt: null,
        actedAt: null,
        data
      }
    });
  }

  async resolveProjectRiskNotifications(workspaceId: string, riskId: string) {
    await this.prisma.appNotification.updateMany({
      where: { workspaceId, entityType: "project_risk", entityId: riskId, status: "pending" },
      data: { status: "resolved", actedAt: new Date(), readAt: new Date() }
    });
  }

  async list(principal: PrincipalContext): Promise<AppNotificationsResponse> {
    assertInternal(principal);
    const [rows, unreadCount] = await Promise.all([
      this.prisma.appNotification.findMany({
        where: { workspaceId: principal.workspaceId, recipientUserId: principal.subjectId },
        orderBy: { createdAt: "desc" },
        take: 30
      }),
      this.prisma.appNotification.count({
        where: { workspaceId: principal.workspaceId, recipientUserId: principal.subjectId, readAt: null, status: "pending" }
      })
    ]);
    return { data: rows.map(mapNotification), meta: { unreadCount } };
  }

  async markRead(id: string, principal: PrincipalContext) {
    assertInternal(principal);
    const updated = await this.prisma.appNotification.updateMany({
      where: { id, workspaceId: principal.workspaceId, recipientUserId: principal.subjectId },
      data: { readAt: new Date() }
    });
    if (!updated.count) throw new NotFoundException("Notification not found");
    return { data: { id, readAt: new Date().toISOString() } };
  }

  async listApprovalQueue(principal: PrincipalContext): Promise<AdminApprovalsResponse> {
    assertAdmin(principal);
    const rows = await this.prisma.projectMilestone.findMany({
      where: { workspaceId: principal.workspaceId, gateStatus: "pending_review" },
      include: { project: { select: { id: true, code: true, name: true } } },
      orderBy: [{ approvalRequestedAt: "asc" }, { updatedAt: "asc" }]
    });
    const reviewerIds = rows.map((row) => row.reviewerUserId).filter((value): value is string => Boolean(value));
    const reviewerUsers = reviewerIds.length
      ? await this.prisma.user.findMany({
          where: {
            id: { in: reviewerIds },
            status: "ACTIVE",
            roleBindings: {
              some: {
                workspaceId: principal.workspaceId,
                tenantKey: principal.tenantKey,
                ...activeMembershipWhere()
              }
            }
          },
          select: { id: true, displayName: true }
        })
      : [];
    const reviewerNames = new Map(reviewerUsers.map((user) => [user.id, user.displayName]));
    const data = rows.map((row) => {
      const reviewerMode = normalizeMilestoneReviewerMode(row.reviewerMode) as ProjectMilestoneReviewerMode;
      return {
        id: row.id,
        project: {
          id: row.project.id,
          code: row.project.code,
          name: row.project.name,
          href: `/projects/${encodeURIComponent(row.project.id)}?tab=Overview`
        },
        milestone: { id: row.id, name: row.name, sortOrder: row.sortOrder },
        requesterLabel: row.approvalRequestedByName ?? "Delivery team",
        reviewerLabel: reviewerMode === "specific_user" ? (row.reviewerUserId ? reviewerNames.get(row.reviewerUserId) ?? row.reviewerUserId : "PIC đã chọn") : "Admin workspace",
        reviewerMode,
        pendingSince: (row.approvalRequestedAt ?? row.updatedAt).toISOString(),
        canApprove: canApproveMilestoneReviewer({
          reviewerMode,
          reviewerUserId: row.reviewerUserId,
          principalUserId: principal.subjectId,
          principalRoleCodes: principal.roleCodes
        })
      };
    });
    return {
      data,
      meta: { total: data.length, pendingForMe: data.filter((row) => row.canApprove).length }
    };
  }

  async createMilestoneApprovalRequest(input: {
    projectId: string;
    milestoneId: string;
    principal: PrincipalContext;
  }) {
    assertInternal(input.principal);
    const milestone = await this.prisma.projectMilestone.findFirst({
      where: { id: input.milestoneId, projectId: input.projectId, workspaceId: input.principal.workspaceId },
      include: { project: { select: { id: true, name: true, code: true } } }
    });
    if (!milestone) throw new NotFoundException("Project milestone not found");

    const reviewerMode = normalizeMilestoneReviewerMode(milestone.reviewerMode) as ProjectMilestoneReviewerMode;
    const reviewerWhere = reviewerMode === "specific_user"
      ? {
          id: milestone.reviewerUserId ?? "",
          roleBindings: {
            some: {
              workspaceId: input.principal.workspaceId,
              tenantKey: input.principal.tenantKey,
              ...activeMembershipWhere()
            }
          }
        }
      : {
          roleBindings: {
            some: {
              workspaceId: input.principal.workspaceId,
              tenantKey: input.principal.tenantKey,
              ...activeMembershipWhere(),
              role: { code: { in: APPROVER_ROLES } }
            }
          }
        };
    const recipients = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        subjectType: "INTERNAL_USER",
        ...reviewerWhere
      },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" }
    });
    if (!recipients.length) throw new ForbiddenException("Không tìm thấy người duyệt đang hoạt động trong workspace");
    if (["locked", "approved"].includes(milestone.gateStatus)) throw new ForbiddenException("Milestone hiện không nhận yêu cầu duyệt");

    const requestedAt = new Date();
    // Keep in-app links relative so they always stay on the current host
    // (localhost:3000, Render, or a future custom domain). Lark needs an
    // absolute URL, so the public origin is added only to the card payload.
    const href = `/projects/${encodeURIComponent(milestone.project.id)}?tab=Overview`;
    const larkHref = `${appPublicOrigin()}${href}`;
    const reviewerLabel = reviewerMode === "specific_user" ? recipients[0].displayName : "Admin workspace";
    const requestClaim = milestone.approvalRequestedAt
      ? { count: 0 }
      : await this.prisma.projectMilestone.updateMany({
          where: { id: milestone.id, gateStatus: "pending_review", approvalRequestedAt: null },
          data: {
            approvalRequestedAt: requestedAt,
            approvalRequestedByUserId: input.principal.subjectId,
            approvalRequestedByName: input.principal.displayName
          }
        });

    let createdOrUpdated = 0;
    for (const recipient of recipients) {
      await this.prisma.appNotification.upsert({
        where: { dedupeKey: `milestone-approval:${milestone.id}:${recipient.id}` },
        create: {
          workspaceId: input.principal.workspaceId,
          recipientUserId: recipient.id,
          kind: "milestone_approval",
          title: "Hồ sơ milestone cần duyệt",
          body: `${milestone.project.name} · ${milestone.name}`,
          href,
          entityType: "project_milestone",
          entityId: milestone.id,
          status: "pending",
          dedupeKey: `milestone-approval:${milestone.id}:${recipient.id}`,
          data: { projectId: milestone.project.id, projectCode: milestone.project.code, projectName: milestone.project.name, milestoneId: milestone.id, milestoneName: milestone.name, reviewerName: reviewerLabel }
        },
        update: {
          title: "Hồ sơ milestone cần duyệt",
          body: `${milestone.project.name} · ${milestone.name}`,
          href,
          status: "pending",
          readAt: null,
          actedAt: null,
          data: { projectId: milestone.project.id, projectCode: milestone.project.code, projectName: milestone.project.name, milestoneId: milestone.id, milestoneName: milestone.name, reviewerName: reviewerLabel }
        }
      });
      createdOrUpdated += 1;
    }

    let larkDelivery: "sent" | "skipped" | "failed" = "skipped";
    if (requestClaim.count > 0) {
      try {
        larkDelivery = await postLarkApprovalCard({ projectName: milestone.project.name, milestoneName: milestone.name, reviewerLabel, href: larkHref });
      } catch {
        larkDelivery = "failed";
      }
    }
    return { gateStatus: "pending_review", reviewerMode, reviewerLabel, notificationCount: createdOrUpdated, larkDelivery, href };
  }

  async resolveMilestoneNotifications(milestoneId: string, principal: PrincipalContext) {
    assertInternal(principal);
    await this.prisma.appNotification.updateMany({
      where: { workspaceId: principal.workspaceId, entityType: "project_milestone", entityId: milestoneId, status: "pending" },
      data: { status: "resolved", actedAt: new Date(), readAt: new Date() }
    });
  }
}
