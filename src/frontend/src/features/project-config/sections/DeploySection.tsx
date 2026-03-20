import type {
  OpenTofuDeployChecklistItem,
  ProjectPostDeploySummary,
  ProjectSsmReadiness,
  ProjectTerraformTargetContract,
} from "../../../api/projects";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

function DeployChecklistRow({ item }: { item: OpenTofuDeployChecklistItem }) {
  return (
    <div className="rounded border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-white">{item.name}</p>
        <span className={`rounded border border-white/10 px-2 py-0.5 text-[11px] uppercase ${item.ready ? "text-emerald-300" : "text-amber-300"}`}>
          {item.ready ? "Ready" : "Blocked"}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--da-muted)]">{item.message}</p>
    </div>
  );
}

function targetPreviewStatus(targetContract: ProjectTerraformTargetContract | null) {
  if (!targetContract) return "unvalidated";
  if (targetContract.stale) return "stale";
  return targetContract.status;
}

function renderTargetAlerts(
  targetContract: ProjectTerraformTargetContract | null,
  refreshError: string,
) {
  if (refreshError) {
    return (
      <Alert className="border-red-500/30 bg-red-500/10 text-red-100">
        <AlertTitle>Target preview invalid</AlertTitle>
        <AlertDescription>{refreshError}</AlertDescription>
      </Alert>
    );
  }
  if (targetContract?.stale) {
    return (
      <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-100">
        <AlertTitle>Target preview stale</AlertTitle>
        <AlertDescription>Terraform changed after the last target validation. Refresh Target Preview before deploy.</AlertDescription>
      </Alert>
    );
  }
  if (targetContract?.status === "invalid") {
    return (
      <Alert className="border-red-500/30 bg-red-500/10 text-red-100">
        <AlertTitle>Target preview invalid</AlertTitle>
        <AlertDescription>{targetContract.validation_errors[0] || "Terraform target validation failed."}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

export function TerraformTargetHandoffPanel({
  targetContract,
  refreshBusy,
  refreshError,
  onRefresh,
}: {
  targetContract: ProjectTerraformTargetContract | null;
  refreshBusy: boolean;
  refreshError: string;
  onRefresh: () => void;
}) {
  const targets = targetContract?.targets ?? [];
  return (
    <div className="space-y-3 rounded border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Terraform Target Handoff</p>
          <p className="mt-1 text-xs text-[var(--da-muted)]">Review the canonical Terraform target preview before apply.</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshBusy}>
          {refreshBusy ? "Refreshing..." : "Refresh Target Preview"}
        </Button>
      </div>
      {renderTargetAlerts(targetContract, refreshError)}
      <div className="grid gap-2 text-xs text-[var(--da-muted)] md:grid-cols-2">
        <p><span className="font-semibold text-white">Target preview status</span>: {targetPreviewStatus(targetContract)}</p>
        <p><span className="font-semibold text-white">Validated at</span>: {targetContract?.validated_at || "-"}</p>
      </div>
      {targets.length > 0 ? (
        <div className="space-y-2">
          {targets.map((target) => (
            <div key={target.execution_id} className="rounded border border-white/10 bg-black/20 p-3 text-xs text-[var(--da-muted)]">
              <p><span className="font-semibold text-white">Execution ID</span>: {target.execution_id}</p>
              <p><span className="font-semibold text-white">Role</span>: {target.role}</p>
              <p><span className="font-semibold text-white">Source modules</span>: {target.source_modules.join(", ")}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--da-muted)]">No validated Terraform targets available yet.</p>
      )}
    </div>
  );
}

export function DeploySection({
  canDeploy,
  disabledReason,
  primaryBlockingReason,
  checklist,
  targetContract,
  ssmReadiness,
  targetContractRefreshBusy,
  targetContractRefreshError,
  latestPostDeploy,
  latestPostDeployRunId,
  latestPostDeployStatus,
  onOpenDeploy,
  onRefreshTargetContract,
  onOpenRunDetails,
}: {
  canDeploy: boolean;
  disabledReason: string;
  primaryBlockingReason: string;
  checklist: OpenTofuDeployChecklistItem[];
  targetContract: ProjectTerraformTargetContract | null;
  ssmReadiness: ProjectSsmReadiness | null;
  targetContractRefreshBusy: boolean;
  targetContractRefreshError: string;
  latestPostDeploy: ProjectPostDeploySummary | null;
  latestPostDeployRunId: string | null;
  latestPostDeployStatus: string;
  onOpenDeploy: () => void;
  onRefreshTargetContract: () => void;
  onOpenRunDetails: (runId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Deploy</CardTitle>
        <CardDescription>Plan infrastructure, apply it, or run one ordered deploy that continues into generated Ansible configuration.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full" onClick={onOpenDeploy} disabled={!canDeploy}>
          Deploy Infrastructure + Config
        </Button>
        <p className="text-xs text-[var(--da-muted)]">{disabledReason || "Project is ready to deploy."}</p>
        <div className="space-y-1">
          <p className="text-sm font-semibold">Primary blocker</p>
          <p className="text-xs text-[var(--da-muted)]">{primaryBlockingReason || "No active blocker."}</p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Deploy Readiness Checklist</p>
          {checklist.length > 0 ? (
            checklist.map((item) => <DeployChecklistRow key={item.name} item={item} />)
          ) : (
            <p className="rounded border border-white/10 bg-black/20 p-3 text-xs text-[var(--da-muted)]">
              Loading deploy readiness...
            </p>
          )}
        </div>
        <TerraformTargetHandoffPanel
          targetContract={targetContract}
          refreshBusy={targetContractRefreshBusy}
          refreshError={targetContractRefreshError}
          onRefresh={onRefreshTargetContract}
        />
        <div className="space-y-3 rounded border border-white/10 bg-black/20 p-3">
          <div>
            <p className="text-sm font-semibold text-white">SSM readiness</p>
            <p className="mt-1 text-xs text-[var(--da-muted)]">Summary-only AWS Systems Manager readiness for the current scope.</p>
          </div>
          <div className="grid gap-2 text-xs text-[var(--da-muted)] md:grid-cols-2">
            <p><span className="font-semibold text-white">Status</span>: {ssmReadiness?.status || "unavailable"}</p>
            <p><span className="font-semibold text-white">Targets ready</span>: {ssmReadiness?.ready_target_count ?? 0}</p>
            <p><span className="font-semibold text-white">Targets pending</span>: {ssmReadiness?.pending_target_count ?? 0}</p>
            <p><span className="font-semibold text-white">Targets failed</span>: {ssmReadiness?.failed_target_count ?? 0}</p>
            <p><span className="font-semibold text-white">Last checked</span>: {ssmReadiness?.checked_at || "-"}</p>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Latest post-deploy status</p>
          {!latestPostDeploy ? (
            <p className="rounded border border-white/10 bg-black/20 p-3 text-xs text-[var(--da-muted)]">
              Post-deploy checks will appear after the first successful configuration run.
            </p>
          ) : latestPostDeployStatus === "failed" ? (
            <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-100">
              <p><span className="font-semibold text-white">Run</span>: {latestPostDeployRunId || "-"}</p>
              <p><span className="font-semibold text-white">Status</span>: {latestPostDeploy.status}</p>
              <p><span className="font-semibold text-white">Collected hosts</span>: {latestPostDeploy.host_count}</p>
              <p><span className="font-semibold text-white">Health summary</span>: {latestPostDeploy.health_summary}</p>
              <p>The latest post-deploy collection failed. Open full run details for host-level diagnostics.</p>
              {latestPostDeployRunId ? (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenRunDetails(latestPostDeployRunId)}
                >
                  Open full run details
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="rounded border border-white/10 bg-black/20 p-3 text-xs text-[var(--da-muted)]">
              <p><span className="font-semibold text-white">Run</span>: {latestPostDeployRunId || "-"}</p>
              <p><span className="font-semibold text-white">Status</span>: {latestPostDeploy.status}</p>
              <p><span className="font-semibold text-white">Collected hosts</span>: {latestPostDeploy.host_count}</p>
              <p><span className="font-semibold text-white">Health summary</span>: {latestPostDeploy.health_summary}</p>
              {latestPostDeployRunId ? (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenRunDetails(latestPostDeployRunId)}
                >
                  Open full run details
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
