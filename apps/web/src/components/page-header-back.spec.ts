import { describe, expect, it } from "vitest";
import { resolveBackHref } from "./page-header-back";

describe("resolveBackHref", () => {
  it("uses the fallback without a returnTo", () => {
    expect(resolveBackHref("/projects")).toBe("/projects");
    expect(resolveBackHref("/projects", null)).toBe("/projects");
    expect(resolveBackHref("/projects", "")).toBe("/projects");
  });

  it("honours a same-origin path with its query", () => {
    expect(resolveBackHref("/projects", "/clients/42?tab=Projects")).toBe("/clients/42?tab=Projects");
    expect(resolveBackHref("/projects", "/")).toBe("/");
  });

  it("rejects anything that could leave the site", () => {
    for (const hostile of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "projects"]) {
      expect(resolveBackHref("/projects", hostile)).toBe("/projects");
    }
  });
});
