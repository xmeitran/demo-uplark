import { describe, expect, it } from "vitest";
import {
  buildProjectListUrl,
  readProjectListState,
  type ProjectListUrlState
} from "./project-list-state";

describe("project list URL state", () => {
  it("round-trips filters and view settings through the project return URL", () => {
    const state: ProjectListUrlState = {
      query: "  AMOBEAR  ",
      statusFilter: "Active",
      categoryFilter: "Delivery",
      clientFilter: "account-1",
      ownerFilter: "user-1",
      page: 2,
      view: "sheet",
      sortKey: "dueDate",
      sortDir: "desc"
    };

    const url = buildProjectListUrl(state);
    expect(url).toBe("/projects?q=AMOBEAR&status=Active&category=Delivery&client=account-1&pic=user-1&page=2&view=sheet&sort=dueDate&dir=desc");
    expect(readProjectListState(new URLSearchParams(url.split("?")[1]))).toEqual({
      ...state,
      query: "AMOBEAR"
    });
  });

  it("ignores invalid values and falls back to the default list state", () => {
    expect(readProjectListState(new URLSearchParams("page=-4&view=unknown&sort=bad&dir=sideways"))).toEqual({
      query: "",
      statusFilter: "all",
      categoryFilter: "all",
      clientFilter: "all",
      ownerFilter: "all",
      page: 1,
      view: "grid",
      sortKey: "name",
      sortDir: "asc"
    });
  });
});
