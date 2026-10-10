import { Controller, Get, Headers, Inject, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { TenantWorkspaceService } from "./tenant-workspace.service";

@Controller("workspaces")
export class TenantWorkspaceController {
  constructor(
    @Inject(TenantWorkspaceService) private readonly workspaces: TenantWorkspaceService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  /** Session required: the login screen does not call this, and the list is scoped to the caller's own tenant. */
  @Get()
  async listWorkspaces(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.workspaces.listWorkspaces({ tenantKey: principal.tenantKey });
  }

  @Get("current")
  async getCurrentWorkspace(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return {
      data: {
        tenantKey: principal.tenantKey,
        workspaceId: principal.workspaceId,
        workspaceKey: principal.workspaceKey
      }
    };
  }
}
