import { Controller, Get, Headers, Inject, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { TenantWorkspaceService } from "./tenant-workspace.service";

@Controller("workspaces")
export class TenantWorkspaceController {
  constructor(
    @Inject(TenantWorkspaceService) private readonly workspaces: TenantWorkspaceService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get()
  listWorkspaces(@Query("tenantKey") tenant?: string) {
    return this.workspaces.listWorkspaces({ tenantKey: tenant });
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
