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
      statusFilter: ["Active", "On Hold"],
      categoryFilter: ["Delivery"],
      clientFilter: ["account-1", "account-2"],
      ownerFilter: ["user-1", "user-2"],
      from: "2026-10-01",
      to: "2026-10-31",
      page: 2,
      view: "sheet",
      sortKey: "dueDate",
      sortDir: "desc"
    };

    const url = buildProjectListUrl(state);
    expect(url).toBe("/projects?q=AMOBEAR&status=Active%2COn+Hold&category=Delivery&client=account-1%2Caccount-2&pic=user-1%2Cuser-2&from=2026-10-01&to=2026-10-31&page=2&view=sheet&sort=dueDate&dir=desc");
    expect(readProjectListState(new URLSearchParams(url.split("?")[1]))).toEqual({
      ...state,
      query: "AMOBEAR"
    });
  });

  it("ignores invalid values and falls back to the default list state", () => {
    expect(readProjectListState(new URLSearchParams("page=-4&view=unknown&sort=bad&dir=sideways&from=01/10/2026&to=tomorrow&status=all"))).toEqual({
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
    });
  });

  it("keeps reading the old single-value filter URLs", () => {
    expect(readProjectListState(new URLSearchParams("status=Active&category=Delivery&client=account-1&pic=user-1"))).toMatchObject({
      statusFilter: ["Active"],
      categoryFilter: ["Delivery"],
      clientFilter: ["account-1"],
      ownerFilter: ["user-1"]
    });
    expect(buildProjectListUrl(readProjectListState(new URLSearchParams("pic=user-1")))).toBe("/projects?pic=user-1");
  });
});
