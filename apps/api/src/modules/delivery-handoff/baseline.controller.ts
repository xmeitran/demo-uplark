import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { captureBaselineManually, diffBaselineVersions, getProjectBaseline } from "./baseline.service";
import type { IssueLogContext } from "./issue-log.service";
import { ProjectPermissionsService } from "./project-permissions.service";
import { ProjectVisibilityGuard } from "./project-visibility";
import { ProjectsService } from "./projects.service";
import { extendStage } from "./stage-extension";

/**
 * The plan baseline (D-20, D-21) and stage extensions (TD-04/TD-05).
 * Kept apart from ProjectsController; the logic is in baseline.service.ts and stage-extension.ts.
 */
@Controller()
@UseGuards(ProjectVisibilityGuard)
export class BaselineController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(ProjectPermissionsService) private readonly permissions: ProjectPermissionsService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  /** The same project lookup, internal-user check and actor (PM / Admin / member) every issue-log and gate endpoint uses. */
  private async context(authorization: string | undefined, principalFallback: string | undefined, projectId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    this.permissions.assertInternalTaskPrincipal(principal, "Baselines are internal");
    const project = await this.permissions.ensureProject(projectId, principal.workspaceId);
    const ctx: IssueLogContext = await this.permissions.issueLogContext(projectId, principal);
    return { ctx, project };
  }

  /** The baseline version in force, locked state, and the history with the diff of each version against the previous one. */
  @Get("projects/:projectId/baseline")
  async getBaseline(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string) {
    const { ctx } = await this.context(authorization, principalFallback, projectId);
    return getProjectBaseline(ctx.prisma, ctx.principal.workspaceId, projectId, ctx.actor);
  }

  /** Diff between two versions: ?from=1&to=3. */
  @Get("projects/:projectId/baseline/diff")
  async diffBaseline(@Headers("authorization") authorization: string | undefined, @Query() query: any, @Param("projectId") projectId: string) {
    const { ctx } = await this.context(authorization, query.principal, projectId);
    const from = Number(query.from);
    const to = Number(query.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new BadRequestException("Cần from và to là số phiên bản.");
    return diffBaselineVersions(ctx.prisma, ctx.principal.workspaceId, projectId, from, to);
  }

  /** Admin (PM / Dx Director): lock the baseline of a project that has none, or write a new version after changes. Body { reason }. */
  @Post("projects/:projectId/baseline")
  async captureBaseline(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string, @Body() body: any) {
    const { ctx } = await this.context(authorization, principalFallback, projectId);
    return captureBaselineManually(ctx, projectId, body?.reason);
  }

  /** "Gia hạn stage": Body { newDueAt, reason }. Admin (PM / Dx Director). Returns the gate list with the new extension. */
  @Post("projects/:projectId/stages/:stageId/extensions")
  async extendStage(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string, @Param("stageId") stageId: string, @Body() body: any) {
    const { ctx } = await this.context(authorization, principalFallback, projectId);
    await extendStage(ctx, projectId, stageId, body ?? {});
    return this.projects.listProjectGates(projectId, ctx.principal);
  }
}
