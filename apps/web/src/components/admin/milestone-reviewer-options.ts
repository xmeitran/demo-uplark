import type { WorkspaceReminderRecipientOption } from "@b2b-crm/contracts";
import type { TaskSelectOption } from "@/components/crm-workspace/tasks-workbench";
import { businessRoleFromMember, systemRoleFromCodes, systemRoleLabel } from "@/lib/people-roles";

export const WORKSPACE_ADMIN_REVIEWER_VALUE = "workspace_admin";

function formatRole(user: WorkspaceReminderRecipientOption) {
  const systemRole = systemRoleFromCodes(user.roleCodes);
  if (user.roleCodes?.some((roleCode) => roleCode === "FOUNDER_GM" || roleCode === "WORKSPACE_ADMIN")) {
    return systemRoleLabel(systemRole);
  }
  return businessRoleFromMember(user);
}

export function milestoneReviewerOptions(
  users: WorkspaceReminderRecipientOption[],
  selectedReviewerId?: string
): TaskSelectOption[] {
  const options: TaskSelectOption[] = [
    {
      value: WORKSPACE_ADMIN_REVIEWER_VALUE,
      label: "Admin workspace",
      subtext: "Workspace Admin · Quyền duyệt milestone",
      icon: "person",
      color: "#2563eb"
    },
    ...users.map((user) => ({
      value: user.id,
      label: user.displayName,
      subtext: `${formatRole(user)}${user.email ? ` · ${user.email}` : ""}`,
      avatarUrl: user.avatarUrl,
      initials: initialsFor(user.displayName),
      color: colorForId(user.id)
    }))
  ];

  if (selectedReviewerId && !users.some((user) => user.id === selectedReviewerId)) {
    options.push({
      value: selectedReviewerId,
      label: "Người duyệt hiện tại",
      subtext: "Tài khoản không còn active · cần chọn lại",
      icon: "alert-circle",
      color: "#d97706"
    });
  }

  return options;
}

function initialsFor(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "U";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] ?? ""}${words[words.length - 1][0] ?? ""}`.toUpperCase();
}

function colorForId(id: string) {
  const colors = ["#2563eb", "#059669", "#7c3aed", "#db2777", "#d97706", "#dc2626", "#0891b2", "#64748b"];
  const hash = Array.from(id).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}
