/** Calendar helpers for the Timesheet screens. Dates are `YYYY-MM-DD` keys in Asia/Ho_Chi_Minh; no time-zone maths is needed once a value is a key. */

export function toISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${date.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function eachDate(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cursor = parseISODate(startISO);
  const end = parseISODate(endISO);
  while (cursor.getTime() <= end.getTime()) {
    out.push(toISODate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function isWeekend(iso: string): boolean {
  const day = parseISODate(iso).getUTCDay();
  return day === 0 || day === 6;
}

export function isHoliday(iso: string, holidays: readonly string[]): boolean {
  return holidays.includes(iso);
}

/** A working day = Mon–Fri that is not a public holiday (spec 35 §5b.1). */
export function isWorkingDay(iso: string, holidays: readonly string[]): boolean {
  return !isWeekend(iso) && !isHoliday(iso, holidays);
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function monthBounds(month: string): { start: string; end: string } {
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1));
  const end = new Date(Date.UTC(year, mon, 0));
  return { start: toISODate(start), end: toISODate(end) };
}
