export type MilestoneEvidenceDocument = {
  artifactType?: string | null;
  latestStorageProvider?: string | null;
};

export type MilestoneEvidenceCounts = {
  fileCount: number;
  linkCount: number;
  requiredTypeCount: number;
  satisfiedTypeCount: number;
  fileSatisfiedTypeCount: number;
  linkSatisfiedTypeCount: number;
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
  if (requiredTypes.length > 0) return requiredTypes.length;

  const configuredCount = Number(milestone.requiredDocumentCount ?? 0);
  return Number.isFinite(configuredCount) && configuredCount > 0 ? Math.floor(configuredCount) : 0;
}

export function submittedMilestoneEvidenceCount(
  evidenceCounts: MilestoneEvidenceCounts,
  evidenceMode: "file" | "link" | "file_or_link"
) {
  if (evidenceCounts.requiredTypeCount > 0) {
    if (evidenceMode === "file") return evidenceCounts.fileSatisfiedTypeCount;
    if (evidenceMode === "link") return evidenceCounts.linkSatisfiedTypeCount;
    return evidenceCounts.satisfiedTypeCount;
  }

  if (evidenceMode === "file") return evidenceCounts.fileCount;
  if (evidenceMode === "link") return evidenceCounts.linkCount;
  return evidenceCounts.fileCount + evidenceCounts.linkCount;
}

export function countMilestoneEvidence(
  milestone: { requiredDocumentTypes?: unknown },
  documents: readonly MilestoneEvidenceDocument[]
): MilestoneEvidenceCounts {
  const requiredTypes = normalizeRequiredDocumentTypes(milestone);
  const requiredTypeKeys = new Set(requiredTypes.map(normalizeDocumentType));

  const matchingDocuments = documents.filter((document) => {
    if (!document.latestStorageProvider) return false;
    if (requiredTypeKeys.size === 0) return true;
    return requiredTypeKeys.has(normalizeDocumentType(document.artifactType));
  });

  const hasType = (type: string, provider?: "file" | "link") => matchingDocuments.some((document) => {
    if (normalizeDocumentType(document.artifactType) !== normalizeDocumentType(type)) return false;
    if (!provider) return true;
    return provider === "link"
      ? document.latestStorageProvider === "external"
      : document.latestStorageProvider !== "external";
  });
  const missingRequiredTypes = requiredTypes.filter((type) => !hasType(type));

  return {
    fileCount: matchingDocuments.filter((document) => document.latestStorageProvider !== "external").length,
    linkCount: matchingDocuments.filter((document) => document.latestStorageProvider === "external").length,
    requiredTypeCount: requiredTypes.length,
    satisfiedTypeCount: requiredTypes.filter((type) => hasType(type)).length,
    fileSatisfiedTypeCount: requiredTypes.filter((type) => hasType(type, "file")).length,
    linkSatisfiedTypeCount: requiredTypes.filter((type) => hasType(type, "link")).length,
    missingRequiredTypes
  };
}
