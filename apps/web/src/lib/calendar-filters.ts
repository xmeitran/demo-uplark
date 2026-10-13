import { matchesAny } from "@/components/filters/filter-values";

export type CalendarFilterEvent = {
  projectId?: string;
  projectName?: string;
  userId: string;
  userDisplayName?: string;
  /** "planned" (kế hoạch) or "actual" (giờ thực tế). */
  kind?: string;
  status?: string;
};

export type CalendarFilterUser = {
  id: string;
  name: string;
  role?: string;
  avatarUrl?: string;
  initials?: string;
  color?: string;
};

export type CalendarFilterOption = {
  value: string;
  label: string;
  subtext?: string;
  avatarUrl?: string;
  initials?: string;
  color?: string;
};

export type CalendarFilters = {
  projectIds: string[];
  memberIds: string[];
  kinds?: string[];
  /** Plan statuses; logged hours carry no status, so any status selection leaves them out. */
  statuses?: string[];
};

const vietnameseLabelCollator = new Intl.Collator("vi-VN", {
  sensitivity: "base",
  numeric: true
});

function sortOptions(options: CalendarFilterOption[]) {
  return options.sort((left, right) => vietnameseLabelCollator.compare(left.label, right.label));
}

export function buildCalendarProjectOptions(events: CalendarFilterEvent[]): CalendarFilterOption[] {
  const projects = new Map<string, CalendarFilterOption>();

  for (const event of events) {
    const projectId = event.projectId?.trim();
    const projectName = event.projectName?.trim();
    if (!projectId || !projectName || projects.has(projectId)) continue;
    projects.set(projectId, { value: projectId, label: projectName });
  }

  return sortOptions([...projects.values()]);
}

export function buildCalendarMemberOptions(
  events: CalendarFilterEvent[],
  workspaceUsers: CalendarFilterUser[]
): CalendarFilterOption[] {
  const directory = new Map(workspaceUsers.map((user) => [user.id, user]));
  const members = new Map<string, CalendarFilterOption>();

  for (const event of events) {
    const userId = event.userId.trim();
    if (!userId || members.has(userId)) continue;
    const workspaceUser = directory.get(userId);
    members.set(userId, {
      value: userId,
      label: workspaceUser?.name?.trim() || event.userDisplayName?.trim() || userId,
      subtext: workspaceUser?.role,
      avatarUrl: workspaceUser?.avatarUrl,
      initials: workspaceUser?.initials,
      color: workspaceUser?.color
    });
  }

  return sortOptions([...members.values()]);
}

export function filterCalendarEvents<T extends CalendarFilterEvent>(
  events: T[],
  filters: CalendarFilters
): T[] {
  const kinds = filters.kinds ?? [];
  const statuses = filters.statuses ?? [];
  if (filters.projectIds.length + filters.memberIds.length + kinds.length + statuses.length === 0) return events;

  return events.filter((event) =>
    matchesAny(filters.projectIds, event.projectId)
    && matchesAny(filters.memberIds, event.userId)
    && matchesAny(kinds, event.kind)
    && matchesAny(statuses, event.kind === "actual" ? null : event.status));
}

/** Statuses of the plans in view, in first-seen order, for the "Trạng thái" filter. */
export function buildCalendarStatusOptions(events: CalendarFilterEvent[], labelFor: (status: string) => string): CalendarFilterOption[] {
  const statuses = new Set(events.filter((event) => event.kind !== "actual" && event.status).map((event) => event.status!));
  return [...statuses].map((status) => ({ value: status, label: labelFor(status) }));
}

export function pruneCalendarFilterIds(
  selectedIds: string[],
  options: CalendarFilterOption[]
): string[] {
  if (selectedIds.length === 0) return selectedIds;
  const validIds = new Set(options.map((option) => option.value));
  const seen = new Set<string>();
  return selectedIds.filter((selectedId) => {
    if (!validIds.has(selectedId) || seen.has(selectedId)) return false;
    seen.add(selectedId);
    return true;
  });
}
