import type { ProjectConfigState } from "../useProjectConfigState";
import { DangerZoneSection } from "./DangerZoneSection";
import { DeploySection } from "./DeploySection";
import { GitHubSection } from "./GitHubSection";

export function GeneralSettingsSection({
  state,
  projectName,
  projectCount,
  onOpenRunDetails,
}: {
  state: ProjectConfigState;
  projectName: string;
  projectCount: number;
  onOpenRunDetails: (runId: string) => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <GitHubSection state={state} />

      <DeploySection
        canDeploy={Boolean(state.deployStatus?.opentofu_available && state.deployStatus?.modules.length)}
        disabledReason={state.deployDisabledReason}
        primaryBlockingReason={state.primaryBlockingReason}
        checklist={state.deployChecklist}
        targetContract={state.targetContract}
        ssmReadiness={state.ssmReadiness}
        targetContractRefreshBusy={state.targetContractRefreshBusy}
        targetContractRefreshError={state.targetContractRefreshError}
        latestPostDeploy={state.latestPostDeploy}
        latestPostDeployRunId={state.latestPostDeployRunId}
        latestPostDeployStatus={state.latestPostDeployStatus}
        onOpenDeploy={() => state.setDeployOpen(true)}
        onRefreshTargetContract={() => {
          void state.refreshTargetContract();
        }}
        onOpenRunDetails={onOpenRunDetails}
      />

      <DangerZoneSection
        projectName={projectName}
        projectCount={projectCount}
        deleteBusy={state.deleteBusy}
        deleteError={state.deleteError}
        onDelete={() => {
          void state.handleDeleteProject();
        }}
      />
    </div>
  );
}
