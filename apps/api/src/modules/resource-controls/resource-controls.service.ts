import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ADMIN_ROLE_CODES } from "@b2b-crm/contracts";
import type {
  CapacitySummaryItem,
  CapacitySummaryResponse,
  CreateResourceAllocationInput,
  PnlG7Blockers,
  PrincipalContext,
  ResourceAllocationSummary
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { normalizeProjectStatus } from "../delivery-handoff/project-status";
import { PnlService } from "./pnl.service";

const DEFAULT_WEEKLY_CAPACITY_MINUTES = 2400;
@Injectable()
export class ResourceControlsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(PnlService) private readonly pnl?: PnlService
  ) {}

  async capacitySummary(query: any, principal: PrincipalContext): Promise<CapacitySummaryResponse> {
    // Staff emails, skills and every client's allocations: internal only (it had no check at all).
    if (principal.subjectType !== "internal_user") throw new ForbiddenException("Năng lực nhân sự chỉ dành cho nội bộ.");
    const periodStart = startOfDay(parseDate(query.periodStart) ?? startOfWeek(new Date()));
    const periodEnd = startOfDay(parseDate(query.periodEnd) ?? addDays(periodStart, 7));

    if (periodEnd <= periodStart) {
      throw new BadRequestException("periodEnd must be after periodStart");
    }

    const users = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        subjectType: "INTERNAL_USER",
        roleBindings: {
          some: {
            workspaceId: principal.workspaceId,
            tenantKey: principal.tenantKey,
            endsAt: null
          }
        }
      },
      include: {
        resourceProfile: true,
        capacityPeriods: {
          where: {
            periodStart: { lte: periodStart },
            periodEnd: { gte: periodEnd }
          }
        },
        resourceAllocations: {
          where: {
            workspaceId: principal.workspaceId,
            startAt: { lt: periodEnd },
            endAt: { gt: periodStart },
            status: { notIn: ["RELEASED", "CANCELLED"] }
          },
          include: {
            account: true,
            project: true,
            opportunity: true,
            user: true
          },
          orderBy: { startAt: "asc" }
        }
      },
      orderBy: [{ displayName: "asc" }, { email: "asc" }]
    });

    const data: CapacitySummaryItem[] = users.map((user) => {
      const profile = user.resourceProfile;
      const matchingPeriod = user.capacityPeriods[0];
      const availableMinutes =
        matchingPeriod?.availableMinutes ?? profile?.defaultWeeklyCapacityMinutes ?? DEFAULT_WEEKLY_CAPACITY_MINUTES;
      const allocations = user.resourceAllocations.map(mapAllocation);
      // EV-035: allocations on On Hold projects are freed capacity; report them apart from the load.
      const onHoldAllocatedMinutes = user.resourceAllocations
        .filter((allocation) => normalizeProjectStatus(allocation.project?.status) === "on_hold")
        .reduce((total, allocation) => total + allocation.plannedMinutes, 0);
      const allocatedMinutes = allocations.reduce((total, allocation) => total + allocation.plannedMinutes, 0) - onHoldAllocatedMinutes;

      return {
        userId: user.id,
        userDisplayName: user.displayName,
        userEmail: user.email,
        userAvatarUrl: user.avatarUrl ?? undefined,
        departmentCode: user.departmentCode ?? undefined,
        displayRole: profile?.displayRole ?? undefined,
        skills: profile?.skills ?? [],
        availableMinutes,
        allocatedMinutes,
        onHoldAllocatedMinutes,
        capacityKnown: Boolean(matchingPeriod ?? profile),
        remainingMinutes: Math.max(availableMinutes - allocatedMinutes, 0),
        utilizationPercent: availableMinutes > 0 ? round((allocatedMinutes / availableMinutes) * 100, 2) : 0,
        overbooked: allocatedMinutes > availableMinutes,
        billableTargetPercent: profile?.billableTargetPercent ?? 70,
        allocations
      };
    });

    return {
      data,
      meta: {
        generatedAt: new Date().toISOString(),
        periodEnd: periodEnd.toISOString(),
        periodStart: periodStart.toISOString(),
        principal: principal.displayName,
        rowScope: "workspace",
        source: "postgresql"
      }
    };
  }

  async createAllocation(body: CreateResourceAllocationInput, principal: PrincipalContext) {
    // Booking people (and approving an overbooking) is an Admin decision.
    if (principal.subjectType !== "internal_user" || !principal.roleCodes.some((role) => (ADMIN_ROLE_CODES as readonly string[]).includes(role))) {
      throw new ForbiddenException("Chỉ Admin mới được phân bổ nhân sự.");
    }
    const accountId = nonEmptyString(body.accountId, "accountId");
    const userId = nonEmptyString(body.userId, "userId");
    const role = nonEmptyString(body.role, "role");
    const startAt = parseRequiredDate(body.startAt, "startAt");
    const endAt = parseRequiredDate(body.endAt, "endAt");

    if (endAt <= startAt) {
      throw new BadRequestException("endAt must be after startAt");
    }

    const projectId = optionalString(body.projectId);
    const opportunityId = optionalString(body.opportunityId);
    await this.ensureAllocationTargets({
      accountId,
      projectId,
      opportunityId,
      userId,
      workspaceId: principal.workspaceId,
      tenantKey: principal.tenantKey
    });

    const allocation = await this.prisma.resourceAllocation.create({
      data: {
        workspaceId: principal.workspaceId,
        accountId,
        projectId,
        opportunityId,
        userId,
        role,
        skill: optionalString(body.skill),
        status: toAllocationStatus(body.status ?? "requested"),
        allocationPercent: optionalInteger(body.allocationPercent) ?? 100,
        plannedMinutes: optionalInteger(body.plannedMinutes) ?? 0,
        startAt,
        endAt,
        overbookApproved: Boolean(body.overbookApproved),
        note: optionalString(body.note),
        createdByUserId: principal.subjectId
      },
      include: {
        account: true,
        project: true,
        opportunity: true,
        user: true
      }
    });

    return mapAllocation(allocation);
  }

  private async ensureAllocationTargets(input: {
    accountId: string;
    projectId?: string;
    opportunityId?: string;
    userId: string;
    workspaceId: string;
    tenantKey: string;
  }) {
    const [account, user, project, opportunity] = await Promise.all([
      this.prisma.account.findFirst({
        where: { id: input.accountId, workspaceId: input.workspaceId },
        select: { id: true }
      }),
      this.prisma.user.findFirst({
        where: {
          id: input.userId,
          status: "ACTIVE",
          subjectType: "INTERNAL_USER",
          roleBindings: {
            some: {
              workspaceId: input.workspaceId,
              tenantKey: input.tenantKey,
              endsAt: null
            }
          }
        },
        select: { id: true }
      }),
      input.projectId
        ? this.prisma.project.findFirst({
            where: { id: input.projectId, workspaceId: input.workspaceId, accountId: input.accountId },
            select: { id: true }
          })
        : Promise.resolve(undefined),
      input.opportunityId
        ? this.prisma.opportunity.findFirst({
            where: { id: input.opportunityId, workspaceId: input.workspaceId, accountId: input.accountId },
            select: { id: true }
          })
        : Promise.resolve(undefined)
    ]);

    if (!account) throw new NotFoundException("Allocation account not found in workspace");
    if (!user) throw new NotFoundException("Allocation user not found in workspace");
    if (input.projectId && !project) throw new NotFoundException("Allocation project not found for account/workspace");
    if (input.opportunityId && !opportunity) throw new NotFoundException("Allocation opportunity not found for account/workspace");
  }

  /**
   * For the G7 approval (mục 7 điểm 6 of the P&L tab spec): hours of the project "Chờ xử lý" because of a missing or
   * wrong classification or line item. `blockingMinutes === 0` means G7 may be approved; hours that only wait for a
   * cost rate are reported in `waitingCostRateMinutes` and never block.
   */
  pendingHoursBlockingG7(workspaceId: string, projectId: string): Promise<PnlG7Blockers> {
    return (this.pnl ?? new PnlService(this.prisma)).pendingHoursBlockingG7(workspaceId, projectId);
  }

  async isPeriodLocked(workspaceId: string, periodKey: string) {
    const locked = await this.prisma.pnlPeriod.findFirst({ where: { workspaceId, projectId: null, periodKey, status: "LOCKED" }, select: { id: true } });
    return Boolean(locked);
  }

  /** PL-23: a locked period is immutable — no staff cost of the month and no cost line dated in it can change. */
  async assertPeriodOpen(workspaceId: string, periodKey: string) {
    if (await this.isPeriodLocked(workspaceId, periodKey)) throw new ConflictException(`Kỳ ${periodKey} đã khóa; mở lại kỳ trước khi sửa chi phí.`);
  }
}

