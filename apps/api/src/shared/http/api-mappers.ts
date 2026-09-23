import { toIso, toMoneyNumber } from "./request-context";

export function toApiEnum<T extends string>(value?: string | null) {
  return (value ? value.toLowerCase() : undefined) as T | undefined;
}

export function toPrismaEnum(value: string) {
  return value.trim().toUpperCase();
}

export function optionalStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

export function money(value: unknown) {
  return toMoneyNumber(value) ?? 0;
}

export { toIso };
