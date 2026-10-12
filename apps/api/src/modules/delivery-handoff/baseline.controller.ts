import { BadRequestException, Body, Controller, Get, Headers, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { BASELINE_LAYERS, type BaselineLayer } from "@b2b-crm/contracts";
import { PrincipalService } from "../identity-access/principal.service";
import { captureBaselineManually, diffBaselineVersions, getProjectBaseline } from "./baseline.service";
import "./change-request-effects";
import { importCrLog } from "./cr-log-import";
import type { IssueLogContext } from "./issue-log.service";
import { ProjectPermissionsService } from "./project-permissions.service";
import { ProjectVisibilityGuard } from "./project-visibility";
import { ProjectsService } from "./projects.service";
import { extendStage } from "./stage-extension";

/**
 * Baselines B0/B1 (D-20, D-21), stage extensions (TD-04/TD-05) and the CR Log import (9.4).
 * Kept apart from ProjectsController; the logic is in baseline.service.ts, stage-extension.ts and cr-log-import.ts.
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

  /** Current version of B0 and B1, locked state, and the history with the diff of each version against the previous one. */
  @Get("projects/:projectId/baseline")
  async getBaseline(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string) {
    const { ctx } = await this.context(authorization, principalFallback, projectId);
    return getProjectBaseline(ctx.prisma, ctx.principal.workspaceId, projectId, ctx.actor);
  }

  /** Diff between two versions of one layer: ?layer=B1&from=1&to=3. */
  @Get("projects/:projectId/baseline/diff")
  async diffBaseline(@Headers("authorization") authorization: string | undefined, @Query() query: any, @Param("projectId") projectId: string) {
    const { ctx } = await this.context(authorization, query.principal, projectId);
    const from = Number(query.from);
    const to = Number(query.to);
    if (!(BASELINE_LAYERS as readonly string[]).includes(query.layer) || !Number.isInteger(from) || !Number.isInteger(to)) throw new BadRequestException("Cần layer (B0 hoặc B1), from và to.");
    return diffBaselineVersions(ctx.prisma, ctx.principal.workspaceId, projectId, query.layer as BaselineLayer, from, to);
  }

  /** Admin (PM / Dx Director): lock the baseline of a project that has none, or write a new version after changes. Body { reason }. */
  @Post("projects/:projectId/baseline")
  async captureBaseline(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string, @Body() body: any) {
    const { ctx } = await this.context(authorization, principalFallback, projectId);
    return captureBaselineManually(ctx, projectId, body?.reason);
  }

  /** "Gia hạn stage": Body { newDueAt, reason, changeRequestId? }. Admin (PM / Dx Director). Returns the gate list with the new extension. */
  @Post("projects/:projectId/stages/:stageId/extensions")
  async extendStage(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string, @Param("stageId") stageId: string, @Body() body: any) {
    const { ctx } = await this.context(authorization, principalFallback, projectId);
    await extendStage(ctx, projectId, stageId, body ?? {});
    return this.projects.listProjectGates(projectId, ctx.principal);
  }

  /** 9.4: import the old CR Log. Body { rows: [{ "<file header>": value }] }. Admin only. */
  @Post("projects/:projectId/risks/import")
  async importCrLog(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("projectId") projectId: string, @Body() body: any) {
    const { ctx, project } = await this.context(authorization, principalFallback, projectId);
    return importCrLog(ctx, project, body?.rows);
  }
}
