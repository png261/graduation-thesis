import type { ReactNode } from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import { useEffect, useState } from "react";

import {
  generateProjectConfigurationAnsible,
  generateProjectProvisioningTerraform,
  listProjectConfigurationAnsibleHistory,
  listProjectProvisioningTerraformHistory,
  previewProjectConfigurationAnsible,
  previewProjectProvisioningTerraform,
  type ProjectAnsibleGenerationPreview,
  type ProjectAnsibleGenerationRecord,
  type ProjectAnsibleGenerationResult,
  type ProjectBlueprintCatalogItem,
  type ProjectBlueprintInputSummary,
  type ProjectTerraformGenerationPreview,
  type ProjectTerraformGenerationRecord,
  type ProjectTerraformGenerationResult,
} from "../../api/projects";
import {
  formatAnsibleGenerationHistorySummary,
  formatAnsibleGenerationPreviewSummary,
  getAnsibleGenerationActionState,
} from "../../features/project-config/ansibleGenerationState";
import {
  formatTerraformGenerationHistorySummary,
  formatTerraformGenerationPreviewSummary,
  getTerraformGenerationActionState,
} from "../../features/project-config/terraformGenerationState";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type ReviewPayload = ProjectTerraformGenerationPreview | ProjectTerraformGenerationResult;

function InputBadges({ items }: { items: ProjectBlueprintInputSummary[] }) {
  if (items.length < 1) return <p className="text-sm text-[var(--da-muted)]">No required inputs.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item.key} variant={item.resolved ? "default" : "outline"}>
          {item.label}
        </Badge>
      ))}
    </div>
  );
}

function StepList({ blueprint }: { blueprint: ProjectBlueprintCatalogItem }) {
  return (
    <div className="space-y-3">
      {blueprint.steps.map((step, index) => (
        <div key={step.id} className="rounded-lg border border-[var(--da-border)] bg-[var(--da-bg)] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-[var(--da-text)]">
              {index + 1}. {step.title}
            </p>
            <Badge variant="secondary">{step.type}</Badge>
          </div>
          <p className="mt-2 text-sm text-[var(--da-muted)]">{step.description}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">
            Expected Result
          </p>
          <p className="mt-1 text-sm text-[var(--da-text)]">{step.expectedResult}</p>
        </div>
      ))}
    </div>
  );
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function reviewFiles(payload: ReviewPayload) {
  return "writtenFiles" in payload ? payload.writtenFiles : payload.generatedFiles;
}

function successSummary(result: ProjectTerraformGenerationResult) {
  const removed = result.removedFiles.length > 0 ? ` Removed ${result.removedFiles.length} stale files.` : "";
  return `Wrote ${result.writtenFiles.length} files across ${result.moduleNames.length} modules. Provenance report: ${result.provenanceReportPath}.${removed}`;
}

function ansibleSuccessSummary(result: ProjectAnsibleGenerationResult) {
  const removed = result.removedFiles.length > 0 ? ` Removed ${result.removedFiles.length} stale files.` : "";
  return `Wrote ${result.writtenFiles.length} files across ${result.targetModules.length} roles. Provenance report: ${result.provenanceReportPath}.${removed}`;
}

function ReviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">{title}</p>
      {children}
    </section>
  );
}

