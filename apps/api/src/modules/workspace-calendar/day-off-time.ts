import { Prisma } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;

export function dateOnlyToUtcDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function getLocalDateKeysForTimeRange(startAt: Date | null | undefined, endAt: Date | null | undefined, workDate: Date) {
  if (!startAt || !endAt) {
    return [new Date(workDate.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10)];
  }

  const firstKey = new Date(startAt.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
  const lastIncludedAt = new Date(Math.max(startAt.getTime(), endAt.getTime() - 1));
  const lastKey = new Date(lastIncludedAt.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
  const [year, month, day] = firstKey.split("-").map(Number);
  const [lastYear, lastMonth, lastDay] = lastKey.split("-").map(Number);
  const dateKeys: string[] = [];
  for (let stamp = Date.UTC(year, month - 1, day), lastStamp = Date.UTC(lastYear, lastMonth - 1, lastDay); stamp <= lastStamp; stamp += DAY_MS) {
    dateKeys.push(new Date(stamp).toISOString().slice(0, 10));
  }
  return dateKeys;
}

export async function lockWorkspaceDayOffDates(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  dateKeys: readonly string[]
) {
  for (const dateKey of [...new Set(dateKeys)].sort()) {
    const lockScope = `workspace-day-off:${workspaceId}:${dateKey}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockScope}, 0))::text`;
  }
}

export async function tagTimeEntriesWithDayOffDates(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  dayOffIds: readonly string[]
) {
  if (dayOffIds.length === 0) return;
  await tx.$executeRaw(Prisma.sql`
    UPDATE "TaskTimeEntry" AS te
    SET "dayOffId" = dayOff."id"
    FROM "WorkspaceDayOff" AS dayOff
    WHERE dayOff."workspaceId" = ${workspaceId}
      AND dayOff."id" IN (${Prisma.join(dayOffIds)})
      AND te."workspaceId" = dayOff."workspaceId"
      AND te."dayOffId" IS NULL
      AND (
        (
          te."startAt" IS NOT NULL
          AND te."startAt" < (dayOff."date"::timestamp - INTERVAL '7 hours' + INTERVAL '1 day')
          AND COALESCE(te."endAt", te."startAt" + te."minutes" * INTERVAL '1 minute')
            > (dayOff."date"::timestamp - INTERVAL '7 hours')
        )
        OR (
          te."startAt" IS NULL
          AND te."workDate" >= (dayOff."date"::timestamp - INTERVAL '7 hours')
          AND te."workDate" < (dayOff."date"::timestamp - INTERVAL '7 hours' + INTERVAL '1 day')
        )
      )
  `);
}
