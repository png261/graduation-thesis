import { useState } from "react";

import { useCredentialsState } from "./useCredentialsState";
import { useDeleteProjectState } from "./useDeleteProjectState";
import { useDeployStatus } from "./useDeployStatus";
import { useGitHubConfigState } from "./useGitHubConfigState";

export interface UseProjectConfigStateArgs {
  projectId: string;
  provider: string | null | undefined;
  onDeleteProject: () => Promise<void>;
}

export function useProjectConfigState({
  projectId,
  provider,
  onDeleteProject,
}: UseProjectConfigStateArgs) {
  const [configTab, setConfigTab] = useState<"agent" | "credentials" | "general">("credentials");

  const deploy = useDeployStatus(projectId);
  const github = useGitHubConfigState(projectId);
  const credentials = useCredentialsState(projectId, provider);
  const deletion = useDeleteProjectState(onDeleteProject);

  return {
    ...deploy,
    ...github,
    ...credentials,
    ...deletion,
    configTab,
    setConfigTab,
  };
}

export type ProjectConfigState = ReturnType<typeof useProjectConfigState>;
