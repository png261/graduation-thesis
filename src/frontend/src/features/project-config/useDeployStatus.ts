import { useEffect, useMemo, useState } from "react";

import {
  getProjectRunHistory,
  getOpenTofuDeployPreflight,
  getOpenTofuStatus,
  validateOpenTofuTargetContract,
  type OpenTofuDeployChecklistItem,
  type OpenTofuDeployPreflight,
  type OpenTofuStatus,
  type ProjectPostDeploySummary,
  type ProjectRunHistoryItem,
  type ProjectSsmReadiness,
  type ProjectTerraformTargetContract,
} from "../../api/projects";

const DEPLOY_CHECKLIST_ORDER = [
  "Saved AWS credentials",
  "Generated Terraform",
  "Generated Ansible",
  "Reviewed plan",
  "Primary backend drift refresh",
] as const;

function deployDisabledMessage(deployStatus: OpenTofuStatus | null, deployError: string): string {
  if (deployError) return deployError;
  if (!deployStatus) return "Loading deploy status...";
  if (!deployStatus.opentofu_available) return "OpenTofu CLI unavailable on backend host.";
  if (deployStatus.modules.length === 0) return "No modules found in /modules.";
  return "";
}

function fallbackChecklistItem(
  name: (typeof DEPLOY_CHECKLIST_ORDER)[number],
  deployPreflight: OpenTofuDeployPreflight,
): OpenTofuDeployChecklistItem {
  if (name === "Saved AWS credentials") {
    const missing = deployPreflight.credential_gate.missing_fields.join(", ");
    return {
      name,
      ready: !deployPreflight.credential_gate.blocking,
      code: "credentials_missing",
      message: deployPreflight.credential_gate.blocking
        ? `Missing saved AWS credentials: ${missing}`
        : "Saved AWS credentials are ready.",
    };
  }
  if (name === "Generated Terraform") {
    if (!deployPreflight.generation_gate.terraform_generated) {
      return {
        name,
        ready: false,
        code: "terraform_generation_missing",
        message: "Generated Terraform is not ready for deploy.",
      };
    }
    if (deployPreflight.generation_gate.target_contract_stale) {
      return {
        name,
        ready: false,
        code: "terraform_target_contract_stale",
        message: "Terraform target preview is stale. Refresh Target Preview before deploy.",
      };
    }
    if (!deployPreflight.generation_gate.target_contract_ready) {
      const invalid = deployPreflight.target_contract.status === "invalid";
      return {
        name,
        ready: false,
        code: invalid ? "terraform_target_contract_invalid" : "terraform_target_contract_missing",
        message: invalid
          ? deployPreflight.target_contract.validation_errors[0] || "Terraform target preview is invalid."
          : "No validated Terraform targets available yet.",
      };
    }
    return {
      name,
      ready: true,
      code: "terraform_ready",
      message: "Generated Terraform is ready.",
    };
  }
  if (name === "Generated Ansible") {
    return {
      name,
      ready: deployPreflight.generation_gate.ansible_ready,
      code: deployPreflight.generation_gate.ansible_required ? "ansible_generation_missing" : "ansible_not_required",
      message: deployPreflight.generation_gate.ansible_ready
        ? deployPreflight.generation_gate.ansible_required
          ? "Generated Ansible is ready."
          : "Generated Terraform does not require Ansible."
        : "Generated Ansible is not ready for deploy.",
    };
  }
  if (name === "Reviewed plan") {
    return {
      name,
      ready: !deployPreflight.review_gate.blocking,
      code: String(deployPreflight.review_gate.status),
      message: deployPreflight.review_gate.message,
    };
  }
  return {
    name,
    ready: !deployPreflight.drift_refresh.blocking,
    code: deployPreflight.drift_refresh.status,
    message: deployPreflight.drift_refresh.reason,
  };
}

function orderedDeployChecklist(deployPreflight: OpenTofuDeployPreflight | null): OpenTofuDeployChecklistItem[] {
  if (!deployPreflight) return [];
  const itemsByName = new Map(deployPreflight.checklist.map((item) => [item.name, item]));
  return DEPLOY_CHECKLIST_ORDER.map(
    (name) => itemsByName.get(name) ?? fallbackChecklistItem(name, deployPreflight),
  );
}

function latestPostDeployItem(items: ProjectRunHistoryItem[]): ProjectRunHistoryItem | null {
  return (
    items.find((item) => Boolean(item.post_deploy_summary) && Boolean(item.stage_summary?.post_deploy))
    ?? items.find((item) => Boolean(item.post_deploy_summary))
    ?? items.find((item) => Boolean(item.stage_summary?.post_deploy))
    ?? null
  );
}

function applyPreflightState(
  data: OpenTofuDeployPreflight,
  setDeployPreflight: (value: OpenTofuDeployPreflight | null) => void,
  setTargetContract: (value: ProjectTerraformTargetContract | null) => void,
  setSsmReadiness: (value: ProjectSsmReadiness | null) => void,
) {
  setDeployPreflight(data);
  setTargetContract(data.target_contract);
  setSsmReadiness(data.ssm_readiness);
}

