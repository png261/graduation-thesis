import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { useState } from "react";

import {
  createProjectBlueprintRun,
  setProjectActiveBlueprint,
  type ProjectBlueprintCatalogItem,
} from "../../api/projects";
import { ActionButtons } from "../tool-ui/shared/action-buttons";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

function defaultInputs(blueprint: ProjectBlueprintCatalogItem) {
  return Object.fromEntries(
    blueprint.requiredInputs
      .filter((item) => item.defaultValue)
      .map((item) => [item.key, item.defaultValue as string]),
  );
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readSuggestions(value: unknown): ProjectBlueprintCatalogItem[] {
  return Array.isArray(value) ? (value as ProjectBlueprintCatalogItem[]) : [];
}

function SuggestionRow({
  blueprint,
  disabled,
  approved,
  saving,
  onApprove,
}: {
  blueprint: ProjectBlueprintCatalogItem;
  disabled: boolean;
  approved: boolean;
  saving: boolean;
  onApprove: () => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--da-border)] bg-[var(--da-bg)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-[var(--da-text)]">{blueprint.name}</p>
          <p className="mt-1 text-sm text-[var(--da-muted)]">{blueprint.summary}</p>
        </div>
        <Badge>{blueprint.kind}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {blueprint.resourcesOrActions.map((item) => (
          <Badge key={item} variant="outline">
            {item}
          </Badge>
        ))}
      </div>
      <p className="mt-3 text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">Required Inputs</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {blueprint.requiredInputs.map((item) => (
          <Badge key={item.key} variant={item.required ? "secondary" : "outline"}>
            {item.label}
          </Badge>
        ))}
      </div>
      <ActionButtons
        className="mt-4"
        align="left"
        actions={[
          {
            id: "approve",
            label: approved ? "Approved" : "Approve Blueprint",
            variant: "default",
            disabled: disabled || approved,
            loading: saving,
          },
        ]}
        onAction={() => onApprove()}
      />
    </div>
  );
}

export function BlueprintSuggestionCard(props: ToolCallMessagePartProps) {
  const args = (props.args as Record<string, unknown> | undefined) ?? {};
  const result = props.result as { suggestions?: ProjectBlueprintCatalogItem[] } | null;
  const [savingId, setSavingId] = useState<string | null>(null);
  const [approvedId, setApprovedId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const suggestions = (result?.suggestions ?? readSuggestions(args.suggestions)).slice(0, 3);
  const projectId = readString(args.projectId);
  const threadId = readString(args.threadId) || crypto.randomUUID();

  async function approveBlueprint(blueprint: ProjectBlueprintCatalogItem) {
    if (!projectId) return;
    const inputs = defaultInputs(blueprint);
    setSavingId(blueprint.id);
    setError("");
    try {
      await setProjectActiveBlueprint(projectId, {
        kind: blueprint.kind,
        blueprintId: blueprint.id,
        inputs,
      });
      await createProjectBlueprintRun(projectId, {
        threadId,
        kind: blueprint.kind,
        blueprintId: blueprint.id,
        inputs,
      });
      props.addResult({
        approved: true,
        blueprintId: blueprint.id,
        blueprintName: blueprint.name,
        kind: blueprint.kind,
        threadId,
        inputs,
      });
      setApprovedId(blueprint.id);
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Failed to approve blueprint");
    } finally {
      setSavingId(null);
    }
  }

  if (suggestions.length < 1) return null;

  return (
    <Card className="border-[var(--da-border)] bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-lg">Blueprint Suggestions</CardTitle>
        <p className="text-sm text-[var(--da-muted)]">Review three curated options and approve one before generation continues.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
            <AlertTitle>Approval failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-3">
          {suggestions.map((blueprint) => (
            <SuggestionRow
              key={blueprint.id}
              blueprint={blueprint}
              disabled={Boolean(savingId) || !projectId}
              approved={approvedId === blueprint.id}
              saving={savingId === blueprint.id}
              onApprove={() => void approveBlueprint(blueprint)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
