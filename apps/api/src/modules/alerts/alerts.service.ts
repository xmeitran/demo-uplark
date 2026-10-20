import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import { ProjectsService } from "../delivery-handoff/projects.service";
import { Prisma } from "@prisma/client";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  ALERT_TRIGGERS,
  SYSTEM_PARAMETERS,
  SYSTEM_PARAMETER_KEYS,
  alertTriggerOf,
  isSystemParameterKey,
  validateAlertTriggerOverride,
  validateSystemParameter,
  type AdminWarningItem,
  type AlertScanResult,
  type AlertTriggerDef,
  type AlertTriggerOverrides,
  type PrincipalContext,
  type ResourceListPaginationMeta,
  type SystemParameterDef,
  type SystemParameterItem,
  type SystemParameterKey
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { buildPaginationMeta, normalizePagination } from "../../shared/http/request-context";
import { csvIn, csvList, vietnamDayRange } from "../../shared/http/list-filters";
import { loadLatestParameterRows } from "../../shared/system-parameters";
import { NotificationsService } from "../notifications/notifications.service";
import { PnlService } from "../resource-controls/pnl.service";
import { assertAdmin } from "../workspace-admin/workspace-admin.service";
import type { ScanPendingHours } from "./alert-evaluators";
import { loadAlertTriggers, runAlertScan, shouldScanToday, TRIGGER_OVERRIDES_KEY } from "./alert-scan";
import { larkAlertDelivery } from "../lark-integration/lark-hooks";

/** The three fixed reminder slots, in the order "Mốc nhắc trong ngày" lists its times. */
const REMINDER_SLOTS = [
  { slot: "morning_plan", label: "Kế hoạch đầu ngày" },
  { slot: "pm_follow_up", label: "Nhắc lại cho PM" },
  { slot: "evening_actual", label: "Giờ thực tế cuối ngày" }
] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