function loadDeployStatus(
  projectId: string,
  setDeployStatus: (value: OpenTofuStatus | null) => void,
  setDeployError: (value: string) => void,
  setDeployPreflight: (value: OpenTofuDeployPreflight | null) => void,
  setTargetContract: (value: ProjectTerraformTargetContract | null) => void,
  setSsmReadiness: (value: ProjectSsmReadiness | null) => void,
  setDeployPreflightError: (value: string) => void,
  setLatestPostDeploy: (value: ProjectPostDeploySummary | null) => void,
  setLatestPostDeployRunId: (value: string | null) => void,
  setLatestPostDeployStatus: (value: string) => void,
  cancelled: () => boolean,
) {
  setDeployError("");
  setDeployPreflightError("");
  void getOpenTofuStatus(projectId)
    .then((data) => {
      if (!cancelled()) setDeployStatus(data);
    })
    .catch((error: unknown) => {
      if (cancelled()) return;
      setDeployStatus(null);
      setDeployError(error instanceof Error ? error.message : "Failed to load deploy status");
    });
  void getOpenTofuDeployPreflight(projectId)
    .then((data) => {
      if (cancelled()) return;
      applyPreflightState(data, setDeployPreflight, setTargetContract, setSsmReadiness);
    })
    .catch((error: unknown) => {
      if (cancelled()) return;
      setDeployPreflight(null);
      setTargetContract(null);
      setSsmReadiness(null);
      setDeployPreflightError(error instanceof Error ? error.message : "Failed to load deploy readiness");
    });
  void getProjectRunHistory(projectId, { limit: 20, offset: 0 })
    .then((data) => {
      if (cancelled()) return;
      const latest = latestPostDeployItem(data.items);
      setLatestPostDeploy(latest?.post_deploy_summary ?? null);
      setLatestPostDeployRunId(latest?.id ?? null);
      setLatestPostDeployStatus(latest?.stage_summary?.post_deploy?.status ?? latest?.post_deploy_summary?.status ?? "");
    })
    .catch(() => {
      if (cancelled()) return;
      setLatestPostDeploy(null);
      setLatestPostDeployRunId(null);
      setLatestPostDeployStatus("");
    });
}

export function useDeployStatus(projectId: string) {
  const [deployStatus, setDeployStatus] = useState<OpenTofuStatus | null>(null);
  const [deployError, setDeployError] = useState("");
  const [deployPreflight, setDeployPreflight] = useState<OpenTofuDeployPreflight | null>(null);
  const [targetContract, setTargetContract] = useState<ProjectTerraformTargetContract | null>(null);
  const [ssmReadiness, setSsmReadiness] = useState<ProjectSsmReadiness | null>(null);
  const [deployPreflightError, setDeployPreflightError] = useState("");
  const [targetContractRefreshBusy, setTargetContractRefreshBusy] = useState(false);
  const [targetContractRefreshError, setTargetContractRefreshError] = useState("");
  const [latestPostDeploy, setLatestPostDeploy] = useState<ProjectPostDeploySummary | null>(null);
  const [latestPostDeployRunId, setLatestPostDeployRunId] = useState<string | null>(null);
  const [latestPostDeployStatus, setLatestPostDeployStatus] = useState("");
  const [deployOpen, setDeployOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const refresh = () =>
      loadDeployStatus(
        projectId,
        setDeployStatus,
        setDeployError,
        setDeployPreflight,
        setTargetContract,
        setSsmReadiness,
        setDeployPreflightError,
        setLatestPostDeploy,
        setLatestPostDeployRunId,
        setLatestPostDeployStatus,
        isCancelled,
      );
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId]);

  const deployDisabledReason = useMemo(
    () => deployDisabledMessage(deployStatus, deployError),
    [deployError, deployStatus],
  );
  const primaryBlockingReason = useMemo(() => {
    if (deployPreflightError) return deployPreflightError;
    return deployPreflight?.primary_blocker_message || "";
  }, [deployPreflight, deployPreflightError]);
  const deployChecklist = useMemo(
    () => orderedDeployChecklist(deployPreflight),
    [deployPreflight],
  );

  async function refreshTargetContract() {
    setTargetContractRefreshBusy(true);
    setTargetContractRefreshError("");
    try {
      await validateOpenTofuTargetContract(projectId);
      const nextPreflight = await getOpenTofuDeployPreflight(projectId);
      applyPreflightState(nextPreflight, setDeployPreflight, setTargetContract, setSsmReadiness);
      setDeployPreflightError("");
    } catch (error: unknown) {
      setTargetContractRefreshError(
        error instanceof Error ? error.message : "Failed to refresh Terraform target preview.",
      );
    } finally {
      setTargetContractRefreshBusy(false);
    }
  }

  return {
    deployStatus,
    deployError,
    deployOpen,
    setDeployOpen,
    deployDisabledReason,
    deployPreflight,
    deployPreflightError,
    targetContract,
    ssmReadiness,
    refreshTargetContract,
    targetContractRefreshBusy,
    targetContractRefreshError,
    primaryBlockingReason,
    deployChecklist,
    latestPostDeploy,
    latestPostDeployRunId,
    latestPostDeployStatus,
  };
}
