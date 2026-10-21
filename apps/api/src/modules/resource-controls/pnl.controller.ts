import { Body, Controller, Delete, ForbiddenException, Get, Headers, Inject, Param, Patch, Post, Put, Query } from "@nestjs/common";
import type { PrincipalContext } from "@b2b-crm/contracts";
import { PrincipalService } from "../identity-access/principal.service";
import { PnlConfigService } from "./pnl-config.service";
import { PnlService } from "./pnl.service";

/** Tab P&L. Screen-by-screen contract: docs/pnl-api-cho-man-hinh.md; types: packages/contracts/src/pnl.ts. */
@Controller("pnl")
export class PnlController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalService,
    @Inject(PnlService) private readonly pnl: PnlService,
    @Inject(PnlConfigService) private readonly config: PnlConfigService
  ) {}

  private as<T>(auth: string | undefined, fallback: unknown, run: (principal: PrincipalContext) => Promise<T>): Promise<T> {
    return this.principals.resolveFromAuthorization(auth, typeof fallback === "string" ? fallback : undefined).then(run);
  }

  // --- Layer 4: reports ---
  @Get("dashboard")
  dashboard(@Headers("authorization") auth: string | undefined, @Query() query: any) { return this.as(auth, query.principal, (p) => this.pnl.dashboard(query, p)); }

  @Get("company-costs")
  companyCosts(@Headers("authorization") auth: string | undefined, @Query() query: any) { return this.as(auth, query.principal, (p) => this.pnl.companyCostDetail(query, p)); }

  @Get("entries")
  entries(@Headers("authorization") auth: string | undefined, @Query() query: any) { return this.as(auth, query.principal, (p) => this.pnl.entries(query, p)); }

  @Get("projects/:projectId")
  project(@Headers("authorization") auth: string | undefined, @Query() query: any, @Param("projectId") projectId: string) { return this.as(auth, query.principal, (p) => this.pnl.project(projectId, query, p)); }

  @Get("projects/:projectId/months/:periodKey")
  projectMonths(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("projectId") projectId: string, @Param("periodKey") periodKey: string) { return this.as(auth, fallback, (p) => this.pnl.projectMonths(projectId, periodKey, p)); }

  /** What still blocks the G7 approval of the project (mục 7 điểm 6). Readable by any internal account: it carries hours, no money. */
  @Get("projects/:projectId/g7-blockers")
  g7Blockers(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("projectId") projectId: string) { return this.as(auth, fallback, async (p) => {
    // Internal only (a portal user could read it before); the G7 gate screen of a PM shows it.
    if (p.subjectType !== "internal_user") throw new ForbiddenException("Chỉ dành cho nội bộ.");
    return { data: await this.pnl.pendingHoursBlockingG7(p.workspaceId, projectId) };
  }); }

  // --- Layer 1: the "Nhập tay" line ---
  @Post("projects/:projectId/manual-costs")
  createManualCost(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("projectId") projectId: string, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.createManualCost(projectId, body, p)); }

  @Patch("projects/:projectId/manual-costs/:costId")
  updateManualCost(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("projectId") projectId: string, @Param("costId") costId: string, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.updateManualCost(projectId, costId, body, p)); }

  @Delete("projects/:projectId/manual-costs/:costId")
  deleteManualCost(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("projectId") projectId: string, @Param("costId") costId: string) { return this.as(auth, fallback, (p) => this.config.deleteManualCost(projectId, costId, p)); }

  // --- Mục 5 khối 2: Giá trị dự án (PL-13) ---
  @Put("projects/:projectId/project-value")
  projectValue(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("projectId") projectId: string, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.setProjectValue(projectId, body, p)); }

  @Put("projects/:projectId/template-override")
  templateOverride(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("projectId") projectId: string, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.setTemplateOverride(projectId, body, p)); }

  // --- Mục 6.2: Khoản mục ---
  @Get("config/items")
  items(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined) { return this.as(auth, fallback, (p) => this.config.items(p)); }

  @Post("config/items/defaults")
  loadDefaults(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined) { return this.as(auth, fallback, (p) => this.config.loadDefaultItems(p)); }

  @Put("config/items")
  saveItem(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.saveItem(body, p)); }

  @Post("config/items/apply")
  applyItems(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.applyItemDrafts(body, p)); }

  @Post("config/items/discard")
  discardItems(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined) { return this.as(auth, fallback, (p) => this.config.discardItemDrafts(p)); }

  @Delete("config/items/:code")
  retireItem(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("code") code: string) { return this.as(auth, fallback, (p) => this.config.retireItem(code, p)); }

  // --- Mục 6.3: Tham số, lịch làm việc ---
  @Get("config/parameters")
  parameters(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined) { return this.as(auth, fallback, (p) => this.config.parameters(p)); }

  @Post("config/parameters")
  addParameter(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.addParameterValue(body, p)); }

  @Get("calendar/standard-hours")
  standardHours(@Headers("authorization") auth: string | undefined, @Query() query: any) { return this.as(auth, query.principal, (p) => this.config.standardHours(query, p)); }

  // --- Mục 6.6: Mẫu khoản mục ---
  @Get("config/templates")
  templates(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined) { return this.as(auth, fallback, (p) => this.config.templates(p)); }

  @Put("config/templates/:key")
  setTemplate(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("key") key: string, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.setTemplate(key, body, p)); }

  // --- Mục 6.4: Quỹ chi phí chung ---
  @Get("funds")
  funds(@Headers("authorization") auth: string | undefined, @Query() query: any) { return this.as(auth, query.principal, (p) => this.pnl.funds(query, p)); }

  @Post("funds")
  createFund(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: any) { return this.as(auth, fallback, (p) => this.pnl.createFund(body, p)); }

  @Patch("funds/:fundId")
  updateFund(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("fundId") fundId: string, @Body() body: any) { return this.as(auth, fallback, (p) => this.pnl.updateFund(fundId, body, p)); }

  @Put("funds/:fundId/periods/:periodKey")
  fundAmount(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("fundId") fundId: string, @Param("periodKey") periodKey: string, @Body() body: any) { return this.as(auth, fallback, (p) => this.pnl.setFundAmount(fundId, periodKey, body, p)); }

  @Post("funds/:fundId/periods/:periodKey/confirm")
  confirmFund(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("fundId") fundId: string, @Param("periodKey") periodKey: string) { return this.as(auth, fallback, (p) => this.pnl.confirmFund(fundId, periodKey, p)); }

  @Post("funds/:fundId/periods/:periodKey/rerun")
  rerunFund(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("fundId") fundId: string, @Param("periodKey") periodKey: string) { return this.as(auth, fallback, (p) => this.pnl.rerunFund(fundId, periodKey, p)); }

  // --- Mục 6.5: Kỳ và khóa kỳ ---
  @Get("periods")
  periods(@Headers("authorization") auth: string | undefined, @Query() query: any) { return this.as(auth, query.principal, (p) => this.pnl.periods(query, p)); }

  @Post("periods/:periodKey/lock")
  lock(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("periodKey") periodKey: string) { return this.as(auth, fallback, (p) => this.pnl.lockPeriod(periodKey, p)); }

  @Post("periods/:periodKey/reopen")
  reopen(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Param("periodKey") periodKey: string, @Body() body: any) { return this.as(auth, fallback, (p) => this.pnl.reopenPeriod(periodKey, body, p)); }

  // --- Mục 6.7: Hồ sơ nhân sự › Chi phí theo tháng ---
  @Get("staff-costs")
  staffCosts(@Headers("authorization") auth: string | undefined, @Query() query: any) { return this.as(auth, query.principal, (p) => this.config.staffCosts(query, p)); }

  @Get("staff-costs/template")
  staffCostTemplate(@Headers("authorization") auth: string | undefined, @Query() query: any) { return this.as(auth, query.principal, (p) => this.config.staffCostTemplate(query, p)); }

  @Put("staff-costs")
  setStaffCost(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.setStaffCost(body, p)); }

  @Post("staff-costs/approve")
  approveStaffCosts(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.approveStaffCosts(body, p)); }

  @Post("staff-costs/import")
  importStaffCosts(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.importStaffCosts(body, p)); }

  @Put("staff-costs/employee-code")
  employeeCode(@Headers("authorization") auth: string | undefined, @Query("principal") fallback: string | undefined, @Body() body: any) { return this.as(auth, fallback, (p) => this.config.setEmployeeCode(body, p)); }
}
