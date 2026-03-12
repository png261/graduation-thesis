import { useState } from "react";

import { useCredentialsState } from "./useCredentialsState";
import { useDeleteProjectState } from "./useDeleteProjectState";
import { useDeployStatus } from "./useDeployStatus";
import { useGitHubConfigState } from "./useGitHubConfigState";
import { useTelegramConfigState } from "./useTelegramConfigState";

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
  const telegram = useTelegramConfigState(projectId);
  const credentials = useCredentialsState(projectId, provider);
  const deletion = useDeleteProjectState(onDeleteProject);

  return {
    ...deploy,
    ...github,
    ...telegram,
    ...credentials,
    ...deletion,
    configTab,
    setConfigTab,
  };
}

export type ProjectConfigState = ReturnType<typeof useProjectConfigState>;
