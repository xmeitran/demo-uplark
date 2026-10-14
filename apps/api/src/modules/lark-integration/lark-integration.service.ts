/**
 * Lark side of the PM rules: the project's two groups (V-02), the bots of table 7.5 and personal leave (D-09).
 *
 * Messages that follow an event (hồ sơ nộp, kết quả duyệt, yêu cầu khách xác nhận, đề xuất trạng thái) are sent by
 * ONE idempotent sweep: it looks at the gates and status proposals of the last SWEEP_WINDOW_DAYS and sends what the
 * delivery log does not have yet (dedupe key per event). Hooks call it for one project right after the change;
 * the scheduled call (POST /api/internal/lark-sweep) covers reminders and whatever a hook missed.
 */
import { BadRequestException, ForbiddenException, Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { PROJECT_GATE_CATALOGUE, type PrincipalContext, type ProjectGateCode } from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { loadParameters, standardDayMinutes } from "../../shared/system-parameters";
import { loadDayOffKeys, workingDaysBetween } from "../../shared/working-days";
import { addWorkingHours } from "../alerts/alert-evaluators";
import { deliverLarkAlert } from "../alerts/alert-notifications";
import { WORKSPACE_ADMIN_ROLE_CODES, isWorkspaceAdmin } from "../delivery-handoff/milestone-reviewer";
import { projectPmUserId } from "../delivery-handoff/project-visibility";
import { projectStatusLabel } from "../delivery-handoff/project-status";
import { LarkTransport, sendMessage, type LarkCard, type LarkOutcome, type LarkTransportLike } from "./lark-client";
import { registerLarkHooks } from "./lark-hooks";
import {
  LARK_BOTS, customerConfirmationReminderCard, customerConfirmationRequestCard, handoffResultCard, handoffReviewOverdueCard, handoffSubmittedCard, issueLogCard,
  projectAlertCard, projectUrl, statusProposalCard, statusProposalDecidedCard, statusProposalReminderCard, type IssueLogEvent, type ProjectRef
} from "./lark-templates";
import { syncPersonalLeave } from "./personal-leave";

const SWEEP_WINDOW_DAYS = 14;
const DAY_MS = 24 * 3_600_000;
const NO_INTERNAL_GROUP = "dự án chưa có nhóm nội bộ trên Lark";

const PROJECT_SELECT = {
  id: true, workspaceId: true, code: true, name: true, milestoneMode: true, milestoneTemplateKey: true,
  larkInternalChatId: true, larkCustomerChatId: true, larkGroupStatus: true, larkGroupError: true, larkGroupSyncedAt: true,
  account: { select: { name: true } }
} as const;

type ProjectRow = ProjectRef & { workspaceId: string; milestoneMode?: string | null; milestoneTemplateKey?: string | null; larkInternalChatId: string | null; larkCustomerChatId: string | null; larkGroupStatus: string; larkGroupError: string | null; larkGroupSyncedAt: Date | null };
type Post = { bot: string; card: LarkCard; dedupeKey: string; target: string };

@Injectable()
export class LarkIntegrationService implements OnModuleInit {
  env: NodeJS.ProcessEnv = process.env;

  constructor(@Inject(PrismaService) private readonly prisma: any, @Inject(LarkTransport) private readonly lark: LarkTransportLike) {}

  onModuleInit() {
    registerLarkHooks(this);
  }

  private get origin() {
    return (this.env.PUBLIC_APP_URL ?? this.env.CRM_AUTH_PUBLIC_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  }

  // -------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------

  private async loadProject(projectId: string, workspaceId?: string): Promise<ProjectRow | null> {
    const row = await this.prisma.project.findFirst({ where: { id: projectId, ...(workspaceId ? { workspaceId } : {}) }, select: PROJECT_SELECT });
    return row ? { ...row, accountName: row.account?.name ?? null } : null;
  }

  /** userId → Lark open_id (PortalIdentity "lark" of the workspace's tenant). People without one are simply absent. */
  private async openIds(workspaceId: string, userIds: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    if (!ids.length) return new Map();
    const workspace = await this.prisma.tenantWorkspace.findUnique({ where: { id: workspaceId }, select: { tenantKey: true } });
    const rows: Array<{ userId: string; providerUserId: string }> = await this.prisma.portalIdentity.findMany({ where: { provider: "lark", tenantKey: workspace?.tenantKey, userId: { in: ids } }, select: { userId: true, providerUserId: true } });
    return new Map(rows.map((row) => [row.userId, row.providerUserId]));
  }

  private async memberUsers(project: { id: string; workspaceId: string }): Promise<Array<{ id: string; displayName: string; roleCodes: string[] }>> {
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId: project.id, workspaceId: project.workspaceId, user: { status: "ACTIVE" } },
      select: { user: { select: { id: true, displayName: true, roleBindings: { where: { workspaceId: project.workspaceId }, select: { role: { select: { code: true } } } } } } }
    });
    const users = new Map<string, { id: string; displayName: string; roleCodes: string[] }>();
    for (const row of rows) users.set(row.user.id, { id: row.user.id, displayName: row.user.displayName, roleCodes: (row.user.roleBindings ?? []).map((binding: any) => binding.role?.code) });
    return [...users.values()];
  }

  /** The project's PIC = owner of its first stage (the same rule the issue log and the gates use for "PM"). */
  private async picUserId(project: { id: string; workspaceId: string }): Promise<string | null> {
    return projectPmUserId(this.prisma, project.workspaceId, project.id);
  }

  /** Workspace Admins: the seat of Dx Director / BD Lead / PM in the rules. */
  private async adminUserIds(workspaceId: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({ where: { status: "ACTIVE", roleBindings: { some: { workspaceId, role: { code: { in: [...WORKSPACE_ADMIN_ROLE_CODES] } } } } }, select: { id: true } });
    return users.map((user: { id: string }) => user.id);
  }

  private async userName(userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    return (await this.prisma.user.findFirst({ where: { id: userId }, select: { displayName: true } }))?.displayName ?? null;
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /** Sends one card to a chat once per dedupe key. A missing chat is written to the delivery log instead. */
  private async post(project: { id: string; workspaceId: string }, chatId: string | null | undefined, post: Post, missing = NO_INTERNAL_GROUP): Promise<LarkOutcome | null> {
    if (await this.lark.alreadyHandled(post.dedupeKey)) return null;
    const ctx = { workspaceId: project.workspaceId, projectId: project.id, bot: post.bot, dedupeKey: post.dedupeKey, target: post.target };
    if (!chatId) {
      await this.lark.record({ ...ctx, action: "send_message", status: "disabled", detail: missing });
      return { status: "disabled", detail: missing };
    }
    return sendMessage(this.lark, { chatId }, post.card, ctx);
  }

  // -------------------------------------------------------------------------
  // Bots: Hồ sơ chuyển tiếp, Xác nhận khách hàng, Trạng thái dự án
  // -------------------------------------------------------------------------

  async sweepProject(projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId }, select: { workspaceId: true } });
    if (project) await this.sweep(project.workspaceId, { projectId });
  }

  async sweep(workspaceId: string, options: { projectId?: string; now?: Date } = {}) {
    const now = options.now ?? new Date();
    const since = new Date(now.getTime() - SWEEP_WINDOW_DAYS * DAY_MS);
    const scope = { workspaceId, ...(options.projectId ? { projectId: options.projectId } : {}) };
    const [params, dayOffKeys, gates, proposals] = await Promise.all([
      loadParameters(this.prisma, workspaceId),
      loadDayOffKeys(this.prisma, workspaceId, since, now),
      this.prisma.projectGate.findMany({ where: { ...scope, updatedAt: { gte: since }, status: { not: "not_submitted" } } }),
      this.prisma.projectStatusProposal.findMany({ where: { ...scope, OR: [{ createdAt: { gte: since } }, { decidedAt: { gte: since } }] } })
    ]);
    const projectIds = [...new Set([...gates, ...proposals].map((row: any) => row.projectId as string))];
    if (!projectIds.length) return { gates: 0, proposals: 0 };
    const projects = new Map<string, ProjectRow>();
    for (const row of await this.prisma.project.findMany({ where: { workspaceId, id: { in: projectIds } }, select: PROJECT_SELECT })) projects.set(row.id, { ...row, accountName: row.account?.name ?? null });
    const adminOpenIds = [...(await this.openIds(workspaceId, await this.adminUserIds(workspaceId))).values()];
    const reviewChatId = this.env.LARK_HANDOFF_REVIEW_CHAT_ID?.trim() || null;
    const noReviewGroup = "chưa cấu hình nhóm \"Xét duyệt chuyển tiếp giai đoạn dự án\" (LARK_HANDOFF_REVIEW_CHAT_ID)";
    const pmOpenIdsOf = async (project: ProjectRow) => [...(await this.openIds(workspaceId, [await this.picUserId(project)])).values()];

    for (const gate of gates) {
      const project = projects.get(gate.projectId);
      if (!project) continue;
      const url = projectUrl(this.origin, project.id, "#gates");
      const key = (event: string, at: Date | null | undefined) => `gate:${gate.id}:${event}:${at ? new Date(at).toISOString() : ""}`;
      /** "Hồ sơ chuyển tiếp": the review group, reposted to the project's internal group. */
      const toReviewers = async (dedupeKey: string, card: LarkCard) => {
        await this.post(project, reviewChatId, { bot: LARK_BOTS.handoff, card, dedupeKey: `${dedupeKey}:review`, target: "nhóm Xét duyệt chuyển tiếp" }, noReviewGroup);
        await this.post(project, project.larkInternalChatId, { bot: LARK_BOTS.handoff, card, dedupeKey: `${dedupeKey}:internal`, target: "nhóm nội bộ" });
      };

      if (gate.submittedAt && new Date(gate.submittedAt) >= since) {
        await toReviewers(key("submitted", gate.submittedAt), handoffSubmittedCard({ project, gateCode: gate.code, submittedByName: await this.userName(gate.submittedByUserId), submittedAt: gate.submittedAt, reviewHours: params.handoffReviewWorkingHours, approverOpenIds: adminOpenIds, url }));
      }
      if (gate.decidedAt && gate.decision && new Date(gate.decidedAt) >= since) {
        await toReviewers(key("decided", gate.decidedAt), handoffResultCard({ project, gateCode: gate.code, decision: gate.decision, decidedByName: await this.userName(gate.decidedByUserId), reason: gate.decisionReason, awaitingCustomer: gate.status === "awaiting_customer", url }));
      }
      // V-15: one reminder after the review deadline, naming the Dx Director; BRI-04 takes over from there (alert scan).
      if (gate.status === "submitted" && gate.submittedAt && now > addWorkingHours(new Date(gate.submittedAt), params.handoffReviewWorkingHours, dayOffKeys)) {
        await toReviewers(key("review-overdue", gate.submittedAt), handoffReviewOverdueCard({ project, gateCode: gate.code, submittedAt: gate.submittedAt, reviewHours: params.handoffReviewWorkingHours, directorOpenIds: adminOpenIds, url }));
      }
      // V-14: the request goes to the customer group, then one reminder per elapsed working day — the first
      // `customerReminderMaxCount` in the customer group, later ones in the internal group only.
      if (gate.status === "awaiting_customer" && gate.customerRequestedAt) {
        const definition = PROJECT_GATE_CATALOGUE[gate.code as ProjectGateCode];
        const noCustomerGroup = "dự án chưa có nhóm khách hàng trên Lark";
        await this.post(project, project.larkCustomerChatId, {
          bot: LARK_BOTS.customerConfirmation, dedupeKey: key("customer-request", gate.customerRequestedAt), target: "nhóm khách hàng",
          card: customerConfirmationRequestCard({ project, gateCode: gate.code, dueAt: gate.customerDueAt, responseWorkingDays: params[definition?.customerResponseParameter ?? "customerResponseWorkingDays"], pmName: await this.userName(await this.picUserId(project)) })
        }, noCustomerGroup);
        const reminderNumber = workingDaysBetween(new Date(gate.customerRequestedAt), now, dayOffKeys);
        if (reminderNumber >= 1) {
          const max = params.customerReminderMaxCount;
          const toCustomer = reminderNumber <= max;
          const card = customerConfirmationReminderCard({ project, gateCode: gate.code, dueAt: gate.customerDueAt, reminderNumber, maxCustomerReminders: max, toCustomer, pmOpenIds: toCustomer ? [] : await pmOpenIdsOf(project), url });
          const outcome = await this.post(project, toCustomer ? project.larkCustomerChatId : project.larkInternalChatId, {
            bot: LARK_BOTS.customerConfirmation, card, dedupeKey: `${key("customer-reminder", gate.customerRequestedAt)}:${reminderNumber}`, target: toCustomer ? "nhóm khách hàng" : "nhóm nội bộ"
          }, toCustomer ? noCustomerGroup : NO_INTERNAL_GROUP);
          if (toCustomer && outcome?.status === "sent") await this.prisma.projectGate.update({ where: { id: gate.id }, data: { customerReminderCount: Math.max(gate.customerReminderCount ?? 0, reminderNumber) } });
        }
      }
    }

    for (const proposal of proposals) {
      const project = projects.get(proposal.projectId);
      if (!project) continue;
      const base = {
        project, fromLabel: projectStatusLabel(proposal.fromStatus) ?? proposal.fromStatus, proposedLabel: projectStatusLabel(proposal.proposedStatus) ?? proposal.proposedStatus,
        basis: proposal.basis, url: projectUrl(this.origin, project.id), confirmWorkingDays: params.statusProposalConfirmWorkingDays
      };
      const send = (event: string, card: LarkCard) => this.post(project, project.larkInternalChatId, { bot: LARK_BOTS.projectStatus, card, dedupeKey: `proposal:${proposal.id}:${event}`, target: "nhóm nội bộ" });
      if (proposal.status === "pending") {
        const deciderOpenIds = await pmOpenIdsOf(project);
        await send("created", statusProposalCard({ ...base, deciderOpenIds }));
        // V-20: one reminder after the confirmation deadline; the alert scan turns it into a warning after that.
        if (workingDaysBetween(new Date(proposal.createdAt), now, dayOffKeys) > params.statusProposalConfirmWorkingDays) await send("reminder", statusProposalReminderCard({ ...base, deciderOpenIds }));
      } else if (proposal.status === "confirmed" || proposal.status === "declined") {
        await send(proposal.status, statusProposalDecidedCard({ ...base, decision: proposal.status, decidedByName: await this.userName(proposal.decidedByUserId), reason: proposal.declineReason }));
      }
    }
    return { gates: gates.length, proposals: proposals.length };
  }

  // -------------------------------------------------------------------------
  // Bot: Sổ vấn đề dự án → nhóm nội bộ, gắn PM và BD phụ trách
  // -------------------------------------------------------------------------

  /**
   * Called after every create / edit / transition of an issue-log record; only "bản ghi mới", "đổi mức" and
   * "chuyển cấp" are announced. The document also names "hai Leader": the data has no team-leader field yet
   * ([Cần chốt] in the gap table), so only the PM and the project's BD are mentioned.
   */
  async announceIssueLogEvent(record: any, projectInput: { id: string }) {
    const last = Array.isArray(record?.events) ? record.events.at(-1) : null;
    const event: IssueLogEvent | null = !last ? null
      : last.action === "created" || last.action === "converted_from" ? "created"
      : last.action === "escalate" ? "escalated"
      : last.action === "updated" && String(last.note ?? "").includes("mức ảnh hưởng:") ? "severity_changed"
      : null;
    if (!event) return;
    const project = await this.loadProject(projectInput.id);
    if (!project) return;
    const members = await this.memberUsers(project);
    const mentionOpenIds = [...(await this.openIds(project.workspaceId, [await this.picUserId(project), ...members.filter((member) => member.roleCodes.includes("SALES_OWNER")).map((member) => member.id)])).values()];
    await this.post(project, project.larkInternalChatId, {
      bot: LARK_BOTS.issueLog, dedupeKey: `issue:${record.id}:${last.id ?? `${last.action}:${new Date(last.at ?? Date.now()).toISOString()}`}`, target: "nhóm nội bộ",
      card: issueLogCard({
        project, event, code: record.code, type: record.type, severity: record.severity, description: String(record.description ?? ""), ownerName: record.owner?.displayName ?? null, dueAt: record.dueAt,
        escalationLabel: record.escalationLevel === "dx_director" ? "Dx Director" : record.escalationLevel === "bd_lead" ? "BD Lead" : null,
        note: event === "created" ? null : last.note, mentionOpenIds, url: projectUrl(this.origin, project.id, "#risks")
      })
    });
  }

  // -------------------------------------------------------------------------
  // Bot: Cảnh báo dự án
  // -------------------------------------------------------------------------

  /**
   * Lark channel of the alert scan. A message about ONE project that has an internal group goes there; anything
   * else goes where it went before (the "Quản lý dự án" webhook, or "chưa cấu hình kênh Lark").
   */
  async deliverProjectAlert(message: { title: string; body: string; href: string; alerts?: ReadonlyArray<{ projectId: string }> }): Promise<string> {
    const projectIds = [...new Set((message.alerts ?? []).map((alert) => alert.projectId))];
    const project = projectIds.length === 1 ? await this.loadProject(projectIds[0]) : null;
    if (project?.larkInternalChatId) {
      const outcome = await sendMessage(this.lark, { chatId: project.larkInternalChatId }, projectAlertCard({ title: message.title, body: message.body, url: `${this.origin}${message.href}` }),
        { workspaceId: project.workspaceId, projectId: project.id, bot: LARK_BOTS.projectAlert, target: "nhóm nội bộ" });
      if (outcome.status === "sent") return "đã gửi Lark (nhóm nội bộ dự án)";
    }
    return deliverLarkAlert(message, this.env);
  }

  // -------------------------------------------------------------------------
  // Scheduled entry point and personal leave
  // -------------------------------------------------------------------------

  private leaveOptions() {
    const lookbackDays = Number(this.env.LARK_LEAVE_SYNC_LOOKBACK_DAYS);
    return { approvalCode: this.env.LARK_LEAVE_APPROVAL_CODE, lookbackDays: Number.isFinite(lookbackDays) && lookbackDays > 0 ? lookbackDays : undefined };
  }

  /** POST /api/internal/lark-sweep: bot sweep + leave sync for every active workspace. Guarded by LARK_SWEEP_TOKEN (falls back to ALERT_SCAN_TOKEN). */
  async scheduledSweep(token: string | undefined) {
    const expected = (this.env.LARK_SWEEP_TOKEN ?? this.env.ALERT_SCAN_TOKEN)?.trim();
    if (!expected) throw new ForbiddenException("LARK_SWEEP_TOKEN chưa được cấu hình trên API.");
    const given = Buffer.from(String(token ?? ""));
    if (given.length !== Buffer.byteLength(expected) || !timingSafeEqual(given, Buffer.from(expected))) throw new ForbiddenException("Mã gọi tác vụ Lark không hợp lệ.");
    const workspaces = await this.prisma.tenantWorkspace.findMany({ where: { status: "active" }, select: { id: true } });
    const data = [];
    for (const workspace of workspaces) {
      data.push({ workspaceId: workspace.id, bots: await this.sweep(workspace.id), leave: await syncPersonalLeave(this.prisma, this.lark, workspace.id, this.leaveOptions()) });
    }
    return { data };
  }

  private assertAdmin(principal: PrincipalContext) {
    if (principal.subjectType !== "internal_user" || !isWorkspaceAdmin(principal.roleCodes)) throw new ForbiddenException("Chỉ Admin mới được xem và đồng bộ ngày nghỉ cá nhân.");
  }

  /** Admin › Ngày nghỉ › "Đồng bộ ngay". */
  async syncPersonalLeaveNow(principal: PrincipalContext) {
    this.assertAdmin(principal);
    return syncPersonalLeave(this.prisma, this.lark, principal.workspaceId, this.leaveOptions());
  }

  /** Admin › Ngày nghỉ: read-only list (leave that ends in the last 30 days or later) with the last sync result. */
  async listPersonalLeave(principal: PrincipalContext, query: { from?: string } = {}) {
    this.assertAdmin(principal);
    const from = query.from ? new Date(`${String(query.from).slice(0, 10)}T00:00:00.000Z`) : new Date(Date.now() - 30 * DAY_MS);
    if (Number.isNaN(from.getTime())) throw new BadRequestException("from phải theo dạng YYYY-MM-DD.");
    const [rows, lastSync] = await Promise.all([
      this.prisma.personalLeave.findMany({ where: { workspaceId: principal.workspaceId, endDate: { gte: from } }, orderBy: [{ startDate: "desc" }, { userId: "asc" }], take: 500 }),
      this.prisma.larkDeliveryLog.findFirst({ where: { workspaceId: principal.workspaceId, action: "leave_sync" }, orderBy: { createdAt: "desc" } })
    ]);
    const users: Array<{ id: string; displayName: string }> = rows.length ? await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row: any) => row.userId))] } }, select: { id: true, displayName: true } }) : [];
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    const standard = standardDayMinutes(await loadParameters(this.prisma, principal.workspaceId));
    const dateOf = (value: Date) => new Date(value).toISOString().slice(0, 10);
    return {
      data: rows.map((row: any) => ({
        id: row.id, userId: row.userId, userName: names.get(row.userId) ?? row.userId, startDate: dateOf(row.startDate), endDate: dateOf(row.endDate), startHalfDay: row.startHalfDay, endHalfDay: row.endHalfDay,
        leaveType: row.leaveType ?? undefined, source: row.source, sourceInstanceId: row.sourceInstanceId, status: row.status, syncedAt: new Date(row.syncedAt).toISOString()
      })),
      meta: {
        configured: Boolean(this.env.LARK_LEAVE_APPROVAL_CODE?.trim()), messagingEnabled: this.env.LARK_MESSAGING_ENABLED === "true", halfDayMinutes: standard / 2,
        lastSync: lastSync ? { at: new Date(lastSync.createdAt).toISOString(), status: lastSync.status, detail: lastSync.detail ?? "" } : null
      }
    };
  }
}
