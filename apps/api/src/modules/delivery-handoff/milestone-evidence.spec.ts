import { describe, expect, it } from "vitest";
import {
  countMilestoneEvidence,
  effectiveMilestoneRequiredDocumentCount,
  submittedMilestoneEvidenceCount
} from "./milestone-evidence";

describe("countMilestoneEvidence", () => {
  it("counts only the configured document types", () => {
    expect(countMilestoneEvidence(
      { requiredDocumentTypes: ["BRD", "FRD", "SRS"] },
      [
        { artifactType: "BRD", latestStorageProvider: "local" },
        { artifactType: "FRD", latestStorageProvider: "external" },
        { artifactType: "random_note", latestStorageProvider: "local" }
      ]
    )).toMatchObject({
      fileCount: 1,
      linkCount: 1,
      requiredTypeCount: 3,
      satisfiedTypeCount: 2,
      fileSatisfiedTypeCount: 1,
      linkSatisfiedTypeCount: 1,
      missingRequiredTypes: ["SRS"]
    });
  });

  it("does not count an artifact without a valid latest version", () => {
    expect(countMilestoneEvidence(
      { requiredDocumentTypes: [] },
      [
        { artifactType: "BRD", latestStorageProvider: "local" },
        { artifactType: "FRD", latestStorageProvider: null }
      ]
    )).toMatchObject({
      fileCount: 1,
      linkCount: 0,
      requiredTypeCount: 0,
      satisfiedTypeCount: 0,
      missingRequiredTypes: []
    });
  });

  it("matches document types case-insensitively", () => {
    expect(countMilestoneEvidence(
      { requiredDocumentTypes: ["brd"] },
      [{ artifactType: " BRD ", latestStorageProvider: "local" }]
    )).toMatchObject({
      fileCount: 1,
      linkCount: 0,
      requiredTypeCount: 1,
      satisfiedTypeCount: 1,
      missingRequiredTypes: []
    });
  });

  it("requires each configured type instead of counting duplicate evidence", () => {
    const counts = countMilestoneEvidence(
      { requiredDocumentTypes: ["BRD", "FRD", "SRS"] },
      [
        { artifactType: "BRD", latestStorageProvider: "local" },
        { artifactType: "BRD", latestStorageProvider: "external" }
      ]
    );

    expect(counts).toMatchObject({
      fileCount: 1,
      linkCount: 1,
      requiredTypeCount: 3,
      satisfiedTypeCount: 1,
      missingRequiredTypes: ["FRD", "SRS"]
    });
    expect(submittedMilestoneEvidenceCount(counts, "file_or_link")).toBe(1);
    expect(effectiveMilestoneRequiredDocumentCount({ requiredDocumentCount: 1, requiredDocumentTypes: ["BRD", "FRD", "SRS"] })).toBe(3);
  });

  it("counts one satisfied slot per type for the selected evidence mode", () => {
    const counts = countMilestoneEvidence(
      { requiredDocumentTypes: ["BRD", "FRD"] },
      [
        { artifactType: "BRD", latestStorageProvider: "local" },
        { artifactType: "BRD", latestStorageProvider: "external" },
        { artifactType: "FRD", latestStorageProvider: "external" }
      ]
    );

    expect(submittedMilestoneEvidenceCount(counts, "file")).toBe(1);
    expect(submittedMilestoneEvidenceCount(counts, "link")).toBe(2);
    expect(submittedMilestoneEvidenceCount(counts, "file_or_link")).toBe(2);
  });
});
