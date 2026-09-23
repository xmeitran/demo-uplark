import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  CreateWorkspaceDayOffInput,
  PrincipalContext,
  UpdateWorkspaceDayOffInput,
  WorkspaceDayOffCategory
} from "@b2b-crm/contracts";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { dateOnlyToUtcDate, lockWorkspaceDayOffDates, tagTimeEntriesWithDayOffDates } from "./day-off-time";

const DAY_MS = 24 * 60 * 60 * 1000;
const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;
const MAX_DAY_OFF_RANGE_DAYS = 90;
const MAX_LIST_RANGE_DAYS = 370;
const DAY_OFF_CATEGORIES = new Set<WorkspaceDayOffCategory>(["national_holiday", "company_day_off", "other"]);

type DayOffRecord = {
  id: string;
  date: Date;
  name: string;
  category: string;
  note: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function parseDateKey(value: unknown, field: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD`);
  }
  const date = dateOnlyToUtcDate(value);
  if (date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} is not a valid date`);
  return { key: value, date };
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function localDateKey(at: Date) {
  return new Date(at.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
}

function dateKeysBetween(start: string, end: string) {
  const first = dateOnlyToUtcDate(start).getTime();
  const last = dateOnlyToUtcDate(end).getTime();
  const days = Math.floor((last - first) / DAY_MS) + 1;
  if (days < 1) throw new BadRequestException("endDate must be on or after startDate");
  if (days > MAX_DAY_OFF_RANGE_DAYS) throw new BadRequestException(`A day-off range cannot exceed ${MAX_DAY_OFF_RANGE_DAYS} days`);
  return Array.from({ length: days }, (_, index) => new Date(first + index * DAY_MS).toISOString().slice(0, 10));
}

function validateName(value: unknown, field = "name") {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 120) {
    throw new BadRequestException(`${field} is required and must be 120 characters or fewer`);
  }
  return value.trim();
}

function validateCategory(value: unknown): WorkspaceDayOffCategory {
  if (value === undefined || value === null || value === "") return "national_holiday";
  if (typeof value !== "string" || !DAY_OFF_CATEGORIES.has(value as WorkspaceDayOffCategory)) {
    throw new BadRequestException("category must be national_holiday, company_day_off or other");
  }
  return value as WorkspaceDayOffCategory;
}

function validateNote(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 500) throw new BadRequestException("note must be 500 characters or fewer");
  return value.trim() || null;
}

