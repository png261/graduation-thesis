export const EVIDENCE_BUNDLE_SECTIONS = [
  "Changed Files",
  "Validations Run",
  "Pass/Fail Evidence",
  "Unresolved Risks",
  "Completion Rationale",
] as const;

export type EvidenceBundleSectionName = (typeof EVIDENCE_BUNDLE_SECTIONS)[number];

export type EvidenceBundlePayload = {
  schemaVersion?: number;
  changedFiles: string[];
  validationsRun: string[];
  passFailEvidence: string[];
  unresolvedRisks: string[];
  completionRationale: string[];
};

const SECTION_MAP = new Map<string, EvidenceBundleSectionName>(
  EVIDENCE_BUNDLE_SECTIONS.map((label) => [label.toLowerCase(), label]),
);

function cleanHeading(value: string) {
  return value.replace(/^[#*\-\s>]+/, "").replace(/[:*\s]+$/, "").trim().toLowerCase();
}

function normalizeItem(line: string) {
  return line.replace(/^[*\-\d.\s]+/, "").trim();
}

export function parseEvidenceBundleText(text: string): EvidenceBundlePayload | null {
  const sections = new Map<EvidenceBundleSectionName, string[]>();
  let current: EvidenceBundleSectionName | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = SECTION_MAP.get(cleanHeading(line));
    if (heading) {
      current = heading;
      if (!sections.has(heading)) sections.set(heading, []);
      continue;
    }
    if (!current) continue;
    sections.get(current)?.push(normalizeItem(line));
  }

  if (sections.size < 3) return null;

  return {
    changedFiles: sections.get("Changed Files") ?? [],
    validationsRun: sections.get("Validations Run") ?? [],
    passFailEvidence: sections.get("Pass/Fail Evidence") ?? [],
    unresolvedRisks: sections.get("Unresolved Risks") ?? [],
    completionRationale: sections.get("Completion Rationale") ?? [],
  };
}
