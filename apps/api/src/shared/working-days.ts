/**
 * Working-day arithmetic shared by every SLA in the rules (V-14, V-15, V-20, V-26, V-27).
 * A working day is Monday–Friday in Vietnam time that is not an active WorkspaceDayOff.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const HCM_OFFSET_MS = 7 * 60 * 60 * 1000;

/** YYYY-MM-DD of an instant in Vietnam time. */
export function localDateKey(at: Date): string {
  return new Date(at.getTime() + HCM_OFFSET_MS).toISOString().slice(0, 10);
}

function shiftDateKey(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function isWorkingDay(dateKey: string, dayOffKeys: ReadonlySet<string> = new Set()): boolean {
  const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !dayOffKeys.has(dateKey);
}

/** Deadline of an SLA of `days` working days counted from the day after `start`: the end of that day in Vietnam time. */
export function addWorkingDays(start: Date, days: number, dayOffKeys: ReadonlySet<string> = new Set()): Date {
  let dateKey = localDateKey(start);
  for (let remaining = Math.max(0, Math.floor(days)); remaining > 0; ) {
    dateKey = shiftDateKey(dateKey, 1);
    if (isWorkingDay(dateKey, dayOffKeys)) remaining -= 1;
  }
  return new Date(Date.parse(`${dateKey}T23:59:59.999Z`) - HCM_OFFSET_MS);
}

/** Whole working days elapsed after `from`'s date up to and including `to`'s date; 0 when `to` is not later. */
export function workingDaysBetween(from: Date, to: Date, dayOffKeys: ReadonlySet<string> = new Set()): number {
  const lastKey = localDateKey(to);
  let count = 0;
  for (let dateKey = shiftDateKey(localDateKey(from), 1); dateKey <= lastKey; dateKey = shiftDateKey(dateKey, 1)) {
    if (isWorkingDay(dateKey, dayOffKeys)) count += 1;
  }
  return count;
}

/** Active day-off dates of the workspace between two instants, as date keys. */
export async function loadDayOffKeys(client: any, workspaceId: string, from: Date, to: Date): Promise<Set<string>> {
  if (typeof client?.workspaceDayOff?.findMany !== "function") return new Set();
  const rows = await client.workspaceDayOff.findMany({
    where: { workspaceId, isActive: true, date: { gte: new Date(`${localDateKey(from)}T00:00:00.000Z`), lte: new Date(`${localDateKey(to)}T00:00:00.000Z`) } },
    select: { date: true }
  });
  return new Set(rows.map((row: { date: Date }) => new Date(row.date).toISOString().slice(0, 10)));
}

/** addWorkingDays against the workspace calendar. */
export async function addWorkspaceWorkingDays(client: any, workspaceId: string, start: Date, days: number): Promise<Date> {
  // Enough calendar room for the weekends plus a long holiday run inside the window.
  const horizon = new Date(start.getTime() + (days * 2 + 21) * DAY_MS);
  return addWorkingDays(start, days, await loadDayOffKeys(client, workspaceId, start, horizon));
}
