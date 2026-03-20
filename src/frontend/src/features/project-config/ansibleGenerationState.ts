import type {
  ProjectAnsibleGenerationPreview,
  ProjectAnsibleGenerationRecord,
  ProjectBlueprintCatalogItem,
} from "../../api/projects";

export interface AnsibleGenerationActionState {
  actionLabel: "Generate Ansible" | "Regenerate Ansible";
  blocked: boolean;
  blockedReason: string | null;
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinList(items: string[]) {
  return items.join(", ");
}

function unresolvedLabels(blueprint: ProjectBlueprintCatalogItem) {
  return blueprint.requiredInputs
    .filter((item) => item.required && !item.resolved)
    .map((item) => item.label);
}

export function getAnsibleGenerationActionState(
  blueprint: ProjectBlueprintCatalogItem,
  latestGeneration: ProjectAnsibleGenerationRecord | null,
): AnsibleGenerationActionState {
  const unresolved = unresolvedLabels(blueprint);
  return {
    actionLabel: latestGeneration ? "Regenerate Ansible" : "Generate Ansible",
    blocked: unresolved.length > 0,
    blockedReason:
      unresolved.length > 0 ? `Resolve required inputs: ${joinList(unresolved)}.` : null,
  };
}

export function formatAnsibleGenerationPreviewSummary(
  preview: Pick<
    ProjectAnsibleGenerationPreview,
    "mode" | "targetModules" | "skippedModules" | "generatedFiles" | "playbookPath" | "inputsChanged" | "removedRoles" | "validationIssues"
  >,
) {
  const parts = [
    `${preview.mode === "regenerate" ? "Regenerate" : "Generate"} ${countLabel(preview.targetModules.length, "role")} and ${countLabel(preview.generatedFiles.length, "file")} for ${preview.playbookPath}.`,
  ];
  if (preview.skippedModules.length > 0) {
    parts.push(`Skip ${countLabel(preview.skippedModules.length, "module")}: ${joinList(preview.skippedModules)}.`);
  }
  if (preview.inputsChanged) parts.push("Inputs changed since the previous generation.");
  if (preview.removedRoles.length > 0) {
    parts.push(`Remove ${countLabel(preview.removedRoles.length, "obsolete role")}: ${joinList(preview.removedRoles)}.`);
  }
  if (preview.validationIssues.length > 0) {
    parts.push(
      `${countLabel(preview.validationIssues.length, "validation issue")} must be resolved before files can be written.`,
    );
  }
  return parts.join(" ");
}

export function formatAnsibleGenerationHistorySummary(
  generation: Pick<ProjectAnsibleGenerationRecord, "targetModules" | "generatedPaths" | "compare">,
) {
  const compare = generation.compare;
  if (!compare || !compare.hasPrevious) {
    return `Initial generation created ${countLabel(generation.targetModules.length, "role")} and ${countLabel(Object.keys(generation.generatedPaths).length, "file")}.`;
  }
  const parts: string[] = [];
  if (compare.addedModules.length > 0) parts.push(`added ${countLabel(compare.addedModules.length, "role")}`);
  if (compare.changedModules.length > 0) parts.push(`changed ${countLabel(compare.changedModules.length, "role")}`);
  if (compare.removedModules.length > 0) parts.push(`removed ${countLabel(compare.removedModules.length, "role")}`);
  if (compare.changedFiles.length > 0) parts.push(`updated ${countLabel(compare.changedFiles.length, "file")}`);
  if (parts.length < 1) parts.push("no role or file changes");
  const suffix = compare.inputsChanged ? " Inputs changed since the previous generation." : "";
  return `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `, ${parts.slice(1).join(", ")}` : ""}.${suffix}`;
}

export function formatAnsibleGenerationTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
