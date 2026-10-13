import { BadRequestException } from "@nestjs/common";

/** A multi-value filter sent as one comma-joined query param (a repeated key is accepted too). Empty = no filter. */
export function csvList(value: unknown, max = 50): string[] {
  const parts = (Array.isArray(value) ? value : [value]).flatMap((item) => (typeof item === "string" ? item.split(",") : []));
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].slice(0, max);
}

/** Prisma `in` filter for a csv param, or nothing when the param is empty. */
export function csvIn(value: unknown, max = 50): { in: string[] } | undefined {
  const list = csvList(value, max);
  return list.length ? { in: list } : undefined;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function vietnamDayStart(value: unknown, fieldName: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = typeof value === "string" && DAY.test(value) ? new Date(`${value}T00:00:00+07:00`) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${fieldName} must be a YYYY-MM-DD day`);
  return date;
}

/** Inclusive `from`/`to` Asia/Ho_Chi_Minh days as a Prisma DateTime filter; nothing when both are empty. */
export function vietnamDayRange(from: unknown, to: unknown): { gte?: Date; lt?: Date } | undefined {
  const gte = vietnamDayStart(from, "from");
  const toStart = vietnamDayStart(to, "to");
  if (!gte && !toStart) return undefined;
  return { ...(gte ? { gte } : {}), ...(toStart ? { lt: new Date(toStart.getTime() + 24 * 60 * 60 * 1000) } : {}) };
}
