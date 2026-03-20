import type { ProjectPostDeploySection, ProjectPostDeploySummary } from "../../api/projects";

export type DeployScopeMode = "full" | "partial";
export type DeployGateCode =
  | "saved_credentials_incomplete"
  | "generation_readiness_required"
  | "plan_review_required"
  | "plan_review_stale"
  | "destroy_plan_review_required"
  | "drift_refresh_required"
  | "drift_detected"
  | "partial_scope_confirmation_required"
  | "destroy_confirmation_required"
  | "ssm_no_targets_in_scope"
  | "ssm_target_not_ready"
  | "ssm_readiness_timeout";

const DEFAULT_DEPLOY_GUIDANCE = "Resolve the deploy blocker in the Deploy modal before retrying.";

export function createReviewSessionId(createUuid: () => string = () => crypto.randomUUID()): string {
  return createUuid();
}

export function resolveScopeMode(
  partialScopeSelected: boolean,
  _selectedModules: string[],
): DeployScopeMode {
  return partialScopeSelected ? "partial" : "full";
}

export function buildPartialScopeWarning(target: "apply" | "destroy"): string {
  if (target === "destroy") {
    return "Partial destroy is an advanced escape hatch and may leave dependent resources behind.";
  }
  return "Partial apply is an advanced escape hatch and may leave drift outside the selected scope.";
}

export function buildDestroyConfirmationExpectation(projectName: string, selectedModules: string[]) {
  return {
    helperText: "Type the project name and destroy to enable full destroy.",
    expectedKeyword: "destroy",
    expectedProjectName: projectName,
    expectedSelectedModules: selectedModules,
    selectedModulesLabel: selectedModules.join(", "),
  };
}

export function canEnablePartialApply(args: {
  scopeMode: DeployScopeMode;
  driftStatus: string;
  partialScopeConfirmed: boolean;
  partialDriftOverrideConfirmed: boolean;
}): boolean {
  if (args.scopeMode !== "partial") return true;
  if (!args.partialScopeConfirmed) return false;
  if (args.driftStatus !== "drift_detected") return true;
  return args.partialDriftOverrideConfirmed;
}

export function mapDeployGateError(code: string | null | undefined, fallback = DEFAULT_DEPLOY_GUIDANCE): string {
  if (code === "saved_credentials_incomplete") {
    return "Saved AWS credentials are incomplete. Finish the Credentials section before apply or destroy.";
  }
  if (code === "generation_readiness_required") {
    return "Generate Terraform and Ansible artifacts before continuing.";
  }
  if (code === "plan_review_required" || code === "plan_review_stale") {
    return "Review the latest plan in this session before continuing.";
  }
  if (code === "destroy_plan_review_required") {
    return "Run and review a destroy plan in this session before continuing.";
  }
  if (code === "drift_refresh_required") {
    return "Refresh drift on the primary state backend before continuing.";
  }
  if (code === "drift_detected") {
    return "Refresh drift on the primary state backend before continuing, or explicitly allow partial apply for the selected scope.";
  }
  if (code === "partial_scope_confirmation_required") {
    return "Acknowledge the advanced partial-scope warning before continuing.";
  }
  if (code === "destroy_confirmation_required") {
    return "Type the project name and destroy before starting destroy.";
  }
  if (code === "ssm_no_targets_in_scope") {
    return "No Terraform targets were resolved for the current scope.";
  }
  if (code === "ssm_target_not_ready") {
    return "Wait for every scoped target to become SSM-ready before running configuration.";
  }
  if (code === "ssm_readiness_timeout") {
    return "SSM readiness timed out before every scoped target became ready.";
  }
  return fallback;
}

export function formatPostDeploySummary(summary: ProjectPostDeploySummary | null | undefined): string {
  if (!summary) return "No post-deploy snapshot available yet.";
  const status = summary.status === "ok" ? "Ready" : summary.status === "failed" ? "Needs attention" : "Skipped";
  return `${status} · ${summary.host_count} collected · ${summary.skipped_host_count} skipped`;
}

export function formatPostDeployBadge(section: ProjectPostDeploySection | null | undefined): string[] {
  if (!section) return [];
  const badges: string[] = [];
  if (section.truncated) badges.push("Truncated");
  if (section.redacted) badges.push("Redacted");
  return badges;
}
