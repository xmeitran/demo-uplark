import { Controller, Get, Headers, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { PrincipalService } from "../identity-access/principal.service";
import { NotificationsService } from "./notifications.service";

@Controller()
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get("notifications")
  async list(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.notifications.list(principal);
  }

  @Patch("notifications/:notificationId/read")
  async markRead(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Param("notificationId") notificationId: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.notifications.markRead(notificationId, principal);
  }

  @Get("admin/approvals")
  async approvals(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.notifications.listApprovalQueue(principal);
  }
}
