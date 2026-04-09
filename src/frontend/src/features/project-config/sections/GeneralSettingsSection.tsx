import type { ProjectConfigState } from "../useProjectConfigState";
import { DangerZoneSection } from "./DangerZoneSection";
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
    <div>
      <GitHubSection state={state} />
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
