import { normalizeBusinessRole as normalizeContractBusinessRole, type BusinessRole, type WorkspaceSystemRole } from "@b2b-crm/contracts";

export { BUSINESS_ROLE_OPTIONS } from "@b2b-crm/contracts";
export type { BusinessRole } from "@b2b-crm/contracts";

export const SYSTEM_ROLE_OPTIONS: Array<{ value: WorkspaceSystemRole; label: string }> = [
  { value: "FOUNDER_GM", label: "Founder/GM" },
  { value: "WORKSPACE_ADMIN", label: "Workspace Admin" },
  { value: "WORKSPACE_USER", label: "Workspace User" },
];

export const SYSTEM_ROLE_LABELS: Record<WorkspaceSystemRole, string> = Object.fromEntries(
  SYSTEM_ROLE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<WorkspaceSystemRole, string>;

const SYSTEM_ROLE_CODES = new Set<WorkspaceSystemRole>(["FOUNDER_GM", "WORKSPACE_ADMIN", "WORKSPACE_USER"]);

export function businessRoleFromMember(member: {
  resourceDisplayRole?: string | null;
  departmentCode?: string | null;
  roleCodes?: readonly string[];
}) {
  const fallbackRoleCode = member.roleCodes?.find((roleCode) => !SYSTEM_ROLE_CODES.has(roleCode as WorkspaceSystemRole));
  return normalizeBusinessRole(member.resourceDisplayRole ?? member.departmentCode ?? fallbackRoleCode);
}

export function systemRoleFromCodes(roleCodes?: readonly string[]): WorkspaceSystemRole {
  if (roleCodes?.includes("FOUNDER_GM")) return "FOUNDER_GM";
  if (roleCodes?.includes("WORKSPACE_ADMIN")) return "WORKSPACE_ADMIN";
  return "WORKSPACE_USER";
}

export function normalizeBusinessRole(value?: string | null): BusinessRole {
  return normalizeContractBusinessRole(value);
}

export function systemRoleLabel(value?: WorkspaceSystemRole | null) {
  return value ? SYSTEM_ROLE_LABELS[value] : SYSTEM_ROLE_LABELS.WORKSPACE_USER;
}
