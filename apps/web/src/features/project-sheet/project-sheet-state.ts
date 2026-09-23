import type { Project } from "../../../app/projects/data";

export const PROJECT_SHEET_COLUMN_IDS = [
  "project",
  "status",
  "priority",
  "progress",
  "budget",
  "dueDate",
  "team"
] as const;

export type ProjectSheetColumnId = (typeof PROJECT_SHEET_COLUMN_IDS)[number];

export type ProjectSheetPreferences = {
  hiddenColumns: ProjectSheetColumnId[];
  pinnedColumn: ProjectSheetColumnId | null;
};

export const DEFAULT_PROJECT_SHEET_PREFERENCES: ProjectSheetPreferences = {
  hiddenColumns: [],
  pinnedColumn: "project"
};

export function normalizeProjectSheetPreferences(value: unknown): ProjectSheetPreferences {
  if (!value || typeof value !== "object") return DEFAULT_PROJECT_SHEET_PREFERENCES;

  const candidate = value as Partial<ProjectSheetPreferences>;
  const hiddenColumns = Array.isArray(candidate.hiddenColumns)
    ? candidate.hiddenColumns.filter((column): column is ProjectSheetColumnId =>
        PROJECT_SHEET_COLUMN_IDS.includes(column as ProjectSheetColumnId)
      )
    : [];
  const pinnedColumn =
    candidate.pinnedColumn && PROJECT_SHEET_COLUMN_IDS.includes(candidate.pinnedColumn)
      ? candidate.pinnedColumn
      : null;

  return {
    hiddenColumns: Array.from(new Set(hiddenColumns)),
    pinnedColumn: hiddenColumns.includes(pinnedColumn as ProjectSheetColumnId) ? null : pinnedColumn
  };
}

export function toggleProjectSheetSelection(current: ReadonlySet<string>, projectId: string) {
  const next = new Set(current);
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  return next;
}

export function projectsToTsv(projects: Project[]) {
  const header = ["Project", "Client", "Status", "Priority", "Progress", "Budget", "Spent", "Due date"];
  const sanitize = (value: unknown) => String(value ?? "").replaceAll("\t", " ").replaceAll(/\r?\n/g, " ");
  const rows = projects.map((project) => [
    project.name,
    project.client,
    project.status,
    project.priority,
    `${project.progress}%`,
    project.budget,
    project.spent,
    project.dueDate
  ]);
  return [header, ...rows].map((row) => row.map(sanitize).join("\t")).join("\n");
}
