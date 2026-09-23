import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  assertCompleteHierarchyPermutation,
  isLegacyMilestonePlaceholder,
  parseProjectHierarchyOrderInput
} from "./projects.service";

describe("project hierarchy order validation", () => {
  it("accepts a complete sibling permutation", () => {
    expect(() => assertCompleteHierarchyPermutation(
      ["milestone-a", "milestone-b", "milestone-c"],
      ["milestone-c", "milestone-a", "milestone-b"]
    )).not.toThrow();
  });

  it.each([
    {
      name: "duplicates",
      orderedIds: ["stage-a", "stage-a"]
    },
    {
      name: "missing siblings",
      orderedIds: ["stage-a"]
    },
    {
      name: "foreign siblings",
      orderedIds: ["stage-a", "stage-foreign"]
    }
  ])("rejects $name without accepting a partial order", ({ orderedIds }) => {
    expect(() => assertCompleteHierarchyPermutation(
      ["stage-a", "stage-b"],
      orderedIds
    )).toThrow(BadRequestException);
  });

  it("requires milestone parentId to be null", () => {
    expect(() => parseProjectHierarchyOrderInput({
      kind: "milestone",
      parentId: "synthetic-unassigned",
      orderedIds: [],
      expectedVersion: 0
    })).toThrow(BadRequestException);
  });

  it("requires a real parent for stage and task order", () => {
    expect(() => parseProjectHierarchyOrderInput({
      kind: "task",
      parentId: null,
      orderedIds: [],
      expectedVersion: 0
    })).toThrow(BadRequestException);
  });

  it("rejects stale-token shapes before persistence", () => {
    expect(() => parseProjectHierarchyOrderInput({
      kind: "stage",
      parentId: "milestone-a",
      orderedIds: ["stage-a"],
      expectedVersion: -1
    })).toThrow(BadRequestException);
  });

  it("excludes an empty legacy milestone placeholder from stage ordering", () => {
    expect(isLegacyMilestonePlaceholder({
      activity: " Discovery ",
      phase: "discovery",
      milestoneName: "Discovery",
      activeTaskCount: 0
    })).toBe(true);
    expect(isLegacyMilestonePlaceholder({
      activity: "Discovery",
      phase: "discovery",
      milestoneName: "Discovery",
      activeTaskCount: 1
    })).toBe(false);
  });
});
