export type ProjectListView = "grid" | "sheet" | "timeline";
export type ProjectListSortKey = "name" | "status" | "progress" | "dueDate" | "priority";
export type ProjectListSortDir = "asc" | "desc";

export type ProjectListUrlState = {
  query: string;
  /** Multi-select filters; empty = all. In the URL they are comma-joined (`status=A,B`). */
  statusFilter: string[];
  categoryFilter: string[];
  clientFilter: string[];
  ownerFilter: string[];
  /** Project period filter, inclusive Vietnam days "YYYY-MM-DD"; "" = open. */
  from: string;
  to: string;
  page: number;
  view: ProjectListView;
  sortKey: ProjectListSortKey;
  sortDir: ProjectListSortDir;
};

const DEFAULT_PROJECT_LIST_STATE: ProjectListUrlState = {
  query: "",
  statusFilter: [],
  categoryFilter: [],
  clientFilter: [],
  ownerFilter: [],
  from: "",
  to: "",
  page: 1,
  view: "grid",
  sortKey: "name",
  sortDir: "asc"
};

const VIEWS = new Set<ProjectListView>(["grid", "sheet", "timeline"]);
const SORT_KEYS = new Set<ProjectListSortKey>(["name", "status", "progress", "dueDate", "priority"]);

/** `a,b` -> ["a","b"]; the old single-value URLs (`status=Active`, `status=all`) still read correctly. */
function readList(value: string | null) {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter((item) => item && item !== "all"))];
}

function readDay(value: string | null) {
  const day = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

export function readProjectListState(params: Pick<URLSearchParams, "get">): ProjectListUrlState {
  const page = Number(params.get("page"));
  const view = params.get("view");
  const sortKey = params.get("sort");
  const sortDir = params.get("dir");

  return {
    query: params.get("q")?.trim() ?? DEFAULT_PROJECT_LIST_STATE.query,
    statusFilter: readList(params.get("status")),
    categoryFilter: readList(params.get("category")),
    clientFilter: readList(params.get("client")),
    ownerFilter: readList(params.get("pic")),
    from: readDay(params.get("from")),
    to: readDay(params.get("to")),
    page: Number.isInteger(page) && page > 0 ? page : DEFAULT_PROJECT_LIST_STATE.page,
    view: view && VIEWS.has(view as ProjectListView) ? view as ProjectListView : DEFAULT_PROJECT_LIST_STATE.view,
    sortKey: sortKey && SORT_KEYS.has(sortKey as ProjectListSortKey) ? sortKey as ProjectListSortKey : DEFAULT_PROJECT_LIST_STATE.sortKey,
    sortDir: sortDir === "desc" ? "desc" : DEFAULT_PROJECT_LIST_STATE.sortDir
  };
}

export function buildProjectListUrl(state: ProjectListUrlState) {
  const params = new URLSearchParams();
  const query = state.query.trim();
  if (query) params.set("q", query);
  if (state.statusFilter.length) params.set("status", state.statusFilter.join(","));
  if (state.categoryFilter.length) params.set("category", state.categoryFilter.join(","));
  if (state.clientFilter.length) params.set("client", state.clientFilter.join(","));
  if (state.ownerFilter.length) params.set("pic", state.ownerFilter.join(","));
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.page > DEFAULT_PROJECT_LIST_STATE.page) params.set("page", String(state.page));
  if (state.view !== DEFAULT_PROJECT_LIST_STATE.view) params.set("view", state.view);
  if (state.sortKey !== DEFAULT_PROJECT_LIST_STATE.sortKey) params.set("sort", state.sortKey);
  if (state.sortDir !== DEFAULT_PROJECT_LIST_STATE.sortDir) params.set("dir", state.sortDir);
  const queryString = params.toString();
  return queryString ? `/projects?${queryString}` : "/projects";
}
