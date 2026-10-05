import { describe, expect, it } from "vitest";
import {
  countMilestoneEvidence,
  effectiveMilestoneRequiredDocumentCount,
  submittedMilestoneEvidenceCount
} from "./milestone-evidence";

describe("countMilestoneEvidence", () => {
  it("counts every usable project document toward the configured quantity", () => {
    expect(countMilestoneEvidence(
      { requiredDocumentTypes: ["BRD", "FRD", "SRS"] },
      [
        { artifactType: "BRD", latestStorageProvider: "local" },
        { artifactType: "FRD", latestStorageProvider: "external" },
        { artifactType: "random_note", latestStorageProvider: "local" }
      ]
    )).toMatchObject({
      fileCount: 2,
      linkCount: 1,
      missingRequiredTypes: []
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
      missingRequiredTypes: []
    });
  });

  it("uses the explicit quantity instead of treating document types as separate slots", () => {
    expect(countMilestoneEvidence(
      { requiredDocumentTypes: ["brd"] },
      [{ artifactType: " BRD ", latestStorageProvider: "local" }]
    )).toMatchObject({
      fileCount: 1,
      linkCount: 0,
      missingRequiredTypes: []
    });
    expect(effectiveMilestoneRequiredDocumentCount({
      requiredDocumentCount: 1,
      requiredDocumentTypes: ["BRD", "FRD", "SRS"]
    })).toBe(1);
  });

  it("counts duplicate document types as separate submitted documents", () => {
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
      missingRequiredTypes: []
    });
    expect(submittedMilestoneEvidenceCount(counts, "file_or_link")).toBe(2);
  });

  it("respects the selected file or link evidence mode", () => {
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
    expect(submittedMilestoneEvidenceCount(counts, "file_or_link")).toBe(3);
  });
});
