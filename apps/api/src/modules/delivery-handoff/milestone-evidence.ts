export type MilestoneEvidenceDocument = {
  artifactType?: string | null;
  latestStorageProvider?: string | null;
};

export type MilestoneEvidenceCounts = {
  fileCount: number;
  linkCount: number;
  missingRequiredTypes: string[];
};

function normalizeDocumentType(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

export function normalizeRequiredDocumentTypes(milestone: { requiredDocumentTypes?: unknown }): string[] {
  if (!Array.isArray(milestone.requiredDocumentTypes)) return [];

  const seen = new Set<string>();
  return milestone.requiredDocumentTypes.reduce<string[]>((types, value) => {
    const label = String(value ?? "").trim();
    const key = normalizeDocumentType(label);
    if (key && !seen.has(key)) {
      seen.add(key);
      types.push(label);
    }
    return types;
  }, []);
}

export function effectiveMilestoneRequiredDocumentCount(milestone: {
  requiredDocumentCount?: number | null;
  requiredDocumentTypes?: unknown;
}) {
  const requiredTypes = normalizeRequiredDocumentTypes(milestone);
  const configuredCount = Number(milestone.requiredDocumentCount);
  if (Number.isFinite(configuredCount) && configuredCount >= 0) return Math.floor(configuredCount);
  return requiredTypes.length;
}

export function submittedMilestoneEvidenceCount(
  evidenceCounts: MilestoneEvidenceCounts,
  evidenceMode: "file" | "link" | "file_or_link"
) {
  if (evidenceMode === "file") return evidenceCounts.fileCount;
  if (evidenceMode === "link") return evidenceCounts.linkCount;
  return evidenceCounts.fileCount + evidenceCounts.linkCount;
}

export function countMilestoneEvidence(
  milestone: { requiredDocumentTypes?: unknown },
  documents: readonly MilestoneEvidenceDocument[]
): MilestoneEvidenceCounts {
  const usableDocuments = documents.filter((document) => Boolean(document.latestStorageProvider));

  return {
    fileCount: usableDocuments.filter((document) => document.latestStorageProvider !== "external").length,
    linkCount: usableDocuments.filter((document) => document.latestStorageProvider === "external").length,
    missingRequiredTypes: []
  };
}
