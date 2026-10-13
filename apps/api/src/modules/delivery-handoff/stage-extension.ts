/**
 * Stage extensions ("gia hạn stage": TD-04, TD-05, D-21). An extension moves a stage's due date and is approved by an
 * Admin (PM or Dx Director) with a reason; before/after, approver and reason are kept on the row and the change
 * becomes the next baseline version once the baseline is locked. TD-04 stops while the extended due date is ahead;
 * TD-05 fires from the Nth extension (`stageExtensionAbnormalCount`). Every extension counts — the exception for a
 * change request (V-40) is gone with the change-request flow (chốt 13/10); `changeRequestId` on old rows is not read.
 *
 * ponytail: the Admin who records the extension is its approver — there is no separate "request" step for a User.
 * Add a pending state when Users must be able to ask for an extension inside the system.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { ExtendStageInput, StageExtensionSummary } from "@b2b-crm/contracts";
import { getStoredParameter } from "../../shared/system-parameters";
import { recordBaselineChange } from "./baseline.service";
import { openOrRefreshProjectWarning } from "./project-warnings";

export interface StageExtensionRow {
  id: string;
  stageId: string;
  previousDueAt: Date | null;
  newDueAt: Date;
  reason: string;
  approvedByName: string | null;
  approvedAt: Date;
}

export function stageExtensionState(rows: readonly StageExtensionRow[], abnormalCount: number) {
  const ordered = [...rows].sort((left, right) => left.approvedAt.getTime() - right.approvedAt.getTime());
  const extensionCount = ordered.length;
  const extensions: StageExtensionSummary[] = ordered.map((row) => ({
    id: row.id, previousDueAt: row.previousDueAt?.toISOString(), newDueAt: row.newDueAt.toISOString(), reason: row.reason,
    approvedByName: row.approvedByName ?? undefined, approvedAt: row.approvedAt.toISOString()
  }));
  return { extensions, extensionCount, extensionAbnormal: extensionCount > 0 && extensionCount >= abnormalCount, extendedDueAt: ordered[ordered.length - 1]?.newDueAt.toISOString() };
}

export async function loadStageExtensions(client: any, workspaceId: string, projectIds: string[]): Promise<StageExtensionRow[]> {
  if (!projectIds.length || typeof client?.projectStageExtension?.findMany !== "function") return [];
  return client.projectStageExtension.findMany({ where: { workspaceId, projectId: { in: projectIds } }, orderBy: { approvedAt: "asc" } });
}

function parseDay(value: unknown): Date {
  const text = String(value ?? "").trim();
  // A bare day is the END of that day in Vietnam (UTC+7): the stage is due through the whole day, not at 07:00.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:59.999+07:00` : text);
  if (!text || Number.isNaN(date.getTime())) throw new BadRequestException("Hạn mới của stage: ngày không hợp lệ.");
  return date;
}

export async function extendStage(
  ctx: { prisma: any; principal: { workspaceId: string; subjectId: string; displayName?: string }; actor: { isPm: boolean }; now?: Date },
  projectId: string,
  stageId: string,
  input: ExtendStageInput
) {
  const { principal } = ctx;
  const now = ctx.now ?? new Date();
  // D-21: "phải được Admin (PM hoặc Dx Director) duyệt, lưu trước–sau, người duyệt và lý do".
  if (!ctx.actor.isPm) throw new ForbiddenException("Chỉ Admin (PM hoặc Dx Director) mới được duyệt gia hạn stage (D-21).");
  const reason = String(input?.reason ?? "").trim();
  if (!reason) throw new BadRequestException("Gia hạn stage bắt buộc ghi lý do.");
  const newDueAt = parseDay(input?.newDueAt);

  return ctx.prisma.$transaction(async (tx: any) => {
    const stage = await tx.projectStage.findFirst({ where: { id: stageId, projectId, workspaceId: principal.workspaceId } });
    if (!stage) throw new NotFoundException("Không tìm thấy stage.");
    const previous = await tx.projectStageExtension.findFirst({ where: { stageId }, orderBy: { approvedAt: "desc" } });
    const previousDueAt: Date | null = previous?.newDueAt ?? stage.plannedEndAt ?? null;
    if (previousDueAt && newDueAt.getTime() <= new Date(previousDueAt).getTime()) throw new BadRequestException("Hạn mới phải sau hạn hiện tại của stage.");
    const extension = await tx.projectStageExtension.create({
      data: { workspaceId: principal.workspaceId, projectId, stageId, previousDueAt, newDueAt, reason, approvedByUserId: principal.subjectId, approvedByName: principal.displayName ?? null, approvedAt: now }
    });
    await tx.projectStage.update({ where: { id: stageId }, data: { plannedEndAt: newDueAt } });
    await tx.auditEvent?.create({
      data: { workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action: "project.stage_extended", resource: "project_stage", resourceId: stageId,
        before: { dueAt: previousDueAt ? new Date(previousDueAt).toISOString() : null }, after: { dueAt: newDueAt.toISOString(), reason }, requestId: extension.id }
    });
    await recordBaselineChange(tx, {
      workspaceId: principal.workspaceId, projectId,
      cause: { type: "stage_extension", id: extension.id, reason },
      actor: { userId: principal.subjectId, displayName: principal.displayName }
    });

    // TD-05 is an event trigger and this is its only owner (the daily scan does not touch it): the warning opens with the
    // extension that crosses the threshold and the PM closes it ("PM xác nhận"). One record per stage: a further extension
    // refreshes the open warning, or opens a new one when the PM had confirmed the previous count.
    const count = await tx.projectStageExtension.count({ where: { stageId } });
    const threshold = await getStoredParameter(tx, principal.workspaceId, "stageExtensionAbnormalCount");
    if (count >= threshold) {
      await openOrRefreshProjectWarning(tx, {
        workspaceId: principal.workspaceId, projectId, dedupeKey: `TD-05:stage:${stageId}`, typeCode: "TD-05", severity: "medium", title: "Gia hạn stage bất thường",
        detail: `Stage "${stage.activity}" đã được duyệt gia hạn ${count} lần.`, stageId, milestoneId: stage.milestoneId, ownerUserId: stage.ownerUserId ?? null, actorUserId: principal.subjectId
      });
    }
    return extension;
  });
}
