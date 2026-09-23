import { BadRequestException } from "@nestjs/common";
import type { ResourceListPaginationMeta } from "@b2b-crm/contracts";

export interface AuthHeaderContext {
  authorization?: string;
  principalFallback?: string;
}

export interface PaginationInput {
  limit?: string | number;
  offset?: string | number;
}

export interface NormalizedPagination {
  limit: number;
  offset: number;
}

export function bearerToken(authorization?: string) {
  const [scheme, token] = authorization?.split(" ") ?? [];
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token.trim();
}

export function nonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${fieldName} is required`);
  }

  return value.trim();
}

export function optionalString(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${fieldName} must be a string`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function optionalNumber(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return value === null ? null : undefined;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new BadRequestException(`${fieldName} must be a number`);
  }

  return normalized;
}

export function optionalInteger(value: unknown, fieldName: string) {
  const normalized = optionalNumber(value, fieldName);
  if (normalized === undefined || normalized === null) {
    return normalized;
  }
  if (!Number.isInteger(normalized)) {
    throw new BadRequestException(`${fieldName} must be an integer`);
  }

  return normalized;
}

export function optionalBoolean(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  throw new BadRequestException(`${fieldName} must be a boolean`);
}

export function optionalDate(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") {
    return value === null ? null : undefined;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`${fieldName} must be an ISO date string`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid ISO date string`);
  }

  return parsed;
}

export function toIso(value?: Date | string | null) {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toMoneyNumber(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const candidate = typeof value === "object" && "toNumber" in value ? (value as { toNumber: () => number }).toNumber() : Number(value);
  return Number.isFinite(candidate) ? candidate : undefined;
}

export function normalizePagination(input: PaginationInput): NormalizedPagination {
  const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 100);
  const offset = Math.max(Number(input.offset ?? 0), 0);

  if (!Number.isInteger(limit) || !Number.isInteger(offset)) {
    throw new BadRequestException("limit and offset must be integers");
  }

  return { limit, offset };
}

export function buildPaginationMeta(input: NormalizedPagination & { total: number; returned: number }): ResourceListPaginationMeta {
  return {
    limit: input.limit,
    offset: input.offset,
    returned: input.returned,
    total: input.total,
    hasNextPage: input.offset + input.returned < input.total,
    hasPreviousPage: input.offset > 0
  };
}

export function tenantKey() {
  return process.env.FOUNDATION_TENANT_KEY ?? process.env.CRM_TENANT_KEY ?? "prod";
}

export function workspaceKey() {
  return process.env.FOUNDATION_WORKSPACE_KEY ?? process.env.CRM_WORKSPACE_KEY ?? "default";
}

export function workspaceName() {
  return process.env.FOUNDATION_WORKSPACE_NAME ?? process.env.CRM_WORKSPACE_NAME ?? "Default Workspace";
}
