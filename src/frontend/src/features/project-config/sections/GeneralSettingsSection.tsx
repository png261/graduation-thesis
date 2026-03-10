import type { ProjectConfigState } from "../useProjectConfigState";
import { DangerZoneSection } from "./DangerZoneSection";
import { DeploySection } from "./DeploySection";
import { GitHubSection } from "./GitHubSection";

export function GeneralSettingsSection({
  state,
  projectName,
  projectCount,
}: {
  state: ProjectConfigState;
  projectName: string;
  projectCount: number;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <GitHubSection state={state} />

      <DeploySection
        canDeploy={Boolean(state.deployStatus?.opentofu_available && state.deployStatus?.modules.length)}
        disabledReason={state.deployDisabledReason}
        onOpenDeploy={() => state.setDeployOpen(true)}
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