function mapAllocation(allocation: {
  id: string;
  accountId: string;
  account?: { name: string } | null;
  projectId?: string | null;
  project?: { name: string } | null;
  opportunityId?: string | null;
  userId: string;
  user?: { displayName: string } | null;
  role: string;
  skill?: string | null;
  status: string;
  allocationPercent: number;
  plannedMinutes: number;
  startAt: Date;
  endAt: Date;
  overbookApproved: boolean;
  approvedByUserId?: string | null;
  note?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ResourceAllocationSummary {
  return {
    id: allocation.id,
    accountId: allocation.accountId,
    accountName: allocation.account?.name,
    projectId: allocation.projectId ?? undefined,
    projectName: allocation.project?.name,
    opportunityId: allocation.opportunityId ?? undefined,
    userId: allocation.userId,
    userDisplayName: allocation.user?.displayName,
    role: allocation.role,
    skill: allocation.skill ?? undefined,
    status: toContractStatus(allocation.status),
    allocationPercent: allocation.allocationPercent,
    plannedMinutes: allocation.plannedMinutes,
    startAt: allocation.startAt.toISOString(),
    endAt: allocation.endAt.toISOString(),
    overbookApproved: allocation.overbookApproved,
    approvedByUserId: allocation.approvedByUserId ?? undefined,
    note: allocation.note ?? undefined,
    createdAt: allocation.createdAt.toISOString(),
    updatedAt: allocation.updatedAt.toISOString()
  };
}

function toAllocationStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  if (!["REQUESTED", "TENTATIVE", "RESERVED", "CONFIRMED", "RELEASED", "CANCELLED"].includes(normalized)) {
    throw new BadRequestException("Unsupported allocation status");
  }
  return normalized as never;
}

function toContractStatus(status: string) {
  return status.toLowerCase() as ResourceAllocationSummary["status"];
}

function optionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function nonEmptyString(value: unknown, field: string) {
  const trimmed = optionalString(value);
  if (!trimmed) {
    throw new BadRequestException(`${field} is required`);
  }
  return trimmed;
}

function optionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException("Expected integer value");
  }
  return parsed;
}

function parseRequiredDate(value: unknown, field: string) {
  const parsed = parseDate(value);
  if (!parsed) {
    throw new BadRequestException(`${field} is required`);
  }
  return parsed;
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(next, delta);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}



function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
