import type { AnsibleStatus, OpenTofuStatus } from "../../api/projects";

export interface AnsibleExecutionState {
  canRunConfiguration: boolean;
  canRunPipeline: boolean;
  blockedReason: string | null;
  readinessCopy: string;
  stageSummary: string;
}

const REQUIREMENT_LABELS: Record<string, string> = {
  ansible_cli_unavailable: "Ansible CLI unavailable",
  ssh_key_unavailable: "Transport key unavailable",
  playbook_missing: "Generated playbook missing",
  modules_missing: "Terraform modules missing",
  terraform_generation_missing: "Terraform generation missing",
  ansible_generation_missing: "Ansible generation missing",
  ansible_generation_stale: "Ansible generation stale",
  ansible_generation_empty: "Generated Ansible targets no modules",
  ansible_hosts_missing: "Configuration targets missing",
  invalid_ansible_hosts_output: "Configuration target outputs invalid",
  ssm_no_targets_in_scope: "No scoped Terraform targets resolved",
  ssm_target_not_ready: "Scoped SSM readiness incomplete",
  ssm_readiness_timeout: "Scoped SSM readiness timed out",
  ssm_transport_bucket_missing: "SSM transport bucket missing",
};

function joinList(items: string[]) {
  return items.join(", ");
}

function requirementLabel(code: string) {
  return REQUIREMENT_LABELS[code] ?? code;
}

function pipelineMissingRequirements(status: AnsibleStatus) {
  return status.missing_requirements.filter(
    (code) =>
      !["ansible_hosts_missing", "invalid_ansible_hosts_output", "ssm_target_not_ready"].includes(code),
  );
}

function configurationBlockedReason(status: AnsibleStatus | null) {
  if (!status) return "Configuration readiness is unavailable.";
  if (!status.configurationRequired) {
    return null;
  }
  if (status.generationStale) {
    return "Ansible generation is stale. Regenerate after the latest Terraform generation.";
  }
  if (!status.latestGeneration) {
    return "Generate Ansible before running configuration.";
  }
  if (status.ssm_ready === false || status.ssm_readiness?.blocking) {
    return status.ssm_readiness?.blocker_message || "Wait for every scoped target to become SSM-ready.";
  }
  if (status.missing_requirements.length > 0) {
    return `Resolve configuration blockers: ${joinList(status.missing_requirements.map(requirementLabel))}.`;
  }
  if (status.output_errors.length > 0) {
    return `Fix configuration target resolution issues: ${joinList(status.output_errors)}.`;
  }
  return null;
}

function configurationReadinessCopy(status: AnsibleStatus | null) {
  if (!status) return "Configuration readiness unavailable.";
  if (!status.configurationRequired) {
    return "No configuration targets were generated. Ansible is not required for this run.";
  }
  if (status.can_run && status.generationReady && status.ssm_ready && !status.ssm_readiness?.blocking) {
    return "Configuration ready. All scoped targets are SSM-ready.";
  }
  if (status.generationStale) {
    return "Configuration generation is stale relative to Terraform.";
  }
  if (!status.latestGeneration) {
    return "Generate Ansible to create the configuration playbook and scoped targets.";
  }
  return "Configuration is not ready yet.";
}

function configurationStageSummary(status: AnsibleStatus | null) {
  if (!status) return "Configuration status unavailable.";
  if (!status.configurationRequired) {
    return "No generated configuration targets require Ansible.";
  }
  if (status.latestGeneration) {
    const skipped = status.skippedModules.length > 0 ? ` Excluding ${joinList(status.skippedModules)}.` : "";
    return `Configuration scope: ${joinList(status.targetModules)}.${skipped}`;
  }
  return "Configuration has not been generated yet.";
}

export function getAnsibleExecutionState(
  opentofuStatus: OpenTofuStatus,
  ansibleStatus: AnsibleStatus | null,
): AnsibleExecutionState {
  const canRunConfiguration = Boolean(
    ansibleStatus?.configurationRequired &&
      ansibleStatus?.can_run &&
      ansibleStatus.generationReady &&
      ansibleStatus.ssm_ready &&
      !ansibleStatus.ssm_readiness?.blocking,
  );
  const baseBlockedReason = configurationBlockedReason(ansibleStatus);
  const pipelineBlocked = ansibleStatus
    ? (
      ansibleStatus.configurationRequired
        ? ansibleStatus.generationStale ||
          !ansibleStatus.latestGeneration ||
          pipelineMissingRequirements(ansibleStatus).length > 0
        : false
    )
    : true;
  if (!opentofuStatus.opentofu_available) {
    return {
      canRunConfiguration,
      canRunPipeline: false,
      blockedReason: "OpenTofu workflow is unavailable.",
      readinessCopy: configurationReadinessCopy(ansibleStatus),
      stageSummary: configurationStageSummary(ansibleStatus),
    };
  }
  if (!opentofuStatus.credential_ready) {
    return {
      canRunConfiguration,
      canRunPipeline: false,
      blockedReason: "Add cloud credentials before running the ordered deploy pipeline.",
      readinessCopy: configurationReadinessCopy(ansibleStatus),
      stageSummary: configurationStageSummary(ansibleStatus),
    };
  }
  return {
    canRunConfiguration,
    canRunPipeline: !pipelineBlocked && opentofuStatus.can_deploy,
    blockedReason: baseBlockedReason,
    readinessCopy: configurationReadinessCopy(ansibleStatus),
    stageSummary: configurationStageSummary(ansibleStatus),
  };
}
