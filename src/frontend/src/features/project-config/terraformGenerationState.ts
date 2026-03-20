import type {
  ProjectBlueprintCatalogItem,
  ProjectTerraformGenerationPreview,
  ProjectTerraformGenerationRecord,
} from "../../api/projects";

export interface TerraformGenerationActionState {
  actionLabel: "Generate Terraform" | "Regenerate Terraform";
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

export function getTerraformGenerationActionState(
  blueprint: ProjectBlueprintCatalogItem,
  latestGeneration: ProjectTerraformGenerationRecord | null,
): TerraformGenerationActionState {
  const unresolved = unresolvedLabels(blueprint);
  return {
    actionLabel: latestGeneration ? "Regenerate Terraform" : "Generate Terraform",
    blocked: unresolved.length > 0,
    blockedReason:
      unresolved.length > 0 ? `Resolve required inputs: ${joinList(unresolved)}.` : null,
  };
}

export function formatTerraformGenerationPreviewSummary(
  preview: Pick<
    ProjectTerraformGenerationPreview,
    "mode" | "moduleNames" | "generatedFiles" | "stackPath" | "inputsChanged" | "removedModules" | "validationIssues"
  >,
) {
  const parts = [
    `${preview.mode === "regenerate" ? "Regenerate" : "Generate"} ${countLabel(preview.moduleNames.length, "module")} and ${countLabel(preview.generatedFiles.length, "file")} in ${preview.stackPath}.`,
  ];
  if (preview.inputsChanged) parts.push("Inputs changed since the previous generation.");
  if (preview.removedModules.length > 0) {
    parts.push(
      `Remove ${countLabel(preview.removedModules.length, "obsolete module")}: ${joinList(preview.removedModules)}.`,
    );
  }
  if (preview.validationIssues.length > 0) {
    parts.push(
      `${countLabel(preview.validationIssues.length, "validation issue")} must be resolved before files can be written.`,
    );
  }
  return parts.join(" ");
}

export function formatTerraformGenerationHistorySummary(
  generation: Pick<ProjectTerraformGenerationRecord, "moduleNames" | "generatedPaths" | "compare">,
) {
  const compare = generation.compare;
  if (!compare || !compare.hasPrevious) {
    return `Initial generation created ${countLabel(generation.moduleNames.length, "module")} and ${countLabel(Object.keys(generation.generatedPaths).length, "file")}.`;
  }
  const parts: string[] = [];
  if (compare.addedModules.length > 0) parts.push(`added ${countLabel(compare.addedModules.length, "module")}`);
  if (compare.changedModules.length > 0) parts.push(`changed ${countLabel(compare.changedModules.length, "module")}`);
  if (compare.removedModules.length > 0) parts.push(`removed ${countLabel(compare.removedModules.length, "module")}`);
  if (compare.changedFiles.length > 0) parts.push(`updated ${countLabel(compare.changedFiles.length, "file")}`);
  if (parts.length < 1) parts.push("no module or file changes");
  const suffix = compare.inputsChanged ? " Inputs changed since the previous generation." : "";
  return `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `, ${parts.slice(1).join(", ")}` : ""}.${suffix}`;
}

export function formatTerraformGenerationTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
