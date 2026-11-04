import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { SYSTEM_FOUNDER_ROLE_CODE } from "@b2b-crm/contracts";
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
    // Organizations share one tenant: everyone else sees only the one they are working in.
    return this.workspaces.listWorkspaces({ tenantKey: principal.tenantKey, onlyId: principal.roleCodes.includes(SYSTEM_FOUNDER_ROLE_CODE) ? undefined : principal.workspaceId });
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

/** Tổ chức tab: organizations and their members. The service enforces System Founder. */
@Controller("organizations")
export class OrganizationsController {
  constructor(
    @Inject(TenantWorkspaceService) private readonly workspaces: TenantWorkspaceService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get()
  async list(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    return this.workspaces.listOrganizations(await this.principals.resolveFromAuthorization(authorization, principalFallback));
  }

  @Post()
  async create(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() body: any) {
    return this.workspaces.createOrganization(await this.principals.resolveFromAuthorization(authorization, principalFallback), body);
  }

  @Patch(":id")
  async update(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("id") id: string, @Body() body: any) {
    return this.workspaces.updateOrganization(await this.principals.resolveFromAuthorization(authorization, principalFallback), id, body);
  }

  @Get(":id/members")
  async members(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("id") id: string) {
    return this.workspaces.listOrganizationMembers(await this.principals.resolveFromAuthorization(authorization, principalFallback), id);
  }

  @Put(":id/members")
  async setMember(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("id") id: string, @Body() body: any) {
    return this.workspaces.setOrganizationMember(await this.principals.resolveFromAuthorization(authorization, principalFallback), id, body);
  }

  @Delete(":id/members/:userId")
  async removeMember(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("id") id: string, @Param("userId") userId: string) {
    return this.workspaces.removeOrganizationMember(await this.principals.resolveFromAuthorization(authorization, principalFallback), id, userId);
  }
}
