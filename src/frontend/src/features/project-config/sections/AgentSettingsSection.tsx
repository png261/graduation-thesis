import { ProjectAgentSettings } from "../../../components/ProjectAgentSettings";

export function AgentSettingsSection({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-3">
      <ProjectAgentSettings projectId={projectId} />
    </div>
  );
}
