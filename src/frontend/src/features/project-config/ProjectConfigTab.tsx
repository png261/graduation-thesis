import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { PullRequestModal } from "./PullRequestModal";
import { CredentialsSection, GeneralSettingsSection } from "./sections";
import { useProjectConfigState } from "./useProjectConfigState";

type ConfigTab = "credentials" | "general";

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
      <p className="text-sm font-medium text-[var(--da-muted)]">Project configuration</p>
      <h2 className="text-2xl font-semibold tracking-tight text-[var(--da-text)]">{projectName}</h2>
    </div>
  );
}

function ProjectConfigTabs({
  state,
  provider,
  projectName,
  projectCount,
  onOpenRunDetails,
}: {
  state: ReturnType<typeof useProjectConfigState>;
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
    <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1">
      <TabsTrigger value="credentials">Credentials</TabsTrigger>
      <TabsTrigger value="general">General Settings</TabsTrigger>
    </TabsList>
  );
}

function ProjectConfigTabsContent({
  state,
  provider,
  projectName,
  projectCount,
  onOpenRunDetails,
}: {
  state: ReturnType<typeof useProjectConfigState>;
  provider: string | null | undefined;
  projectName: string;
  projectCount: number;
  onOpenRunDetails: (runId: string) => void;
}) {
  return (
    <>
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

function onPullRequestCreated(state: ReturnType<typeof useProjectConfigState>, url: string) {
  state.setLastPullRequestUrl(url);
  state.setPullRequestModalOpen(false);
}

function PullRequestModalGate({
  projectId,
  state,
}: {
  projectId: string;
  state: ReturnType<typeof useProjectConfigState>;
}) {
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
    <div className="space-y-4">
      <ProjectConfigHeader projectName={projectName} />
      <ProjectConfigTabs
        state={state}
        provider={provider}
        projectName={projectName}
        projectCount={projectCount}
        onOpenRunDetails={onOpenRunDetails}
      />
      <PullRequestModalGate projectId={projectId} state={state} />
    </div>
  );
}
