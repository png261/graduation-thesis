import { useState } from "react";

import {
  applyOpenTofuDeployStream,
  planOpenTofuDeployStream,
  previewOpenTofuDeploy,
  type OpenTofuPreviewResult,
  type OpenTofuStatus,
} from "../../api/projects/index";
import { readSseJson } from "../../lib/sse";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Textarea } from "../../components/ui/textarea";

export function OpenTofuDeployModal({
  projectId,
  status,
  onClose,
}: {
  projectId: string;
  status: OpenTofuStatus;
  onClose: () => void;
}) {
  const [intent, setIntent] = useState("");
  const [preview, setPreview] = useState<OpenTofuPreviewResult | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [runStatus, setRunStatus] = useState<"ok" | "failed" | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");

  const canPreview = status.opentofu_available;
  const canPlan = !applying && !planning && selectedModules.length > 0 && status.opentofu_available;
  const canApply = canPlan && status.credential_ready;

  const loadPreview = async () => {
    setLoadingPreview(true);
    setError("");
    setRunStatus(null);
    setLogs([]);
    try {
      const data = await previewOpenTofuDeploy(projectId, intent);
      setPreview(data);
      setSelectedModules(data.selected_modules ?? []);
      if (data.status !== "ok") setError(data.message ?? "Preview failed");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggleModule = (module: string) => {
    setSelectedModules((prev) => (prev.includes(module) ? prev.filter((m) => m !== module) : [...prev, module]));
  };

  const run = async (mode: "plan" | "apply") => {
    if (selectedModules.length === 0) {
      setError("Select at least one module");
      return;
    }

    if (mode === "apply") setApplying(true);
    if (mode === "plan") setPlanning(true);
    setRunStatus(null);
    setError("");
    setLogs([]);

    try {
      const response =
        mode === "apply"
          ? await applyOpenTofuDeployStream(projectId, selectedModules, intent)
          : await planOpenTofuDeployStream(projectId, selectedModules, intent);

      if (!response.ok || !response.body) {
        throw new Error(`${mode === "apply" ? "Apply" : "Plan"} request failed (${response.status})`);
      }

      for await (const event of readSseJson(response)) {
        const type = String(event?.type ?? "");
        if (type === "deploy.start" || type === "plan.start") {
          const prefix = type === "plan.start" ? "Starting plan" : "Starting deploy";
          setLogs((prev) => [...prev, `${prefix}: ${(event.modules ?? []).join(", ")}`]);
          continue;
        }
        if (type === "module.start") {
          setLogs((prev) => [...prev, `\n==> Module: ${event.module}`]);
          continue;
        }
        if (type === "log") {
          setLogs((prev) => [...prev, String(event.line ?? "")]);
          continue;
        }
        if (type === "module.done") {
          setLogs((prev) => [...prev, `Module ${event.module}: ${event.status}`]);
          continue;
        }
        if (type === "error") {
          setError(String(event.message ?? "Apply failed"));
          continue;
        }
        if (type === "deploy.done" || type === "plan.done") {
          setRunStatus(event.status === "ok" ? "ok" : "failed");
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Run failed");
      setRunStatus("failed");
    } finally {
      setApplying(false);
      setPlanning(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>OpenTofu Deploy</DialogTitle>
          <DialogDescription>Preview target modules then run plan/apply with streaming logs.</DialogDescription>
        </DialogHeader>

        {!status.opentofu_available && (
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
            <AlertTitle>OpenTofu unavailable</AlertTitle>
            <AlertDescription>OpenTofu CLI is not available on backend host.</AlertDescription>
          </Alert>
        )}
        {status.opentofu_available && !status.credential_ready && (
          <Alert className="border-blue-500/40 bg-blue-500/10 text-blue-100">
            <AlertTitle>Plan available without credentials</AlertTitle>
            <AlertDescription>
              Run Plan to check changes. Add credentials to use Apply.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Textarea
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Optional deploy intent"
            className="min-h-24"
          />
          <Button onClick={loadPreview} disabled={loadingPreview || !canPreview}>
            {loadingPreview ? "Previewing..." : "Preview Targets"}
          </Button>
        </div>

        {preview && (
          <Card className="bg-[var(--da-elevated)]">
            <CardHeader>
              <CardTitle className="text-base">Agent rationale</CardTitle>
              <CardDescription>{preview.reason}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {preview.modules.map((module) => (
                <label key={module} className="flex items-center gap-2 text-sm text-[var(--da-text)]">
                  <input type="checkbox" checked={selectedModules.includes(module)} onChange={() => toggleModule(module)} />
                  <code>{module}</code>
                </label>
              ))}
              {preview.modules.length === 0 && <p className="text-sm text-[var(--da-muted)]">No modules found.</p>}
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-end gap-2">
          {runStatus === "ok" && <span className="text-xs text-green-300">Completed successfully</span>}
          {runStatus === "failed" && <span className="text-xs text-red-300">Run failed</span>}
          <Button variant="outline" onClick={() => run("plan")} disabled={!canPlan}>
            {planning ? "Planning..." : "Run Plan"}
          </Button>
          <Button onClick={() => run("apply")} disabled={!canApply}>
            {applying ? "Applying..." : "Confirm & Apply"}
          </Button>
        </div>

        {error && (
          <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <ScrollArea className="h-52 rounded-md border border-[var(--da-border)] bg-[var(--da-bg)] p-3 font-mono text-xs text-blue-100/90">
          {logs.length === 0 ? (
            <p className="text-[var(--da-muted)]">Run logs will appear here...</p>
          ) : (
            logs.map((line, idx) => <div key={`${idx}-${line.slice(0, 12)}`}>{line}</div>)
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
