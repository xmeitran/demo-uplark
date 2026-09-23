import { describe, expect, it } from "vitest";
import { PROJECTS } from "../../../app/projects/data";
import {
  normalizeProjectSheetPreferences,
  projectsToTsv,
  toggleProjectSheetSelection
} from "./project-sheet-state";

describe("project sheet state", () => {
  it("keeps only supported visible preferences", () => {
    expect(normalizeProjectSheetPreferences({
      hiddenColumns: ["budget", "budget", "unknown"],
      pinnedColumn: "budget"
    })).toEqual({
      hiddenColumns: ["budget"],
      pinnedColumn: null
    });
  });

  it("toggles a stable project id without mutating the original set", () => {
    const original = new Set(["p1"]);
    const selected = toggleProjectSheetSelection(original, "p2");
    const deselected = toggleProjectSheetSelection(selected, "p1");

    expect([...original]).toEqual(["p1"]);
    expect([...selected]).toEqual(["p1", "p2"]);
    expect([...deselected]).toEqual(["p2"]);
  });

  it("copies project rows as spreadsheet-safe TSV", () => {
    const source = { ...PROJECTS[0], name: "Alpha\tProject", description: "Line 1\nLine 2" };
    const output = projectsToTsv([source]);

    expect(output.split("\n")).toHaveLength(2);
    expect(output).toContain("Alpha Project");
    expect(output).toContain(source.client);
    expect(output).not.toContain("Alpha\tProject");
  });
});