function mapDayOff(record: DayOffRecord) {
  return {
    id: record.id,
    date: formatDateKey(record.date),
    name: record.name,
    category: validateCategory(record.category),
    note: record.note ?? undefined,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function assertCanView(principal: PrincipalContext) {
  if (principal.subjectType !== "internal_user") throw new ForbiddenException("Workspace calendar settings are internal");
}

function assertCanManage(principal: PrincipalContext) {
  assertCanView(principal);
  if (!principal.roleCodes.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN")) {
    throw new ForbiddenException("Founder/GM or Workspace Admin role is required to manage workspace days off");
  }
}

@Injectable()
export class WorkspaceCalendarService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: Record<string, unknown>, principal: PrincipalContext) {
    assertCanView(principal);
    const now = new Date(Date.now() + HCM_OFFSET_MS);
    const defaultYear = now.getUTCFullYear();
    let startKey: string;
    let endKey: string;

    if (query.startDate !== undefined || query.endDate !== undefined) {
      startKey = parseDateKey(query.startDate, "startDate").key;
      endKey = parseDateKey(query.endDate, "endDate").key;
    } else if (query.startAt !== undefined || query.endAt !== undefined) {
      const startAt = new Date(String(query.startAt ?? ""));
      const endAt = new Date(String(query.endAt ?? ""));
      if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
        throw new BadRequestException("startAt and endAt must form a valid date range");
      }
      startKey = localDateKey(startAt);
      endKey = localDateKey(new Date(endAt.getTime() - 1));
    } else {
      const year = Number(query.year ?? defaultYear);
      if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new BadRequestException("year must be between 1900 and 2200");
      startKey = `${year}-01-01`;
      endKey = `${year}-12-31`;
    }

    const rangeDays = Math.floor((dateOnlyToUtcDate(endKey).getTime() - dateOnlyToUtcDate(startKey).getTime()) / DAY_MS) + 1;
    if (rangeDays < 1 || rangeDays > MAX_LIST_RANGE_DAYS) throw new BadRequestException(`Date range must be between 1 and ${MAX_LIST_RANGE_DAYS} days`);
    const records = await this.prisma.workspaceDayOff.findMany({
      where: { workspaceId: principal.workspaceId, date: { gte: dateOnlyToUtcDate(startKey), lte: dateOnlyToUtcDate(endKey) } },
      orderBy: [{ date: "asc" }, { name: "asc" }],
      take: MAX_LIST_RANGE_DAYS
    });

    return {
      data: records.map(mapDayOff),
      meta: {
        total: records.length,
        year: Number(startKey.slice(0, 4)),
        timeZone: "Asia/Ho_Chi_Minh" as const,
        canManage: principal.roleCodes.some((role) => role === "FOUNDER_GM" || role === "WORKSPACE_ADMIN")
      }
    };
  }

  async create(input: CreateWorkspaceDayOffInput, principal: PrincipalContext) {
    assertCanManage(principal);
    const start = parseDateKey(input.startDate, "startDate");
    const end = parseDateKey(input.endDate, "endDate");
    const dateKeys = dateKeysBetween(start.key, end.key);
    const name = validateName(input.name);
    const category = validateCategory(input.category);
    const note = validateNote(input.note);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockWorkspaceDayOffDates(tx, principal.workspaceId, dateKeys);
        const dates = dateKeys.map(dateOnlyToUtcDate);
        const conflicts = await tx.workspaceDayOff.findMany({
          where: { workspaceId: principal.workspaceId, date: { in: dates } },
          select: { date: true, name: true },
          orderBy: { date: "asc" }
        });
        if (conflicts.length) {
          throw new ConflictException({
            message: "Một hoặc nhiều ngày đã có cấu hình ngày nghỉ. Hãy kiểm tra danh sách hoặc mở khóa ngày cũ trước.",
            dates: conflicts.map((item) => ({ date: formatDateKey(item.date), name: item.name }))
          });
        }

        const ids = dateKeys.map(() => `wdo_${randomUUID()}`);
        const rows = dateKeys.map((dateKey, index) => ({
          id: ids[index],
          workspaceId: principal.workspaceId,
          date: dateOnlyToUtcDate(dateKey),
          name,
          category,
          note,
          isActive: true,
          createdByUserId: principal.subjectId
        }));
        await tx.workspaceDayOff.createMany({ data: rows });
        await tagTimeEntriesWithDayOffDates(tx, principal.workspaceId, ids);
        await tx.auditEvent.create({
          data: {
            workspaceId: principal.workspaceId,
            actorUserId: principal.subjectId,
            action: "workspace.day_off_created",
            resource: "workspace_day_off",
            resourceId: ids[0],
            before: Prisma.JsonNull,
            after: { ids, dates: dateKeys, name, category, note },
            requestId: randomUUID()
          }
        });
        const records = await tx.workspaceDayOff.findMany({
          where: { id: { in: ids }, workspaceId: principal.workspaceId },
          orderBy: { date: "asc" }
        });
        return { data: records.map(mapDayOff), meta: { created: records.length, billingExempt: true } };
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ConflictException("One of the selected dates was added by another user. Refresh and try again.");
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateWorkspaceDayOffInput, principal: PrincipalContext) {
    assertCanManage(principal);
    if (!input.expectedUpdatedAt || !Number.isFinite(new Date(input.expectedUpdatedAt).getTime())) {
      throw new BadRequestException("expectedUpdatedAt is required");
    }
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    const existing = await this.prisma.workspaceDayOff.findFirst({ where: { id, workspaceId: principal.workspaceId } });
    if (!existing) throw new NotFoundException("Workspace day off not found");
    const nextDate = input.date !== undefined ? parseDateKey(input.date, "date") : { key: formatDateKey(existing.date), date: existing.date };
    const name = input.name !== undefined ? validateName(input.name) : existing.name;
    const category = input.category !== undefined ? validateCategory(input.category) : validateCategory(existing.category);
    const note = input.note !== undefined ? validateNote(input.note) : existing.note;
    const isActive = input.isActive !== undefined ? input.isActive : existing.isActive;
    if (typeof isActive !== "boolean") throw new BadRequestException("isActive must be boolean");

    return this.prisma.$transaction(async (tx) => {
      await lockWorkspaceDayOffDates(tx, principal.workspaceId, [formatDateKey(existing.date), nextDate.key]);
      const current = await tx.workspaceDayOff.findFirst({ where: { id, workspaceId: principal.workspaceId } });
      if (!current) throw new NotFoundException("Workspace day off not found");
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException("This day-off record changed. Refresh it before saving again.");
      }
      const duplicate = await tx.workspaceDayOff.findFirst({
        where: { workspaceId: principal.workspaceId, date: nextDate.date, id: { not: id } },
        select: { id: true, name: true }
      });
      if (duplicate) throw new ConflictException(`Ngày ${nextDate.key} đã được cấu hình là “${duplicate.name}”.`);

      const updated = await tx.workspaceDayOff.update({
        where: { id },
        data: { date: nextDate.date, name, category, note, isActive }
      });
      if (isActive) await tagTimeEntriesWithDayOffDates(tx, principal.workspaceId, [id]);
      await tx.auditEvent.create({
        data: {
          workspaceId: principal.workspaceId,
          actorUserId: principal.subjectId,
          action: "workspace.day_off_updated",
          resource: "workspace_day_off",
          resourceId: id,
          before: { date: formatDateKey(current.date), name: current.name, category: current.category, note: current.note, isActive: current.isActive },
          after: { date: nextDate.key, name, category, note, isActive },
          requestId: randomUUID()
        }
      });
      return { data: mapDayOff(updated), meta: { billingExempt: updated.isActive } };
    });
  }
}
