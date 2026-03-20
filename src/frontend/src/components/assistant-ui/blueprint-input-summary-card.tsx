import type { ToolCallMessagePartProps } from "@assistant-ui/react";

import type { ProjectBlueprintInputSummary } from "../../api/projects";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const RISKY_CLASSES = new Set(["cost", "network", "data", "destroy"]);

function InputRow({ item }: { item: ProjectBlueprintInputSummary }) {
  return (
    <div className="rounded-lg border border-[var(--da-border)] bg-[var(--da-bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--da-text)]">{item.label}</p>
          {item.description ? <p className="mt-1 text-sm text-[var(--da-muted)]">{item.description}</p> : null}
        </div>
        <Badge variant={item.resolved ? "default" : "outline"}>{item.riskClass}</Badge>
      </div>
      <p className="mt-2 text-xs text-[var(--da-muted)]">
        Required: {item.required ? "Yes" : "No"} | Default: {item.defaultValue ?? "None"}
      </p>
    </div>
  );
}

function InputGroup({ title, items }: { title: string; items: ProjectBlueprintInputSummary[] }) {
  if (items.length < 1) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">{title}</p>
      <div className="space-y-2">{items.map((item) => <InputRow key={item.key} item={item} />)}</div>
    </div>
  );
}

export function BlueprintInputSummaryCard(props: ToolCallMessagePartProps) {
  const result = props.result as {
    blueprintName?: string;
    inputs?: ProjectBlueprintInputSummary[];
  } | null;
  const items = result?.inputs ?? [];
  if (items.length < 1) return null;
  const unresolvedRequired = items.filter((item) => item.required && !item.resolved);
  const risky = unresolvedRequired.filter((item) => RISKY_CLASSES.has(item.riskClass));
  const remaining = items.filter((item) => !risky.includes(item));

  return (
    <Card className="border-[var(--da-border)] bg-[var(--da-elevated)]">
      <CardHeader>
        <CardTitle className="text-lg">Blueprint Input Summary</CardTitle>
        <p className="text-sm text-[var(--da-muted)]">{result?.blueprintName ?? "Approved blueprint"}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {unresolvedRequired.length > 0 ? (
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
            <AlertTitle>Unresolved required inputs</AlertTitle>
            <AlertDescription>
              Generation should not continue until these fields are confirmed.
            </AlertDescription>
          </Alert>
        ) : null}
        <InputGroup title="Risky Fields" items={risky} />
        <InputGroup title="Remaining Inputs" items={remaining} />
      </CardContent>
    </Card>
  );
}
