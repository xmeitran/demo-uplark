import { describe, expect, it } from "vitest";
import { buildCreateProjectHref, buildProjectsHrefWithoutCreate } from "./project-create-navigation";

describe("project create navigation", () => {
  it("opens the shared create modal while preserving project list filters", () => {
    expect(buildCreateProjectHref("view=sheet&page=2")).toBe("/projects?view=sheet&page=2&create=1");
  });

  it("removes only the create flag when the shared modal closes", () => {
    expect(buildProjectsHrefWithoutCreate("view=sheet&create=1&page=2")).toBe("/projects?view=sheet&page=2");
  });
});