function TokenList({
  items,
  empty,
  monospace = false,
}: {
  items: string[];
  empty: string;
  monospace?: boolean;
}) {
  if (items.length < 1) return <p className="text-sm text-[var(--da-muted)]">{empty}</p>;
  return (
    <div className="max-h-40 space-y-2 overflow-auto pr-1">
      {items.map((item) => (
        <div
          key={item}
          className={`rounded-md border border-[var(--da-border)] bg-[var(--da-bg)] px-3 py-2 text-sm text-[var(--da-text)] ${monospace ? "font-mono text-xs" : ""}`}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function ModuleBadges({ modules }: { modules: string[] }) {
  if (modules.length < 1) return <p className="text-sm text-[var(--da-muted)]">No modules selected.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {modules.map((item) => (
        <Badge key={item} variant="outline">
          {item}
        </Badge>
      ))}
    </div>
  );
}

function TerraformGenerationReviewDialog(props: {
  actionLabel: string;
  busy: boolean;
  error: string;
  open: boolean;
  payload: ReviewPayload | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { actionLabel, busy, error, open, payload, onConfirm, onOpenChange } = props;
  if (!payload) return null;
  const validationIssues = payload.validationIssues;
  const files = reviewFiles(payload);
  const generated = "generation" in payload ? payload.generation : null;
  const confirmDisabled = busy || validationIssues.length > 0 || generated !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-[var(--da-border)] bg-[var(--da-panel)]">
        <DialogHeader>
          <DialogTitle>Terraform Generation Review</DialogTitle>
          <DialogDescription>{formatTerraformGenerationPreviewSummary(payload)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {generated ? (
            <Alert className="border-emerald-500/40 bg-emerald-500/10 text-emerald-100">
              <AlertTitle>Terraform generated</AlertTitle>
              <AlertDescription>{successSummary(payload as ProjectTerraformGenerationResult)}</AlertDescription>
            </Alert>
          ) : null}
          {validationIssues.length > 0 ? (
            <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
              <AlertTitle>Validation blocks write</AlertTitle>
              <AlertDescription>Resolve the listed issues before confirming Terraform generation.</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
              <AlertTitle>Terraform generation failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <ReviewSection title="Stack Summary">
            <div className="rounded-lg border border-[var(--da-border)] bg-[var(--da-bg)] p-3 text-sm text-[var(--da-text)]">
              <p>{payload.summary.headline}</p>
              <p className="mt-2 text-[var(--da-muted)]">Stack path: {payload.stackPath}</p>
              <p className="mt-1 text-[var(--da-muted)]">Blueprint run: {payload.blueprintRunId}</p>
              {"provenanceReportPath" in payload ? (
                <p className="mt-1 text-[var(--da-muted)]">
                  Provenance report: {payload.provenanceReportPath}
                </p>
              ) : null}
            </div>
          </ReviewSection>
          <ReviewSection title="Modules">
            <ModuleBadges modules={payload.moduleNames} />
          </ReviewSection>
          <ReviewSection title="Files">
            <TokenList items={files} empty="No files generated." monospace />
          </ReviewSection>
          <ReviewSection title="Removed Modules">
            <TokenList items={payload.removedModules} empty="No modules will be removed." />
          </ReviewSection>
          <ReviewSection title="Validation Issues">
            <TokenList items={validationIssues} empty="No validation issues." />
          </ReviewSection>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {generated ? "Close" : "Cancel"}
          </Button>
          {!generated ? (
            <Button onClick={onConfirm} disabled={confirmDisabled}>
              {busy ? "Generating..." : actionLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TerraformGenerationActionArea(props: {
  blueprint: ProjectBlueprintCatalogItem;
  latestGeneration?: ProjectTerraformGenerationRecord | null;
  onGenerated?: (result: ProjectTerraformGenerationResult) => void;
  projectId?: string | null;
  threadId?: string | null;
}) {
  const { blueprint, latestGeneration, onGenerated, projectId, threadId } = props;
  const [currentLatestGeneration, setCurrentLatestGeneration] = useState<ProjectTerraformGenerationRecord | null>(
    latestGeneration ?? null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (latestGeneration === undefined) return;
    setCurrentLatestGeneration(latestGeneration);
  }, [latestGeneration]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || latestGeneration !== undefined || blueprint.kind !== "provisioning") return undefined;
    listProjectProvisioningTerraformHistory(projectId, 1)
      .then((items) => {
        if (!cancelled) setCurrentLatestGeneration(items[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [blueprint.kind, latestGeneration, projectId, threadId]);

  if (blueprint.kind !== "provisioning" || !projectId) return null;
  const resolvedProjectId = projectId;
  const action = getTerraformGenerationActionState(blueprint, currentLatestGeneration);

  async function openPreview() {
    setLoadingPreview(true);
    setError("");
    try {
      const preview = await previewProjectProvisioningTerraform(resolvedProjectId);
      setPayload(preview);
      setDialogOpen(true);
    } catch (nextError: unknown) {
      setError(readErrorMessage(nextError, "Terraform generation failed"));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function confirmGeneration() {
    if (!payload) return;
    setWriting(true);
    setError("");
    try {
      const result = await generateProjectProvisioningTerraform(resolvedProjectId, {
        previewToken: payload.previewToken,
        confirmWrite: true,
      });
      setPayload(result);
      setCurrentLatestGeneration(result.generation);
      onGenerated?.(result);
    } catch (nextError: unknown) {
      setError(readErrorMessage(nextError, "Terraform generation failed"));
    } finally {
      setWriting(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-[var(--da-border)] pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">Terraform</p>
          <p className="text-sm text-[var(--da-muted)]">
            {currentLatestGeneration
              ? formatTerraformGenerationHistorySummary(currentLatestGeneration)
              : "Review deterministic stack and module output before Terraform files are written."}
          </p>
        </div>
        {!action.blocked ? (
          <Button onClick={() => void openPreview()} disabled={loadingPreview || writing}>
            {loadingPreview ? "Loading Review..." : action.actionLabel}
          </Button>
        ) : null}
      </div>
      {action.blockedReason ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
          <AlertTitle>Terraform blocked</AlertTitle>
          <AlertDescription>{action.blockedReason}</AlertDescription>
        </Alert>
      ) : null}
      {error && !dialogOpen ? (
        <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
          <AlertTitle>Terraform generation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <TerraformGenerationReviewDialog
        actionLabel={action.actionLabel}
        busy={writing}
        error={dialogOpen ? error : ""}
        open={dialogOpen}
        payload={payload}
        onConfirm={() => void confirmGeneration()}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

type AnsibleReviewPayload = ProjectAnsibleGenerationPreview | ProjectAnsibleGenerationResult;

function reviewAnsibleFiles(payload: AnsibleReviewPayload) {
  return "writtenFiles" in payload ? payload.writtenFiles : payload.generatedFiles;
}

function AnsibleGenerationReviewDialog(props: {
  actionLabel: string;
  busy: boolean;
  error: string;
  open: boolean;
  payload: AnsibleReviewPayload | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { actionLabel, busy, error, open, payload, onConfirm, onOpenChange } = props;
  if (!payload) return null;
  const validationIssues = payload.validationIssues;
  const files = reviewAnsibleFiles(payload);
  const generated = "generation" in payload ? payload.generation : null;
  const confirmDisabled = busy || validationIssues.length > 0 || generated !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-[var(--da-border)] bg-[var(--da-panel)]">
        <DialogHeader>
          <DialogTitle>Ansible Generation Review</DialogTitle>
          <DialogDescription>{formatAnsibleGenerationPreviewSummary(payload)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {generated ? (
            <Alert className="border-emerald-500/40 bg-emerald-500/10 text-emerald-100">
              <AlertTitle>Ansible generated</AlertTitle>
              <AlertDescription>{ansibleSuccessSummary(payload as ProjectAnsibleGenerationResult)}</AlertDescription>
            </Alert>
          ) : null}
          {validationIssues.length > 0 ? (
            <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
              <AlertTitle>Validation blocks write</AlertTitle>
              <AlertDescription>Resolve the listed issues before confirming Ansible generation.</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
              <AlertTitle>Ansible generation failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <ReviewSection title="Playbook Summary">
            <div className="rounded-lg border border-[var(--da-border)] bg-[var(--da-bg)] p-3 text-sm text-[var(--da-text)]">
              <p>{payload.summary.headline}</p>
              <p className="mt-2 text-[var(--da-muted)]">Playbook path: {payload.playbookPath}</p>
              <p className="mt-1 text-[var(--da-muted)]">Blueprint run: {payload.blueprintRunId}</p>
              {"provenanceReportPath" in payload ? (
                <p className="mt-1 text-[var(--da-muted)]">
                  Provenance report: {payload.provenanceReportPath}
                </p>
              ) : null}
            </div>
          </ReviewSection>
          <ReviewSection title="Target Modules">
            <ModuleBadges modules={payload.targetModules} />
          </ReviewSection>
          <ReviewSection title="Skipped Modules">
            <TokenList items={payload.skippedModules} empty="No modules are skipped." />
          </ReviewSection>
          <ReviewSection title="Files">
            <TokenList items={files} empty="No files generated." monospace />
          </ReviewSection>
          <ReviewSection title="Removed Roles">
            <TokenList items={payload.removedRoles} empty="No generated roles will be removed." />
          </ReviewSection>
          <ReviewSection title="Validation Issues">
            <TokenList items={validationIssues} empty="No validation issues." />
          </ReviewSection>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {generated ? "Close" : "Cancel"}
          </Button>
          {!generated ? (
            <Button onClick={onConfirm} disabled={confirmDisabled}>
              {busy ? "Generating..." : actionLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AnsibleGenerationActionArea(props: {
  blueprint: ProjectBlueprintCatalogItem;
  latestGeneration?: ProjectAnsibleGenerationRecord | null;
  onGenerated?: (result: ProjectAnsibleGenerationResult) => void;
  projectId?: string | null;
  threadId?: string | null;
}) {
  const { blueprint, latestGeneration, onGenerated, projectId, threadId } = props;
  const [currentLatestGeneration, setCurrentLatestGeneration] = useState<ProjectAnsibleGenerationRecord | null>(
    latestGeneration ?? null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [payload, setPayload] = useState<AnsibleReviewPayload | null>(null);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if (latestGeneration === undefined) return;
    setCurrentLatestGeneration(latestGeneration);
  }, [latestGeneration]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || latestGeneration !== undefined || blueprint.kind !== "configuration") return undefined;
    listProjectConfigurationAnsibleHistory(projectId, 1)
      .then((items) => {
        if (!cancelled) setCurrentLatestGeneration(items[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [blueprint.kind, latestGeneration, projectId, threadId]);

  if (blueprint.kind !== "configuration" || !projectId) return null;
  const resolvedProjectId = projectId;
  const action = getAnsibleGenerationActionState(blueprint, currentLatestGeneration);

  async function openPreview() {
    setLoadingPreview(true);
    setError("");
    try {
      const preview = await previewProjectConfigurationAnsible(resolvedProjectId);
      setPayload(preview);
      setDialogOpen(true);
    } catch (nextError: unknown) {
      setError(readErrorMessage(nextError, "Ansible generation failed"));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function confirmGeneration() {
    if (!payload) return;
    setWriting(true);
    setError("");
    try {
      const result = await generateProjectConfigurationAnsible(resolvedProjectId, {
        previewToken: payload.previewToken,
        confirmWrite: true,
      });
      setPayload(result);
      setCurrentLatestGeneration(result.generation);
      onGenerated?.(result);
    } catch (nextError: unknown) {
      setError(readErrorMessage(nextError, "Ansible generation failed"));
    } finally {
      setWriting(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-[var(--da-border)] pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">Ansible</p>
          <p className="text-sm text-[var(--da-muted)]">
            {currentLatestGeneration
              ? formatAnsibleGenerationHistorySummary(currentLatestGeneration)
              : "Review deterministic playbook and role output before Ansible files are written."}
          </p>
        </div>
        {!action.blocked ? (
          <Button onClick={() => void openPreview()} disabled={loadingPreview || writing}>
            {loadingPreview ? "Loading Review..." : action.actionLabel}
          </Button>
        ) : null}
      </div>
      {action.blockedReason ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
          <AlertTitle>Ansible blocked</AlertTitle>
          <AlertDescription>{action.blockedReason}</AlertDescription>
        </Alert>
      ) : null}
      {error && !dialogOpen ? (
        <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
          <AlertTitle>Ansible generation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <AnsibleGenerationReviewDialog
        actionLabel={action.actionLabel}
        busy={writing}
        error={dialogOpen ? error : ""}
        open={dialogOpen}
        payload={payload}
        onConfirm={() => void confirmGeneration()}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

export function BlueprintProvenancePanel({
  heading,
  blueprint,
  footer,
  note,
}: {
  heading: string;
  blueprint: ProjectBlueprintCatalogItem;
  footer?: ReactNode;
  note?: string | null;
}) {
  return (
    <Card className="border-[var(--da-border)] bg-[var(--da-elevated)]">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">{heading}</p>
            <CardTitle className="mt-2 text-lg">{blueprint.name}</CardTitle>
          </div>
          <Badge>{blueprint.kind}</Badge>
        </div>
        <p className="text-sm text-[var(--da-muted)]">{blueprint.summary}</p>
        {note ? <p className="text-xs text-[var(--da-muted)]">{note}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">Resources / Actions</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {blueprint.resourcesOrActions.map((item) => (
              <Badge key={item} variant="outline">
                {item}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">Required Inputs</p>
          <div className="mt-2">
            <InputBadges items={blueprint.requiredInputs} />
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">Step List</p>
          <StepList blueprint={blueprint} />
        </div>
        {footer}
      </CardContent>
    </Card>
  );
}

export function BlueprintProvenanceCard(props: ToolCallMessagePartProps) {
  const args = (props.args as Record<string, unknown> | undefined) ?? {};
  const result = props.result as {
    source?: "selection" | "run";
    createdAt?: string | null;
    blueprint?: ProjectBlueprintCatalogItem;
  } | null;
  if (!result?.blueprint) return null;
  const note =
    result.source === "run" && result.createdAt
      ? `Snapshot created at ${result.createdAt}`
      : "Approved blueprint provenance";
  const projectId = readString(args.projectId);
  const threadId = readString(args.threadId);

  return (
    <BlueprintProvenancePanel
      heading="Blueprint Provenance"
      blueprint={result.blueprint}
      footer={
        result.blueprint.kind === "provisioning" ? (
          <TerraformGenerationActionArea
            key={`${projectId}:${threadId}:terraform`}
            blueprint={result.blueprint}
            projectId={projectId}
            threadId={threadId}
          />
        ) : (
          <AnsibleGenerationActionArea
            key={`${projectId}:${threadId}:ansible`}
            blueprint={result.blueprint}
            projectId={projectId}
            threadId={threadId}
          />
        )
      }
      note={note}
    />
  );
}
