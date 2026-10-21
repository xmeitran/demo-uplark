import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { planFrameworkConversion, type FrameworkConversionPlan } from "../delivery-handoff/framework-conversion";
import { applyFrameworkConversion, backupFrameworkConversion, frameworkBackupDirectory, loadFrameworkSnapshot, projectsServiceHooks } from "../delivery-handoff/framework-conversion.service";
import { PROJECT_POSITIONS, type ProjectPosition } from "../delivery-handoff/legacy-conversion";
import { ProjectsService } from "../delivery-handoff/projects.service";
import { assertAdmin } from "../workspace-admin/workspace-admin.service";

/** Table 9.1 for one project, on an Admin's request. Same functions as scripts/operations/convert-project-frameworks.ts. */
@Injectable()
export class FrameworkConversionAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectsService) private readonly projects: ProjectsService
  ) {}

  private async plan(projectId: string, positionInput: unknown, principal: PrincipalContext): Promise<FrameworkConversionPlan> {
    assertAdmin(principal);
    const position = positionInput === undefined || positionInput === null || positionInput === "" ? undefined : String(positionInput) as ProjectPosition;
    // "unknown" is not an answer: the PM confirms one of the three rows of table 9.1.
    if (position && (!Object.prototype.hasOwnProperty.call(PROJECT_POSITIONS, position) || position === "unknown")) throw new BadRequestException("Vị trí không hợp lệ: before_g1, milestone_2 hoặc milestone_3_4.");
    const snapshot = await loadFrameworkSnapshot(this.prisma, principal.workspaceId, projectId);
    if (!snapshot) throw new NotFoundException("Không tìm thấy dự án.");
    return planFrameworkConversion(snapshot, { position });
  }

  /** Dry run: what applying would do. Writes nothing. */
  async preview(projectId: string, position: unknown, principal: PrincipalContext) {
    return { plan: await this.plan(projectId, position, principal) };
  }

  async apply(projectId: string, input: { position?: unknown } | undefined, principal: PrincipalContext) {
    const plan = await this.plan(projectId, input?.position, principal);
    if (!plan.operations.length) return { applied: false, plan };
    const now = new Date();
    const backupDirectory = frameworkBackupDirectory(undefined, now);
    await backupFrameworkConversion(this.prisma, backupDirectory, principal.workspaceId, plan);
    const actor = await this.prisma.user.findUnique({ where: { id: principal.subjectId }, select: { displayName: true } });
    await this.prisma.$transaction((tx) => applyFrameworkConversion(tx, plan, {
      workspaceId: principal.workspaceId, now, backupDirectory, requestId: randomUUID(),
      actor: { userId: principal.subjectId, displayName: actor?.displayName ?? null },
      hooks: projectsServiceHooks(this.projects, principal)
    }), { timeout: 120_000, maxWait: 20_000 });
    // V-17: the project now reads its position from G1–G8; the old milestone-based proposal is replaced.
    await this.projects.recomputeStatusProposal(projectId, principal);
    return { applied: true, backupDirectory, plan };
  }
}