@Injectable()
export class AlertsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PnlService) private readonly pnl: PnlService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Optional() @Inject(ProjectsService) private readonly projects?: ProjectsService
  ) {}

  // -------------------------------------------------------------------------
  // 7.6 parameters
  // -------------------------------------------------------------------------

  /** "Mốc nhắc trong ngày" is stored where the reminders read it (WorkspaceReminderPolicy, Admin › Nhắc Lark): one source of truth. */
  private async reminderTimesFromPolicy(workspaceId: string): Promise<string[] | undefined> {
    const policy = await this.prisma.workspaceReminderPolicy.findUnique({ where: { workspaceId } });
    const slots = Array.isArray(policy?.slots) ? policy.slots as Array<{ slot?: string; time?: string }> : undefined;
    const times = slots && REMINDER_SLOTS.map(({ slot }) => slots.find((item) => item?.slot === slot)?.time);
    return times?.every((time) => typeof time === "string") ? times as string[] : undefined;
  }

  async listParameters(principal: PrincipalContext): Promise<{ data: SystemParameterItem[] }> {
    assertAdmin(principal);
    const [rows, reminderTimes] = await Promise.all([
      loadLatestParameterRows(this.prisma, principal.workspaceId, SYSTEM_PARAMETER_KEYS),
      this.reminderTimesFromPolicy(principal.workspaceId)
    ]);
    return {
      data: SYSTEM_PARAMETER_KEYS.map((key) => {
        const definition = SYSTEM_PARAMETERS[key] as SystemParameterDef;
        const row = rows.get(key);
        let value: unknown = definition.defaultValue;
        try {
          if (key === "reminderTimes" && reminderTimes) value = validateSystemParameter(key, reminderTimes);
          else if (row && row.value !== null && row.value !== undefined) value = validateSystemParameter(key, row.value);
        } catch { /* a stored value the catalogue no longer accepts reads as the default */ }
        const { defaultValue, ...rest } = definition;
        return {
          ...rest, key, value, defaultValue, isDefault: same(value, defaultValue),
          updatedAt: row?.createdAt.toISOString(), updatedByUserId: row?.updatedByUserId ?? undefined, updatedByName: row?.updatedByName ?? undefined
        };
      })
    };
  }

  /** `reset` puts the parameter back to the document's default; either way a history row and an audit event are written. */
  async updateParameter(key: string, input: { value?: unknown; reset?: boolean }, principal: PrincipalContext) {
    assertAdmin(principal);
    if (!isSystemParameterKey(key)) throw new BadRequestException(`Tham số "${key}" không có trong danh mục.`);
    let value: unknown;
    try {
      value = input?.reset ? SYSTEM_PARAMETERS[key].defaultValue : validateSystemParameter(key, input?.value);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Giá trị không hợp lệ.");
    }
    const before = (await this.listParameters(principal)).data.find((item) => item.key === key)?.value;
    await this.prisma.$transaction(async (tx) => {
      if (key === "reminderTimes") await this.writeReminderTimes(tx, value as string[], principal);
      await this.writeRow(tx, key, input?.reset ? null : value, principal, "system.parameter_updated", before, value);
    });
    return { data: (await this.listParameters(principal)).data.find((item) => item.key === (key as SystemParameterKey))! };
  }

  private async writeRow(tx: Prisma.TransactionClient, key: string, value: unknown, principal: PrincipalContext, action: string, before: unknown, after: unknown) {
    const user = await tx.user.findUnique({ where: { id: principal.subjectId }, select: { displayName: true } });
    await tx.systemParameter.create({
      data: { workspaceId: principal.workspaceId, key, value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue, updatedByUserId: principal.subjectId, updatedByName: user?.displayName ?? null }
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: principal.workspaceId, actorUserId: principal.subjectId, action, resource: "system_parameter", resourceId: key,
        before: { value: before ?? null } as Prisma.InputJsonValue, after: { value: after ?? null } as Prisma.InputJsonValue, requestId: randomUUID()
      }
    });
  }

  private async writeReminderTimes(tx: Prisma.TransactionClient, times: string[], principal: PrincipalContext) {
    const current = await tx.workspaceReminderPolicy.findUnique({ where: { workspaceId: principal.workspaceId } });
    const stored = Array.isArray(current?.slots) ? current.slots as Array<{ slot?: string; enabled?: boolean }> : [];
    const slots = REMINDER_SLOTS.map(({ slot, label }, index) => ({ slot, label, time: times[index], enabled: stored.find((item) => item?.slot === slot)?.enabled ?? true }));
    await tx.workspaceReminderPolicy.upsert({
      where: { workspaceId: principal.workspaceId },
      create: { id: `wrp_${randomUUID()}`, workspaceId: principal.workspaceId, enabled: true, weekdaysOnly: true, timezone: "Asia/Ho_Chi_Minh", slots, updatedByUserId: principal.subjectId },
      update: { slots, updatedByUserId: principal.subjectId }
    });
  }

  async parameterHistory(key: string, principal: PrincipalContext) {
    assertAdmin(principal);
    if (!isSystemParameterKey(key)) throw new BadRequestException(`Tham số "${key}" không có trong danh mục.`);
    const rows = await this.prisma.systemParameter.findMany({ where: { workspaceId: principal.workspaceId, key }, orderBy: { createdAt: "desc" }, take: 50 });
    return { data: rows.map((row) => ({ id: row.id, value: row.value ?? SYSTEM_PARAMETERS[key].defaultValue, reset: row.value === null, updatedByUserId: row.updatedByUserId ?? undefined, updatedByName: row.updatedByName ?? undefined, updatedAt: row.createdAt.toISOString() })) };
  }

  // -------------------------------------------------------------------------
  // 7.5 trigger catalogue (V-38)
  // -------------------------------------------------------------------------

  async listTriggers(principal: PrincipalContext): Promise<{ data: AlertTriggerDef[] }> {
    assertAdmin(principal);
    return { data: await loadAlertTriggers(this.prisma, principal.workspaceId) };
  }

  async updateTrigger(code: string, input: unknown, principal: PrincipalContext) {
    assertAdmin(principal);
    let override: ReturnType<typeof validateAlertTriggerOverride>;
    try {
      override = validateAlertTriggerOverride(code, input);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Cấu hình không hợp lệ.");
    }
    const row = (await loadLatestParameterRows(this.prisma, principal.workspaceId, [TRIGGER_OVERRIDES_KEY])).get(TRIGGER_OVERRIDES_KEY);
    const current = (row?.value && typeof row.value === "object" ? row.value : {}) as AlertTriggerOverrides;
    const next = { ...current, [code]: { ...current[code], ...override } };
    await this.prisma.$transaction((tx) => this.writeRow(tx, TRIGGER_OVERRIDES_KEY, next, principal, "system.alert_trigger_updated", { [code]: current[code] ?? null }, { [code]: next[code] }));
    return { data: alertTriggerOf(code, await loadAlertTriggers(this.prisma, principal.workspaceId))! };
  }

  // -------------------------------------------------------------------------
  // Warning records for Admin › Cảnh báo
  // -------------------------------------------------------------------------

  /**
   * Filters: `status` (open | closed | all, default open), `typeCode`, `projectId`, `severity`, `ownerUserId` — each one value
   * or a comma-joined list; `from`/`to` inclusive Vietnam days on openedAt; `q` on title/detail/project. Paged with
   * `limit` (default and max 100) / `offset`; `meta.total` is the filtered count.
   */
  async listWarnings(query: Record<string, unknown>, principal: PrincipalContext): Promise<{ data: AdminWarningItem[]; meta: { total: number; open: number; byCode: Record<string, number>; pagination: ResourceListPaginationMeta } }> {
    assertAdmin(principal);
    const pagination = normalizePagination({ limit: (query.limit as string | undefined) ?? 100, offset: query.offset as string | undefined });
    // No status (or an unknown one) keeps the old default: open warnings only. "all" lifts the filter.
    const requested = csvList(query.status);
    const known = requested.filter((value) => value === "open" || value === "closed");
    const status = requested.includes("all") ? undefined : { in: known.length ? known : ["open"] };
    const openedAt = vietnamDayRange(query.from, query.to);
    const q = typeof query.q === "string" ? query.q.trim() : "";
    const where: Prisma.ProjectWarningWhereInput = {
      workspaceId: principal.workspaceId,
      ...(status ? { status } : {}),
      ...(csvIn(query.typeCode) ? { typeCode: csvIn(query.typeCode) } : {}),
      ...(csvIn(query.projectId) ? { projectId: csvIn(query.projectId) } : {}),
      ...(csvIn(query.severity) ? { severity: csvIn(query.severity) } : {}),
      ...(csvIn(query.ownerUserId) ? { ownerUserId: csvIn(query.ownerUserId) } : {}),
      ...(openedAt ? { openedAt } : {}),
      ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { detail: { contains: q, mode: "insensitive" } }, { project: { name: { contains: q, mode: "insensitive" } } }, { project: { code: { contains: q, mode: "insensitive" } } }] } : {})
    };
    const [rows, total, openByCode] = await Promise.all([
      this.prisma.projectWarning.findMany({ where, orderBy: [{ status: "desc" }, { openedAt: "desc" }, { id: "asc" }], take: pagination.limit, skip: pagination.offset, include: { project: { select: { name: true, code: true } } } }),
      this.prisma.projectWarning.count({ where }),
      this.prisma.projectWarning.groupBy({ by: ["typeCode"], where: { workspaceId: principal.workspaceId, status: "open" }, _count: { _all: true } })
    ]);
    const ownerIds = [...new Set(rows.map((row) => row.ownerUserId).filter((id): id is string => Boolean(id)))];
    const owners = new Map((ownerIds.length ? await this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, displayName: true } }) : []).map((user) => [user.id, user.displayName]));
    const now = new Date();
    const byCode = Object.fromEntries(openByCode.map((row) => [row.typeCode, row._count._all]));
    return {
      data: rows.map((row) => {
        const trigger = alertTriggerOf(row.typeCode, ALERT_TRIGGERS);
        return {
          id: row.id, projectId: row.projectId, projectName: row.project.name, projectCode: row.project.code, typeCode: row.typeCode,
          triggerName: trigger?.name ?? row.typeCode, group: trigger?.group, severity: row.severity, title: row.title, detail: row.detail ?? undefined, status: row.status,
          ownerUserId: row.ownerUserId ?? undefined, ownerName: row.ownerUserId ? owners.get(row.ownerUserId) ?? undefined : undefined,
          dueAt: row.dueAt?.toISOString(), overdue: row.status === "open" && Boolean(row.dueAt && row.dueAt < now),
          openedAt: row.openedAt.toISOString(), closedAt: row.closedAt?.toISOString(), closeReason: row.closeReason ?? undefined
        };
      }),
      meta: { total, open: Object.values(byCode).reduce((sum, count) => sum + count, 0), byCode, pagination: buildPaginationMeta({ ...pagination, total, returned: rows.length }) }
    };
  }

  // -------------------------------------------------------------------------
  // The daily scan
  // -------------------------------------------------------------------------

  /**
   * DL-01 reads the P&L hour gate (PnlService). Hours of a trial project never count towards the deadline (PL-02);
   * Pre-sale hours do (chốt 13/10: there is no "waiting for the contract" state any more).
   */
  private pendingHours(workspaceId: string, projectIds: string[]): Promise<ScanPendingHours[]> {
    return this.pnl.pendingHoursForAlerts(workspaceId, projectIds);
  }

  private scan(workspaceId: string): Promise<AlertScanResult> {
    return runAlertScan(this.prisma, workspaceId, {
      loadPendingHours: (id, projectIds) => this.pendingHours(id, projectIds),
      syncProjectStatus: this.projects ? (projectId) => this.projects!.recomputeStatusProposal(projectId) : undefined,
      deliverLark: larkAlertDelivery.deliver, // project's internal Lark group first; undefined = the webhook default
      createNotification: (notification) => this.notifications.notifyProjectWarnings({ ...notification, data: notification.data as Prisma.InputJsonValue })
    });
  }

  /** Admin › Cảnh báo › "Quét ngay". */
  async scanNow(principal: PrincipalContext) {
    assertAdmin(principal);
    return { data: await this.scan(principal.workspaceId) };
  }

  /** The scheduled run: every active workspace, skipped on a non-working day unless forced. Guarded by ALERT_SCAN_TOKEN. */
  async scanAll(token: string | undefined, force = false) {
    const expected = process.env.ALERT_SCAN_TOKEN?.trim();
    if (!expected) throw new ForbiddenException("ALERT_SCAN_TOKEN chưa được cấu hình trên API.");
    const given = Buffer.from(String(token ?? ""));
    if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) throw new ForbiddenException("Mã quét cảnh báo không hợp lệ.");
    const workspaces = await this.prisma.tenantWorkspace.findMany({ where: { status: "active" }, select: { id: true } });
    const data: Array<AlertScanResult | { workspaceId: string; skipped: string }> = [];
    for (const workspace of workspaces) {
      if (!force && !(await shouldScanToday(this.prisma, workspace.id))) data.push({ workspaceId: workspace.id, skipped: "Hôm nay không phải ngày làm việc" });
      else data.push(await this.scan(workspace.id));
    }
    return { data };
  }
}
