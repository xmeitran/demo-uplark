import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { activeMembershipWhere } from "../identity-access/active-membership";
import { Prisma, SubjectStatus } from "@prisma/client";
import type {
  ProjectMilestoneReviewerMode,
  PrincipalContext
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  optionalInteger,
  optionalString
} from "../../shared/http/request-context";
import { evaluateMilestoneGate } from "./milestone-gate";
import { deriveTaskStatus } from "./task-status";
import {
  countMilestoneEvidence,
  effectiveMilestoneRequiredDocumentCount,
  submittedMilestoneEvidenceCount,
  type MilestoneEvidenceDocument
} from "./milestone-evidence";
import {
  canApproveMilestoneReviewer,
  MILESTONE_REVIEWER_MODES,
  normalizeMilestoneReviewerMode
} from "./milestone-reviewer";
import { projectUsesStageGates } from "./gates.service";
import { PROJECT_HIERARCHY_EDIT_ROLE_CODES, normalizeMilestoneEvidenceMode, MilestoneReviewerUser, mapMilestoneGateSummary } from "./projects.shared";
import { ProjectPermissionsService } from "./project-permissions.service";


/** The legacy per-milestone gate: configure, evaluate, request approval, approve (split out of ProjectsService). */
@Injectable()
export class MilestoneGatesService {
  private readonly logger = new Logger(MilestoneGatesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectPermissionsService) private readonly permissions: ProjectPermissionsService,
    @Optional() @Inject(NotificationsService) private readonly notifications?: NotificationsService
  ) {}

  async loadMilestoneReviewerUsers(milestones: readonly any[], principal: PrincipalContext) {
    const ids = Array.from(new Set(milestones.flatMap((milestone) => [milestone.reviewerUserId, milestone.reviewerApprovedByUserId]).filter((id): id is string => typeof id === "string" && Boolean(id))));
    const userModel = (this.prisma as any).user;
    if (ids.length === 0 || typeof userModel?.findMany !== "function") return new Map<string, MilestoneReviewerUser>();
    const users = await userModel.findMany({
      where: {
        id: { in: ids },
        status: SubjectStatus.ACTIVE,
        roleBindings: {
          some: {
            workspaceId: principal.workspaceId,
            tenantKey: principal.tenantKey,
            ...activeMembershipWhere()
          }
        }
      },
      select: { id: true, displayName: true, email: true }
    });
    return new Map<string, MilestoneReviewerUser>(users.map((user: MilestoneReviewerUser) => [user.id, user]));
  }

  async loadProjectMilestoneEvidence(projectId: string, milestoneId: string, workspaceId: string): Promise<MilestoneEvidenceDocument[]> {
    const artifacts = await this.prisma.projectArtifact.findMany({
      where: { projectId, workspaceId, milestoneId },
      select: {
        artifactType: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            fileObject: {
              select: {
                storageProvider: true,
                status: true,
                scanStatus: true,
                deletedAt: true,
                revokedAt: true
              }
            }
          }
        }
      }
    });

    return artifacts.map((artifact: any) => {
      const fileObject = artifact.versions[0]?.fileObject;
      const latestVersionIsUsable = fileObject
        && fileObject.status === "active"
        && fileObject.scanStatus === "clean"
        && fileObject.deletedAt === null
        && fileObject.revokedAt === null;
      return {
        artifactType: artifact.artifactType,
        latestStorageProvider: latestVersionIsUsable ? fileObject.storageProvider : null
      };
    });
  }

  async listProjectMilestoneGates(projectId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project milestone gates are internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const milestones = await this.prisma.projectMilestone.findMany({
      where: { projectId: project.id, workspaceId: principal.workspaceId },
      include: {
        ownerTeam: { select: { id: true, name: true } },
        stages: {
          // Change-request stages are tracked separately and must not hold back
          // the ordinary milestone handoff.
          where: { changeRequestId: null },
          select: {
            tasks: {
              // A subtask is execution detail under its parent Task. It is not
              // a second milestone deliverable and is therefore not counted by
              // the handoff gate.
              where: { workspaceId: principal.workspaceId, archivedAt: null, parentTaskId: null },
              select: { status: true }
            }
          }
        }
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
    });
    const reviewerUsers = await this.loadMilestoneReviewerUsers(milestones, principal);
    const documentEvidenceByMilestone = new Map(
      await Promise.all(milestones.map(async (milestone) => [
        milestone.id,
        await this.loadProjectMilestoneEvidence(project.id, milestone.id, principal.workspaceId)
      ] as const))
    );
    return {
      projectId: project.id,
      milestoneMode: project.milestoneMode,
      milestoneTemplateKey: project.milestoneTemplateKey,
      data: milestones.map((milestone) => mapMilestoneGateSummary(
        milestone,
        countMilestoneEvidence(
          milestone,
          documentEvidenceByMilestone.get(milestone.id) ?? []
        ),
        milestone.reviewerUserId ? reviewerUsers.get(milestone.reviewerUserId) : undefined,
        milestone.reviewerApprovedByUserId ? reviewerUsers.get(milestone.reviewerApprovedByUserId) : undefined,
        principal
      ))
    };
  }

  async updateProjectMilestoneGate(projectId: string, milestoneId: string, input: Record<string, unknown>, principal: PrincipalContext) {
    this.assertCanEditMilestoneGate(principal);
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const existing = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: project.id, workspaceId: principal.workspaceId } });
    if (!existing) throw new NotFoundException("Project milestone not found");
    const requiredDocumentTypes = input.requiredDocumentTypes === undefined
      ? existing.requiredDocumentTypes
      : Array.isArray(input.requiredDocumentTypes)
        ? input.requiredDocumentTypes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
        : (() => { throw new BadRequestException("requiredDocumentTypes must be an array"); })();
    const configuredRequiredDocumentCount = input.requiredDocumentCount === undefined
        ? existing.requiredDocumentCount
        : optionalInteger(input.requiredDocumentCount, "requiredDocumentCount") ?? existing.requiredDocumentCount;
    if (configuredRequiredDocumentCount < 0) throw new BadRequestException("requiredDocumentCount must be non-negative");
    const requiredDocumentCount = effectiveMilestoneRequiredDocumentCount({
      requiredDocumentCount: configuredRequiredDocumentCount,
      requiredDocumentTypes
    });
    const evidenceMode = input.evidenceMode === undefined ? existing.evidenceMode : normalizeMilestoneEvidenceMode(input.evidenceMode);
    const ownerTeamId = input.ownerTeamId === undefined
      ? existing.ownerTeamId
      : optionalString(input.ownerTeamId, "ownerTeamId") ?? null;
    if (ownerTeamId) {
      const team = await this.prisma.workspaceTeam.findFirst({ where: { id: ownerTeamId, workspaceId: principal.workspaceId, active: true }, select: { id: true } });
      if (!team) throw new BadRequestException("Team phụ trách không tồn tại trong workspace");
    }
    const unlockCriteria = input.unlockCriteria === undefined ? existing.unlockCriteria : { text: optionalString(input.unlockCriteria, "unlockCriteria") ?? "" };
    const gateStatus = input.gateStatus === undefined ? existing.gateStatus : optionalString(input.gateStatus, "gateStatus");
    if (gateStatus && !["open", "locked", "pending_review", "approved", "rejected", "conditional"].includes(gateStatus)) {
      throw new BadRequestException("Invalid milestone gate status");
    }
    if (gateStatus === "approved") {
      throw new BadRequestException("Milestone approval must be performed by the configured reviewer");
    }
    // V-11: a project on G1–G8 opens its milestones through the stage gates; the only bypass is the Dx Director exception with a reason.
    if (input.gateStatus !== undefined && await projectUsesStageGates(this.prisma, principal.workspaceId, project.id)) {
      throw new BadRequestException("Dự án này dùng điểm chốt G1–G8: milestone chỉ mở khi điểm chốt được duyệt, hoặc Dx Director mở theo ngoại lệ có lý do ở tab Điểm chốt & Tài liệu.");
    }
    const reviewerMode = (input.reviewerMode === undefined
      ? normalizeMilestoneReviewerMode(existing.reviewerMode)
      : input.reviewerMode) as ProjectMilestoneReviewerMode;
    if (!MILESTONE_REVIEWER_MODES.has(reviewerMode as ProjectMilestoneReviewerMode)) {
      throw new BadRequestException("reviewerMode must be workspace_admin or specific_user");
    }
    const reviewerUserId = input.reviewerUserId === undefined
      ? existing.reviewerUserId
      : optionalString(input.reviewerUserId, "reviewerUserId") ?? null;
    if (reviewerMode === "specific_user") {
      if (!reviewerUserId) throw new BadRequestException("reviewerUserId is required when reviewerMode is specific_user");
      await this.permissions.ensureActiveWorkspaceUsers(this.prisma, principal.workspaceId, principal.tenantKey, [reviewerUserId]);
    }
    const confirmationRequested = input.customerConfirmationConfirmed === undefined
      ? undefined
      : Boolean(input.customerConfirmationConfirmed);
    const confirmationRequired = input.customerConfirmationRequired === undefined
      ? existing.customerConfirmationRequired
      : Boolean(input.customerConfirmationRequired);
    const confirmationReset = input.customerConfirmationRequired !== undefined && !confirmationRequired && confirmationRequested === undefined;
    const reviewerConfigurationChanged = reviewerMode !== normalizeMilestoneReviewerMode(existing.reviewerMode) || reviewerUserId !== (existing.reviewerUserId ?? null);
    const gateConfigurationChanged = reviewerConfigurationChanged
      || requiredDocumentCount !== existing.requiredDocumentCount
      || JSON.stringify(requiredDocumentTypes) !== JSON.stringify(existing.requiredDocumentTypes ?? [])
      || evidenceMode !== existing.evidenceMode
      || ownerTeamId !== (existing.ownerTeamId ?? null)
      || JSON.stringify(unlockCriteria) !== JSON.stringify(existing.unlockCriteria)
      || confirmationRequired !== existing.customerConfirmationRequired
      || confirmationRequested !== undefined;
    const nextGateStatus = gateStatus ?? (gateConfigurationChanged && existing.gateStatus !== "locked" ? "open" : existing.gateStatus);
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.projectMilestone.update({
        where: { id: existing.id },
        data: {
          requiredDocumentCount,
          requiredDocumentTypes,
          evidenceMode,
          ownerTeamId,
          unlockCriteria: unlockCriteria === null ? undefined : unlockCriteria as Prisma.InputJsonValue,
          gateStatus: nextGateStatus,
          customerConfirmationRequired: confirmationRequired,
          customerConfirmationAt: confirmationRequested === undefined ? confirmationReset ? null : undefined : confirmationRequested ? new Date() : null,
          customerConfirmationByUserId: confirmationRequested === undefined ? confirmationReset ? null : undefined : confirmationRequested ? principal.subjectId : null,
          reviewerMode,
          reviewerUserId: reviewerMode === "specific_user" ? reviewerUserId : null,
          reviewerApprovedAt: gateConfigurationChanged ? null : undefined,
          reviewerApprovedByUserId: gateConfigurationChanged ? null : undefined,
          // The earlier request was for the old gate/reviewer: clear it so the next request notifies again.
          approvalRequestedAt: gateConfigurationChanged ? null : undefined,
          approvalRequestedByUserId: gateConfigurationChanged ? null : undefined,
          approvalRequestedByName: gateConfigurationChanged ? null : undefined,
          reviewerRole: input.reviewerRole === undefined ? existing.reviewerRole : optionalString(input.reviewerRole, "reviewerRole") ?? null
        }
      });
      if (gateConfigurationChanged && existing.gateStatus === "approved") {
        const next = await tx.projectMilestone.findFirst({
          where: { projectId: project.id, workspaceId: principal.workspaceId, sortOrder: { gt: existing.sortOrder } },
          orderBy: { sortOrder: "asc" }
        });
        if (next && next.gateStatus === "open") {
          await tx.projectMilestone.update({ where: { id: next.id }, data: { gateStatus: "locked" } });
        }
      }
      await this.permissions.auditMutation(tx, principal, "project.milestone_gate_updated", "project_milestone", result.id, JSON.parse(JSON.stringify(existing)), JSON.parse(JSON.stringify(result)));
      return result;
    });
    // Pending notifications still point the previous reviewer at a request that no longer exists.
    if (gateConfigurationChanged) await this.notifications?.resolveMilestoneNotifications(milestoneId, principal);
    return updated;
  }

  async evaluateProjectMilestoneGate(projectId: string, milestoneId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project milestone gates are internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const milestone = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: project.id, workspaceId: principal.workspaceId } });
    if (!milestone) throw new NotFoundException("Project milestone not found");
    if (milestone.gateStatus === "locked") {
      throw new BadRequestException("Milestone is locked until the previous milestone is approved");
    }
    // Projects on G1–G8 submit and approve at the stage gates; the milestone row only mirrors G1/G4/G7/G8.
    if (await projectUsesStageGates(this.prisma, principal.workspaceId, project.id)) {
      throw new BadRequestException("Dự án này dùng điểm chốt G1–G8: nộp và duyệt hồ sơ chuyển tiếp tại từng điểm chốt ở tab Điểm chốt & Tài liệu.");
    }
    const evidenceMode = normalizeMilestoneEvidenceMode(milestone.evidenceMode);
    const documentEvidence = await this.loadProjectMilestoneEvidence(project.id, milestone.id, principal.workspaceId);
    const evidenceCounts = countMilestoneEvidence(milestone, documentEvidence);
    const submittedDocumentCount = submittedMilestoneEvidenceCount(evidenceCounts, evidenceMode);
    const requiredDocumentCount = effectiveMilestoneRequiredDocumentCount(milestone);
    const taskRows = typeof this.prisma.projectTask?.findMany === "function"
      ? await this.prisma.projectTask.findMany({
          where: {
            projectId: project.id,
            workspaceId: principal.workspaceId,
            archivedAt: null,
            parentTaskId: null,
            // Stored stages of the retired change-request flow (changeRequestId set) never hold back the milestone's gate.
            stage: { milestoneId: milestone.id, changeRequestId: null }
          },
          select: {
            status: true,
            plannedStartAt: true,
            dueAt: true,
            estimateMinutes: true,
            timeEntries: {
              select: { minutes: true, approvalStatus: true, workDate: true, startAt: true, endAt: true }
            },
            subtasks: {
              where: { workspaceId: principal.workspaceId, archivedAt: null },
              select: {
                status: true,
                plannedStartAt: true,
                dueAt: true,
                estimateMinutes: true,
                timeEntries: {
                  select: { minutes: true, approvalStatus: true, workDate: true, startAt: true, endAt: true }
                }
              }
            }
          }
        })
      : [];
    const evaluation = evaluateMilestoneGate({
      requiredDocumentCount,
      submittedDocumentCount,
      missingDocumentTypes: evidenceCounts.missingRequiredTypes,
      customerConfirmationRequired: Boolean(milestone.customerConfirmationRequired),
      customerConfirmationAt: milestone.customerConfirmationAt,
      taskStatuses: taskRows.map((task: any) => deriveTaskStatus({
        rawStatus: task.status,
        plannedStartAt: task.plannedStartAt,
        dueAt: task.dueAt,
        estimateMinutes: task.estimateMinutes,
        timeEntries: task.timeEntries,
        subtasks: task.subtasks
      }))
    });
    // Evaluation only proves the visible requirements. It must never impersonate
    // the configured reviewer or unlock the next milestone by itself.
    // Meeting the requirements only makes the milestone ready; "Chờ duyệt" starts when someone sends the dossier
    // (requestProjectMilestoneApproval). A pending_review that was never sent (older data) goes back to open.
    const reopeningApprovedGate = !evaluation.satisfied && ["approved", "pending_review"].includes(milestone.gateStatus);
    const unsentReview = milestone.gateStatus === "pending_review" && !milestone.approvalRequestedAt;
    const nextStatus = reopeningApprovedGate || unsentReview ? "open" : milestone.gateStatus;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.projectMilestone.update({
        where: { id: milestone.id },
        data: {
          gateStatus: nextStatus,
          ...(reopeningApprovedGate ? {
            reviewerApprovedAt: null,
            reviewerApprovedByUserId: null,
            approvalRequestedAt: null,
            approvalRequestedByUserId: null,
            approvalRequestedByName: null
          } : {})
        }
      });
      // A reopened milestone closes the door it had opened, as a reviewer change does (updateProjectMilestoneGate).
      if (reopeningApprovedGate && milestone.gateStatus === "approved") {
        const next = await tx.projectMilestone.findFirst({
          where: { projectId: project.id, workspaceId: principal.workspaceId, sortOrder: { gt: milestone.sortOrder } },
          orderBy: { sortOrder: "asc" }
        });
        if (next && next.gateStatus === "open") await tx.projectMilestone.update({ where: { id: next.id }, data: { gateStatus: "locked" } });
      }
      return result;
    });
    // The old request no longer exists: its "Duyệt" buttons in the bell would only fail.
    if (reopeningApprovedGate) await this.notifications?.resolveMilestoneNotifications(milestoneId, principal);
    return {
      ...updated,
      requiredDocumentCount,
      submittedDocumentCount,
      ...evaluation,
      reviewerMode: normalizeMilestoneReviewerMode(updated.reviewerMode ?? milestone.reviewerMode),
      reviewerUserId: updated.reviewerUserId ?? milestone.reviewerUserId ?? undefined,
      reviewerApprovedAt: updated.reviewerApprovedAt?.toISOString?.() ?? updated.reviewerApprovedAt,
      // A reopened gate explicitly clears the previous approval. Do not fall back
      // to the stale reviewer from the pre-update row in the response.
      reviewerApprovedByUserId: updated.reviewerApprovedByUserId ?? (reopeningApprovedGate ? undefined : milestone.reviewerApprovedByUserId ?? undefined),
      reviewerApprovalRequired: updated.gateStatus !== "approved",
      canApprove: canApproveMilestoneReviewer({
        reviewerMode: normalizeMilestoneReviewerMode(updated.reviewerMode ?? milestone.reviewerMode),
        reviewerUserId: updated.reviewerUserId ?? milestone.reviewerUserId,
        principalUserId: principal.subjectId,
        principalRoleCodes: principal.roleCodes
      })
    };
  }

  async approveProjectMilestone(projectId: string, milestoneId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project milestone approval is internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const milestone = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId: project.id, workspaceId: principal.workspaceId } });
    if (!milestone) throw new NotFoundException("Project milestone not found");
    if (milestone.gateStatus !== "pending_review" || !milestone.approvalRequestedAt) {
      throw new BadRequestException("Hồ sơ milestone chưa được gửi duyệt. Bấm “Gửi hồ sơ chờ duyệt” trước.");
    }

    const reviewerMode = normalizeMilestoneReviewerMode(milestone.reviewerMode);
    if (!canApproveMilestoneReviewer({
      reviewerMode,
      reviewerUserId: milestone.reviewerUserId,
      principalUserId: principal.subjectId,
      principalRoleCodes: principal.roleCodes
    })) {
      throw new ForbiddenException(reviewerMode === "specific_user"
        ? "Only the selected PIC can approve this milestone"
        : "Workspace administrator approval is required");
    }

    const evaluation = await this.evaluateProjectMilestoneGate(projectId, milestoneId, principal);
    if (!evaluation.satisfied) {
      throw new BadRequestException({
        message: "Milestone requirements are not complete",
        missingRequirements: evaluation.missingRequirements
      });
    }

    const approvedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // Two reviewers clicking at once: only the first one approves.
      const claimed = await tx.projectMilestone.updateMany({
        where: { id: milestone.id, gateStatus: "pending_review" },
        data: {
          gateStatus: "approved",
          reviewerApprovedAt: approvedAt,
          reviewerApprovedByUserId: principal.subjectId
        }
      });
      if (!claimed.count) throw new ConflictException("Milestone này vừa được người khác duyệt hoặc đã đổi trạng thái. Tải lại trang.");
      const updated = await tx.projectMilestone.findUniqueOrThrow({ where: { id: milestone.id } });
      const next = await tx.projectMilestone.findFirst({
        where: { projectId: project.id, workspaceId: principal.workspaceId, sortOrder: { gt: milestone.sortOrder } },
        orderBy: { sortOrder: "asc" }
      });
      if (next && next.gateStatus === "locked") {
        await tx.projectMilestone.update({ where: { id: next.id }, data: { gateStatus: "open" } });
      }
      await this.permissions.auditMutation(tx, principal, "project.milestone_approved", "project_milestone", updated.id, JSON.parse(JSON.stringify(milestone)), JSON.parse(JSON.stringify(updated)));
      return updated;
    });

    await this.notifications?.resolveMilestoneNotifications(milestoneId, principal);

    return {
      ...result,
      ...evaluation,
      gateStatus: "approved",
      reviewerMode,
      reviewerUserId: result.reviewerUserId ?? milestone.reviewerUserId ?? undefined,
      reviewerApprovedAt: approvedAt.toISOString(),
      reviewerApprovedByUserId: principal.subjectId,
      reviewerApprovalRequired: false,
      canApprove: true
    };
  }

  async requestProjectMilestoneApproval(projectId: string, milestoneId: string, principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project milestone approval is internal");
    const evaluation = await this.evaluateProjectMilestoneGate(projectId, milestoneId, principal);
    if (!evaluation.satisfied) {
      throw new BadRequestException({
        message: "Milestone requirements are not complete",
        missingRequirements: evaluation.missingRequirements
      });
    }
    if (!this.notifications) {
      throw new BadRequestException("Approval notification service is not configured");
    }
    const requested = await this.notifications.createMilestoneApprovalRequest({ projectId, milestoneId, principal });
    return {
      ...evaluation,
      ...requested,
      reviewerApprovalRequired: true,
      canApprove: evaluation.canApprove
    };
  }

  async evaluateMilestoneGateForTask(
    task: { projectId?: string | null; stageId?: string | null },
    principal: PrincipalContext
  ) {
    if (!task.projectId || !task.stageId || typeof this.prisma.projectStage?.findFirst !== "function") return;

    try {
      const stage = await this.prisma.projectStage.findFirst({
        where: {
          id: task.stageId,
          projectId: task.projectId,
          workspaceId: principal.workspaceId
        },
        select: { milestoneId: true }
      });
      if (stage?.milestoneId) {
        await this.evaluateProjectMilestoneGate(task.projectId, stage.milestoneId, principal);
      }
    } catch (error) {
      // Task completion is durable even if a stale/legacy hierarchy record
      // cannot be re-evaluated. The handoff endpoint remains retryable.
      this.logger.warn(`Milestone gate re-evaluation failed for task ${task.projectId}/${task.stageId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private assertCanEditMilestoneGate(principal: PrincipalContext) {
    this.permissions.assertInternalTaskPrincipal(principal, "Project milestone gates are internal");
    if (!principal.roleCodes.some((roleCode) => PROJECT_HIERARCHY_EDIT_ROLE_CODES.has(roleCode) || roleCode === "WORKSPACE_ADMIN")) {
      throw new ForbiddenException("Workspace admin, Founder/GM or Delivery Lead role is required to configure milestone gates");
    }
  }
}
