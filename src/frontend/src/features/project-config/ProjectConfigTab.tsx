import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { OpenTofuDeployModal } from "./OpenTofuDeployModal";
import { PullRequestModal } from "./PullRequestModal";
import {
  AgentSettingsSection,
  CredentialsSection,
  GeneralSettingsSection,
} from "./sections";
import { useProjectConfigState } from "./useProjectConfigState";

export function ProjectConfigTab({
  projectId,
  projectName,
  provider,
  projectCount,
  onDeleteProject,
}: {
  projectId: string;
  projectName: string;
  provider: string | null | undefined;
  projectCount: number;
  onDeleteProject: () => Promise<void>;
}) {
  const state = useProjectConfigState({ projectId, provider, onDeleteProject });

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">Project Config</p>
        <h2 className="text-lg font-semibold">{projectName}</h2>
      </div>

      <Tabs value={state.configTab} onValueChange={(value) => state.setConfigTab(value as "agent" | "credentials" | "general")}>
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 p-1">
          <TabsTrigger value="agent">Agent Settings</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="general">General Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="agent" forceMount className="data-[state=inactive]:hidden">
          <AgentSettingsSection projectId={projectId} />
        </TabsContent>

        <TabsContent value="credentials" forceMount className="data-[state=inactive]:hidden">
          <CredentialsSection state={state} provider={provider} />
        </TabsContent>

        <TabsContent value="general" forceMount className="data-[state=inactive]:hidden">
          <GeneralSettingsSection state={state} projectName={projectName} projectCount={projectCount} />
        </TabsContent>
      </Tabs>

      {state.deployOpen && state.deployStatus && (
        <OpenTofuDeployModal
          projectId={projectId}
          status={state.deployStatus}
          onClose={() => state.setDeployOpen(false)}
        />
      )}

      {state.pullRequestModalOpen && state.githubStatus?.connected && (
        <PullRequestModal
          projectId={projectId}
          defaultBaseBranch={state.githubStatus.base_branch || "main"}
          workingBranch={state.githubStatus.working_branch || "infra/project"}
          onClose={() => state.setPullRequestModalOpen(false)}
          onCreated={(url) => {
            state.setLastPullRequestUrl(url);
            state.setPullRequestModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
