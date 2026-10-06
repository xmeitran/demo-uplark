export type ProjectListView = "grid" | "sheet" | "timeline";
export type ProjectListSortKey = "name" | "status" | "progress" | "budget" | "dueDate" | "priority";
export type ProjectListSortDir = "asc" | "desc";

export type ProjectListUrlState = {
  query: string;
  statusFilter: string;
  categoryFilter: string;
  clientFilter: string;
  ownerFilter: string;
  page: number;
  view: ProjectListView;
  sortKey: ProjectListSortKey;
  sortDir: ProjectListSortDir;
};

const DEFAULT_PROJECT_LIST_STATE: ProjectListUrlState = {
  query: "",
  statusFilter: "all",
  categoryFilter: "all",
  clientFilter: "all",
  ownerFilter: "all",
  page: 1,
  view: "grid",
  sortKey: "name",
  sortDir: "asc"
};

const VIEWS = new Set<ProjectListView>(["grid", "sheet", "timeline"]);
const SORT_KEYS = new Set<ProjectListSortKey>(["name", "status", "progress", "budget", "dueDate", "priority"]);

export function readProjectListState(params: Pick<URLSearchParams, "get">): ProjectListUrlState {
  const page = Number(params.get("page"));
  const view = params.get("view");
  const sortKey = params.get("sort");
  const sortDir = params.get("dir");

  return {
    query: params.get("q")?.trim() ?? DEFAULT_PROJECT_LIST_STATE.query,
    statusFilter: params.get("status")?.trim() || DEFAULT_PROJECT_LIST_STATE.statusFilter,
    categoryFilter: params.get("category")?.trim() || DEFAULT_PROJECT_LIST_STATE.categoryFilter,
    clientFilter: params.get("client")?.trim() || DEFAULT_PROJECT_LIST_STATE.clientFilter,
    ownerFilter: params.get("pic")?.trim() || DEFAULT_PROJECT_LIST_STATE.ownerFilter,
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
  if (state.statusFilter !== DEFAULT_PROJECT_LIST_STATE.statusFilter) params.set("status", state.statusFilter);
  if (state.categoryFilter !== DEFAULT_PROJECT_LIST_STATE.categoryFilter) params.set("category", state.categoryFilter);
  if (state.clientFilter !== DEFAULT_PROJECT_LIST_STATE.clientFilter) params.set("client", state.clientFilter);
  if (state.ownerFilter !== DEFAULT_PROJECT_LIST_STATE.ownerFilter) params.set("pic", state.ownerFilter);
  if (state.page > DEFAULT_PROJECT_LIST_STATE.page) params.set("page", String(state.page));
  if (state.view !== DEFAULT_PROJECT_LIST_STATE.view) params.set("view", state.view);
  if (state.sortKey !== DEFAULT_PROJECT_LIST_STATE.sortKey) params.set("sort", state.sortKey);
  if (state.sortDir !== DEFAULT_PROJECT_LIST_STATE.sortDir) params.set("dir", state.sortDir);
  const queryString = params.toString();
  return queryString ? `/projects?${queryString}` : "/projects";
}
