import { Body, Controller, Get, Headers, Inject, Patch, Post, Query } from "@nestjs/common";
import type { SendWorkspaceReminderInput, UpdateWorkspaceReminderPolicyInput } from "@b2b-crm/contracts";
import { PrincipalService } from "../identity-access/principal.service";
import { WorkspaceAdminService } from "./workspace-admin.service";

@Controller("admin")
export class WorkspaceAdminController {
  constructor(
    @Inject(WorkspaceAdminService) private readonly admin: WorkspaceAdminService,
    @Inject(PrincipalService) private readonly principals: PrincipalService
  ) {}

  @Get("overview")
  async overview(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.admin.overview(principal);
  }

  @Get("reminders")
  async reminders(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.admin.getReminderPolicy(principal);
  }

  @Get("reminders/recipients")
  async reminderRecipients(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.admin.reminderRecipients(principal);
  }

  @Post("reminders/send")
  async sendReminder(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() input: SendWorkspaceReminderInput) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.admin.sendReminder(input, principal);
  }

  @Get("alerts")
  async alerts(@Headers("authorization") authorization?: string, @Query("principal") principalFallback?: string) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.admin.alerts(principal);
  }

  @Patch("reminders")
  async updateReminders(@Headers("authorization") authorization: string | undefined, @Query("principal") principalFallback: string | undefined, @Body() input: UpdateWorkspaceReminderPolicyInput) {
    const principal = await this.principals.resolveFromAuthorization(authorization, principalFallback);
    return this.admin.updateReminderPolicy(input, principal);
  }
}
