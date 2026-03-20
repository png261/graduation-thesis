from __future__ import annotations

from typing import Literal, TypedDict

BlueprintKind = Literal["provisioning", "configuration"]
BlueprintStepType = Literal["resource", "action", "validation"]
BlueprintRiskClass = Literal["safe", "cost", "network", "data", "destroy"]
TerraformResourceArea = Literal["network", "compute", "security", "database", "runtime"]
PostDeployHealthCheckType = Literal["command", "http"]


class BlueprintInputDefinition(TypedDict, total=False):
    key: str
    label: str
    description: str
    required: bool
    risk_class: BlueprintRiskClass
    default_value: str | None


class BlueprintStepDefinition(TypedDict):
    id: str
    type: BlueprintStepType
    title: str
    description: str
    required_inputs: list[str]
    expected_result: str


class BlueprintHealthCheckDefinition(TypedDict, total=False):
    name: str
    type: PostDeployHealthCheckType
    command: str
    url: str
    success_contains: str
    expected_status: int


class BlueprintServiceLogDefinition(TypedDict, total=False):
    name: str
    service: str
    command: str


class BlueprintPostDeployChecks(TypedDict, total=False):
    services: list[str]
    package_versions: list[str]
    health_checks: list[BlueprintHealthCheckDefinition]
    service_logs: list[BlueprintServiceLogDefinition]


class BlueprintDefinition(TypedDict, total=False):
    id: str
    kind: BlueprintKind
    version: str
    name: str
    summary: str
    resources_or_actions: list[str]
    required_inputs: list[BlueprintInputDefinition]
    steps: list[BlueprintStepDefinition]
    post_deploy_checks: BlueprintPostDeployChecks


class ActiveBlueprintSelection(TypedDict, total=False):
    kind: BlueprintKind
    blueprint_id: str
    blueprint_version: str
    blueprint_name: str
    summary: str
    resources_or_actions: list[str]
    required_inputs: list[BlueprintInputDefinition]
    steps: list[BlueprintStepDefinition]
    inputs: dict[str, str]
    selected_at: str
    latest_run_id: str | None
    latest_run_created_at: str | None
    post_deploy_checks: BlueprintPostDeployChecks


class BlueprintRunSnapshot(TypedDict, total=False):
    id: str
    kind: BlueprintKind
    version: str
    name: str
    summary: str
    resources_or_actions: list[str]
    required_inputs: list[BlueprintInputDefinition]
    steps: list[BlueprintStepDefinition]
    post_deploy_checks: BlueprintPostDeployChecks


class TerraformStackTemplate(TypedDict):
    path: str
    module_order: list[str]


class TerraformModuleTemplate(TypedDict):
    module_name: str
    resource_area: TerraformResourceArea
    title: str
    description: str
    step_ids: list[str]
    variable_keys: list[str]
    outputs: list[str]


class ProvisioningTerraformTemplate(TypedDict):
    blueprint_id: str
    stack: TerraformStackTemplate
    modules: list[TerraformModuleTemplate]


class ConfigurationModuleTarget(TypedDict):
    module_name: str
    title: str
    description: str
    step_ids: list[str]


class ConfigurationRoleTemplate(TypedDict):
    module_name: str
    defaults_from_inputs: dict[str, str]
    task_titles: list[str]


class ConfigurationAnsibleTemplate(TypedDict):
    blueprint_id: str
    playbook_path: str
    provenance_path: str
    targets: list[ConfigurationModuleTarget]
    roles: list[ConfigurationRoleTemplate]
