import { useEffect, useMemo, useState } from "react";

import { getOpenTofuStatus, type OpenTofuStatus } from "../../api/projects/index";

export function useDeployStatus(projectId: string) {
  const [deployStatus, setDeployStatus] = useState<OpenTofuStatus | null>(null);
  const [deployError, setDeployError] = useState("");
  const [deployOpen, setDeployOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = () => {
      setDeployError("");
      getOpenTofuStatus(projectId)
        .then((data) => {
          if (!cancelled) setDeployStatus(data);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setDeployStatus(null);
          setDeployError(error instanceof Error ? error.message : "Failed to load deploy status");
        });
    };

    loadStatus();
    const timer = setInterval(loadStatus, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId]);

  const deployDisabledReason = useMemo(
    () =>
      deployError ||
      (!deployStatus
        ? "Loading deploy status..."
        : !deployStatus.opentofu_available
          ? "OpenTofu CLI unavailable on backend host."
          : deployStatus.modules.length === 0
            ? "No modules found in /modules."
            : !deployStatus.credential_ready
              ? `Plan available. Apply needs credentials: ${deployStatus.missing_credentials.join(", ")}`
              : ""),
    [deployError, deployStatus],
  );

  return {
    deployStatus,
    deployError,
    deployOpen,
    setDeployOpen,
    deployDisabledReason,
  };
}
