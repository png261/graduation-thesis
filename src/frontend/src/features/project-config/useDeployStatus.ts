import { useEffect, useMemo, useState } from "react";

import { getOpenTofuStatus, type OpenTofuStatus } from "../../api/projects/index";

function deployDisabledMessage(deployStatus: OpenTofuStatus | null, deployError: string): string {
  if (deployError) return deployError;
  if (!deployStatus) return "Loading deploy status...";
  if (!deployStatus.opentofu_available) return "OpenTofu CLI unavailable on backend host.";
  if (deployStatus.modules.length === 0) return "No modules found in /modules.";
  if (!deployStatus.credential_ready) {
    return `Plan available. Apply needs credentials: ${deployStatus.missing_credentials.join(", ")}`;
  }
  return "";
}

function loadDeployStatus(
  projectId: string,
  setDeployStatus: (value: OpenTofuStatus | null) => void,
  setDeployError: (value: string) => void,
  cancelled: () => boolean,
) {
  setDeployError("");
  getOpenTofuStatus(projectId)
    .then((data) => {
      if (!cancelled()) setDeployStatus(data);
    })
    .catch((error: unknown) => {
      if (cancelled()) return;
      setDeployStatus(null);
      setDeployError(error instanceof Error ? error.message : "Failed to load deploy status");
    });
}

export function useDeployStatus(projectId: string) {
  const [deployStatus, setDeployStatus] = useState<OpenTofuStatus | null>(null);
  const [deployError, setDeployError] = useState("");
  const [deployOpen, setDeployOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const refresh = () => loadDeployStatus(projectId, setDeployStatus, setDeployError, isCancelled);
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId]);

  const deployDisabledReason = useMemo(() => deployDisabledMessage(deployStatus, deployError), [deployError, deployStatus]);

  return {
    deployStatus,
    deployError,
    deployOpen,
    setDeployOpen,
    deployDisabledReason,
  };
}
