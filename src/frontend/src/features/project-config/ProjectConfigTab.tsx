import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { OpenTofuDeployModal } from "./OpenTofuDeployModal";
import { PullRequestModal } from "./PullRequestModal";
import { AgentSettingsSection, CredentialsSection, GeneralSettingsSection } from "./sections";
import { useProjectConfigState } from "./useProjectConfigState";

type ConfigTab = "agent" | "credentials" | "general";

interface ProjectConfigTabProps {
  projectId: string;
  projectName: string;
  provider: string | null | undefined;
  projectCount: number;
  onDeleteProject: () => Promise<void>;
  onOpenRunDetails: (runId: string) => void;
}

function ProjectConfigHeader({ projectName }: { projectName: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--da-muted)]">Project Config</p>
      <h2 className="text-lg font-semibold">{projectName}</h2>
    </div>
  );
}

function ProjectConfigTabs({
  state,
  projectId,
  provider,
  projectName,
  projectCount,
  onOpenRunDetails,
}: {
  state: ReturnType<typeof useProjectConfigState>;
  projectId: string;
  provider: string | null | undefined;
  projectName: string;
  projectCount: number;
  onOpenRunDetails: (runId: string) => void;
}) {
  return (
    <Tabs value={state.configTab} onValueChange={(value) => state.setConfigTab(value as ConfigTab)}>
      <ProjectConfigTabsHeader />
      <ProjectConfigTabsContent
        state={state}
        projectId={projectId}
        provider={provider}
        projectName={projectName}
        projectCount={projectCount}
        onOpenRunDetails={onOpenRunDetails}
      />
    </Tabs>
  );
}

function ProjectConfigTabsHeader() {
  return (
    <TabsList className="grid h-auto w-full grid-cols-3 gap-1 p-1">
      <TabsTrigger value="agent">Agent Settings</TabsTrigger>
      <TabsTrigger value="credentials">Credentials</TabsTrigger>
      <TabsTrigger value="general">General Settings</TabsTrigger>
    </TabsList>
  );
}

function ProjectConfigTabsContent({
  state,
  projectId,
  provider,
  projectName,
  projectCount,
  onOpenRunDetails,
}: {
  state: ReturnType<typeof useProjectConfigState>;
  projectId: string;
  provider: string | null | undefined;
  projectName: string;
  projectCount: number;
  onOpenRunDetails: (runId: string) => void;
}) {
  return (
    <>
      <TabsContent value="agent" forceMount className="data-[state=inactive]:hidden">
        <AgentSettingsSection projectId={projectId} />
      </TabsContent>
      <TabsContent value="credentials" forceMount className="data-[state=inactive]:hidden">
        <CredentialsSection state={state} provider={provider} />
      </TabsContent>
      <TabsContent value="general" forceMount className="data-[state=inactive]:hidden">
        <GeneralSettingsSection
          state={state}
          projectName={projectName}
          projectCount={projectCount}
          onOpenRunDetails={onOpenRunDetails}
        />
      </TabsContent>
    </>
  );
}

function DeployModalGate({
  projectId,
  projectName,
  state,
}: {
  projectId: string;
  projectName: string;
  state: ReturnType<typeof useProjectConfigState>;
}) {
  if (!state.deployOpen || !state.deployStatus) return null;
  return (
    <OpenTofuDeployModal
      projectId={projectId}
      projectName={projectName}
      status={state.deployStatus}
      onClose={() => state.setDeployOpen(false)}
    />
  );
}

function onPullRequestCreated(state: ReturnType<typeof useProjectConfigState>, url: string) {
  state.setLastPullRequestUrl(url);
  state.setPullRequestModalOpen(false);
}

function PullRequestModalGate({ projectId, state }: { projectId: string; state: ReturnType<typeof useProjectConfigState> }) {
  if (!state.pullRequestModalOpen || !state.githubStatus?.connected) return null;
  return (
    <PullRequestModal
      projectId={projectId}
      defaultBaseBranch={state.githubStatus.base_branch || "main"}
      workingBranch={state.githubStatus.working_branch || "infra/project"}
      onClose={() => state.setPullRequestModalOpen(false)}
      onCreated={(url) => onPullRequestCreated(state, url)}
    />
  );
}

export function ProjectConfigTab({
  projectId,
  projectName,
  provider,
  projectCount,
  onDeleteProject,
  onOpenRunDetails,
}: ProjectConfigTabProps) {
  const state = useProjectConfigState({ projectId, provider, onDeleteProject });
  return (
    <div className="space-y-3">
      <ProjectConfigHeader projectName={projectName} />
      <ProjectConfigTabs
        state={state}
        projectId={projectId}
        provider={provider}
        projectName={projectName}
        projectCount={projectCount}
        onOpenRunDetails={onOpenRunDetails}
      />
      <DeployModalGate projectId={projectId} projectName={projectName} state={state} />
      <PullRequestModalGate projectId={projectId} state={state} />
    </div>
  );
}
