from __future__ import annotations

import hashlib
import json
from textwrap import dedent
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app import db
from app.models import Project, ProjectBlueprintRun, ProjectTerraformGeneration
from app.services.agent.runtime.iac_templates import (
    ANSIBLE_HOSTS_OUTPUT_NAME,
    CANONICAL_TARGET_CONTRACT_OUTPUT_NAME,
    CONFIGURATION_TARGETS_OUTPUT_NAME,
    TARGET_CONTRACT_DEDUPE_KEY,
    TARGET_CONTRACT_OPTIONAL_FIELDS,
    TARGET_CONTRACT_REQUIRED_FIELDS,
    TARGET_CONTRACT_SCHEMA_VERSION,
    validate_iac_structure,
)
from app.services.blueprints import service as blueprint_service
from app.services.blueprints.terraform_templates import get_provisioning_terraform_template
from app.services.project import files as project_files

_STACK_FILES: tuple[str, ...] = (
    "versions.tf",
    "providers.tf",
    "main.tf",
    "variables.tf",
    "outputs.tf",
    "README.md",
    "PROVENANCE.md",
)
_STACK_PATH = "stacks/main"
_CONFIGURATION_TARGETS_OUTPUT_HEADER = 'output "configuration_targets" {'
_CANONICAL_TARGET_CONTRACT_OUTPUT_HEADER = 'output "configuration_target_contract" {'


def _json_literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _sanitize_name(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    compact = "-".join(part for part in cleaned.split("-") if part)
    return compact or "blueprint-stack"


def _blueprint_inputs(run: ProjectBlueprintRun) -> dict[str, str]:
    return {str(key): str(value) for key, value in dict(run.inputs_json or {}).items()}


def _snapshot(run: ProjectBlueprintRun) -> dict[str, Any]:
    return run.snapshot_json if isinstance(run.snapshot_json, dict) else {}


def _step_index(run: ProjectBlueprintRun) -> dict[str, dict[str, Any]]:
    return {str(step["id"]): step for step in _snapshot(run).get("steps", []) if isinstance(step, dict) and step.get("id")}


def _module_steps(run: ProjectBlueprintRun, step_ids: list[str]) -> list[dict[str, Any]]:
    indexed = _step_index(run)
    return [indexed[step_id] for step_id in step_ids if step_id in indexed]


def _header_comment(
    run: ProjectBlueprintRun,
    *,
    title: str,
    step_ids: list[str],
    inputs: dict[str, str],
) -> str:
    steps = _module_steps(run, step_ids)
    step_titles = ", ".join(step["title"] for step in steps) or "n/a"
    step_list = ", ".join(step_ids) or "n/a"
    input_summary = ", ".join(f"{key}={value}" for key, value in sorted(inputs.items())) or "n/a"
    return "\n".join(
        (
            f"# Generated from blueprint {run.blueprint_id} ({run.blueprint_version})",
            f"# Blueprint run: {run.id}",
            f"# Section: {title}",
            f"# Step ids: {step_list}",
            f"# Step titles: {step_titles}",
            f"# Approved inputs: {input_summary}",
        )
    )


def _prepend_header(content: str, header: str) -> str:
    return f"{header}\n\n{content.strip()}\n"


def _terraform_versions() -> str:
    return dedent(
        """
        terraform {
          required_version = ">= 1.6.0"

          required_providers {
            aws = {
              source  = "hashicorp/aws"
              version = "~> 5.0"
            }
            random = {
              source  = "hashicorp/random"
              version = "~> 3.6"
            }
          }
        }
        """
    ).strip()


def _terraform_provider() -> str:
    return dedent(
        """
        provider "aws" {
          region = var.region
        }
        """
    ).strip()


def _string_variable(
    name: str,
    description: str,
    *,
    default: str | None = None,
) -> str:
    lines = [
        f'variable "{name}" {{',
        '  type        = string',
        f'  description = {_json_literal(description)}',
    ]
    if default is not None:
        lines.append(f"  default     = {_json_literal(default)}")
    lines.append("}")
    return "\n".join(lines)


def _list_variable(
    name: str,
    description: str,
    *,
    default: list[str] | None = None,
) -> str:
    lines = [
        f'variable "{name}" {{',
        "  type        = list(string)",
        f'  description = {_json_literal(description)}',
    ]
    if default is not None:
        lines.append(f"  default     = {_json_literal(default)}")
    lines.append("}")
    return "\n".join(lines)


def _module_virtual_path(module: str, relative: str) -> str:
    return f"/modules/{module}/{relative}"


def _stack_virtual_path(relative: str) -> str:
    return f"/{_STACK_PATH}/{relative}"


def _digest(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _output_block(header: str, value_expression: str) -> str:
    lines = [header]
    expression_lines = [line.rstrip() for line in value_expression.strip().splitlines()]
    lines.append(f"  value = {expression_lines[0].strip()}")
    lines.extend(f"  {line}" for line in expression_lines[1:])
    lines.append("}")
    return "\n".join(lines)


def _append_output_block(body: str, block: str) -> str:
    return "\n\n".join((body.strip(), block.strip()))


def _with_configuration_targets(body: str, target_expression: str) -> str:
    return _append_output_block(
        body,
        _output_block(_CONFIGURATION_TARGETS_OUTPUT_HEADER, target_expression),
    )


def _aws_instance_target_expression(
    *,
    blueprint_id: str,
    resource_name: str,
    module_name: str,
    display_name: str,
    role: str,
) -> str:
    return dedent(
        f"""
        [
          {{
            execution_id = {resource_name}.id
            role = "{role}"
            source_modules = ["{module_name}"]
            display_name = "{display_name}"
            platform = "linux"
            private_ip = {resource_name}.private_ip
            public_ip = try({resource_name}.public_ip, null)
            hostname = try({resource_name}.private_dns, null)
            labels = {{
              blueprint = "{blueprint_id}"
              module = "{module_name}"
            }}
            tags = {resource_name}.tags
          }}
        ]
        """
    ).strip()


def _stack_target_contract_blocks(module_names: list[str]) -> str:
    module_targets = ",\n".join(
        f"    module.{module_name}.{CONFIGURATION_TARGETS_OUTPUT_NAME}"
        for module_name in module_names
    )
    locals_block = dedent(
        f"""
        locals {{
          module_configuration_targets = flatten([
        {module_targets}
          ])

          canonical_configuration_targets = [
            for execution_id in sort(distinct([for item in local.module_configuration_targets : item.execution_id])) : merge(
              [for item in local.module_configuration_targets : item if item.execution_id == execution_id][0],
              {{
                source_modules = sort(distinct(flatten([
                  for item in local.module_configuration_targets : item.source_modules if item.execution_id == execution_id
                ])))
              }}
            )
          ]
        }}
        """
    ).strip()
    canonical_output = _output_block(
        _CANONICAL_TARGET_CONTRACT_OUTPUT_HEADER,
        "local.canonical_configuration_targets",
    )
    return "\n\n".join((locals_block, canonical_output))


def _with_canonical_target_contract(body: str, module_names: list[str]) -> str:
    return _append_output_block(body, _stack_target_contract_blocks(module_names))


def _target_contract_payload() -> dict[str, Any]:
    return {
        "schemaVersion": TARGET_CONTRACT_SCHEMA_VERSION,
        "moduleOutputName": CONFIGURATION_TARGETS_OUTPUT_NAME,
        "canonicalOutputName": CANONICAL_TARGET_CONTRACT_OUTPUT_NAME,
        "legacyOutputName": ANSIBLE_HOSTS_OUTPUT_NAME,
        "requiredFields": list(TARGET_CONTRACT_REQUIRED_FIELDS),
        "optionalFields": list(TARGET_CONTRACT_OPTIONAL_FIELDS),
        "dedupeKey": TARGET_CONTRACT_DEDUPE_KEY,
    }


def _target_contract_summary() -> str:
    return (
        "execution_id is the AWS runtime identity for the target "
        "(EC2 instance id i-... or SSM managed node id mi-...), not a display field."
    )


def _existing_module_files(project_id: str, generation: ProjectTerraformGeneration | None) -> dict[str, str]:
    if generation is None:
        return {}
    payload = generation.generated_paths_json if isinstance(generation.generated_paths_json, dict) else {}
    return {str(path): str(digest) for path, digest in payload.items()}


def _removed_modules(current_modules: list[str], previous: ProjectTerraformGeneration | None) -> list[str]:
    if previous is None:
        return []
    prior = set(previous.module_names_json or [])
    current = set(current_modules)
    return sorted(prior - current)


def _resolved_required_inputs(selection: dict[str, Any] | None) -> bool:
    if selection is None:
        return False
    required_inputs = selection.get("required_inputs", [])
    for item in required_inputs:
        if item.get("required") and not item.get("resolved"):
            return False
    return True


def _private_service_network_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(run, title="network", step_ids=["network"], inputs={"region": inputs["region"]})
    name_prefix = _sanitize_name(run.blueprint_name)
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for the network module", default=inputs["region"]),
                _string_variable("name_prefix", "Prefix applied to generated resource names", default=name_prefix),
                _string_variable("vpc_cidr", "CIDR block for the generated VPC", default="10.42.0.0/16"),
                _string_variable("private_subnet_cidr", "Private subnet CIDR block", default="10.42.10.0/24"),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            resource "aws_vpc" "this" {
              cidr_block           = var.vpc_cidr
              enable_dns_support   = true
              enable_dns_hostnames = true

              tags = {
                Name = "${var.name_prefix}-vpc"
              }
            }

            resource "aws_subnet" "private_a" {
              vpc_id                  = aws_vpc.this.id
              cidr_block              = var.private_subnet_cidr
              availability_zone       = "${var.region}a"
              map_public_ip_on_launch = false

              tags = {
                Name = "${var.name_prefix}-private-a"
              }
            }

            resource "aws_route_table" "private" {
              vpc_id = aws_vpc.this.id

              tags = {
                Name = "${var.name_prefix}-private"
              }
            }

            resource "aws_route_table_association" "private_a" {
              subnet_id      = aws_subnet.private_a.id
              route_table_id = aws_route_table.private.id
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "vpc_id" {
                  value = aws_vpc.this.id
                }

                output "private_subnet_ids" {
                  value = [aws_subnet.private_a.id]
                }

                output "ansible_hosts" {
                  value = []
                }
                """
            ).strip(),
            "[]",
        ),
        header,
    )
    readme = dedent(
        f"""
        # Network Module

        Generated from blueprint `{run.blueprint_id}`.

        This module provisions the private VPC and subnet layer for the EC2 private service blueprint.
        """
    ).strip()
    example = dedent(
        """
        module "network" {
          source = "../../"
          region = "ap-southeast-1"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


def _private_service_security_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(run, title="security", step_ids=["compute"], inputs={"region": inputs["region"], "ssh_cidr": inputs["ssh_cidr"]})
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for security resources", default=inputs["region"]),
                _string_variable("vpc_id", "Optional VPC id. When empty, the default VPC is used.", default=""),
                _string_variable("ssh_cidr", "CIDR allowed to reach SSH", default=inputs["ssh_cidr"]),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            data "aws_vpc" "default" {
              default = true
            }

            locals {
              target_vpc_id = var.vpc_id != "" ? var.vpc_id : data.aws_vpc.default.id
            }

            resource "aws_security_group" "service" {
              name        = "private-service-sg"
              description = "Security group for the private EC2 workload"
              vpc_id      = local.target_vpc_id

              ingress {
                from_port   = 22
                to_port     = 22
                protocol    = "tcp"
                cidr_blocks = [var.ssh_cidr]
              }

              egress {
                from_port   = 0
                to_port     = 0
                protocol    = "-1"
                cidr_blocks = ["0.0.0.0/0"]
              }
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "service_security_group_id" {
                  value = aws_security_group.service.id
                }

                output "ansible_hosts" {
                  value = []
                }
                """
            ).strip(),
            "[]",
        ),
        header,
    )
    readme = "# Security Module\n\nGenerated security controls for the private EC2 service."
    example = dedent(
        """
        module "security" {
          source   = "../../"
          region   = "ap-southeast-1"
          ssh_cidr = "10.0.0.0/16"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


def _private_service_compute_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(
        run,
        title="compute",
        step_ids=["compute", "validate"],
        inputs={"region": inputs["region"], "instance_type": inputs["instance_type"]},
    )
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for compute resources", default=inputs["region"]),
                _string_variable("instance_type", "EC2 instance type for the service host", default=inputs["instance_type"]),
                _list_variable("subnet_ids", "Optional subnet ids wired from the main stack", default=[]),
                _list_variable("security_group_ids", "Optional security group ids wired from the main stack", default=[]),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            data "aws_vpc" "default" {
              default = true
            }

            data "aws_subnets" "default" {
              filter {
                name   = "vpc-id"
                values = [data.aws_vpc.default.id]
              }
            }

            data "aws_ami" "amazon_linux" {
              most_recent = true
              owners      = ["amazon"]

              filter {
                name   = "name"
                values = ["al2023-ami-2023*-x86_64"]
              }
            }

            resource "aws_iam_role" "instance" {
              name = "private-service-instance-role"

              assume_role_policy = jsonencode({
                Version = "2012-10-17"
                Statement = [{
                  Effect = "Allow"
                  Principal = {
                    Service = "ec2.amazonaws.com"
                  }
                  Action = "sts:AssumeRole"
                }]
              })
            }

            resource "aws_iam_instance_profile" "instance" {
              name = "private-service-instance-profile"
              role = aws_iam_role.instance.name
            }

            locals {
              target_subnet_id = length(var.subnet_ids) > 0 ? var.subnet_ids[0] : data.aws_subnets.default.ids[0]
            }

            resource "aws_instance" "service" {
              ami                  = data.aws_ami.amazon_linux.id
              instance_type        = var.instance_type
              subnet_id            = local.target_subnet_id
              iam_instance_profile = aws_iam_instance_profile.instance.name
              user_data            = <<-EOF
              #!/bin/bash
              echo "private service ready" >/etc/motd
              EOF

              vpc_security_group_ids = length(var.security_group_ids) > 0 ? var.security_group_ids : null

              tags = {
                Name = "private-service-host"
              }
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "instance_id" {
                  value = aws_instance.service.id
                }

                output "private_ip" {
                  value = aws_instance.service.private_ip
                }

                output "ansible_hosts" {
                  value = [aws_instance.service.private_ip]
                }
                """
            ).strip(),
            _aws_instance_target_expression(
                blueprint_id=run.blueprint_id,
                resource_name="aws_instance.service",
                module_name="compute",
                display_name="private-service-host",
                role="private_service_host",
            ),
        ),
        header,
    )
    readme = "# Compute Module\n\nGenerated EC2 host for the private service blueprint."
    example = dedent(
        """
        module "compute" {
          source        = "../../"
          region        = "ap-southeast-1"
          instance_type = "t3.medium"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


def _ecs_network_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(run, title="network", step_ids=["network"], inputs={"region": inputs["region"]})
    name_prefix = _sanitize_name(run.blueprint_name)
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for the public API network", default=inputs["region"]),
                _string_variable("name_prefix", "Prefix applied to generated resource names", default=name_prefix),
                _string_variable("vpc_cidr", "CIDR block for the generated VPC", default="10.50.0.0/16"),
                _string_variable("public_subnet_cidr", "Public subnet CIDR block", default="10.50.10.0/24"),
                _string_variable("private_subnet_cidr", "Private subnet CIDR block", default="10.50.20.0/24"),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            resource "aws_vpc" "this" {
              cidr_block           = var.vpc_cidr
              enable_dns_support   = true
              enable_dns_hostnames = true

              tags = {
                Name = "${var.name_prefix}-vpc"
              }
            }

            resource "aws_internet_gateway" "this" {
              vpc_id = aws_vpc.this.id
            }

            resource "aws_subnet" "public_a" {
              vpc_id                  = aws_vpc.this.id
              cidr_block              = var.public_subnet_cidr
              availability_zone       = "${var.region}a"
              map_public_ip_on_launch = true

              tags = {
                Name = "${var.name_prefix}-public-a"
              }
            }

            resource "aws_subnet" "private_a" {
              vpc_id                  = aws_vpc.this.id
              cidr_block              = var.private_subnet_cidr
              availability_zone       = "${var.region}a"
              map_public_ip_on_launch = false

              tags = {
                Name = "${var.name_prefix}-private-a"
              }
            }

            resource "aws_route_table" "public" {
              vpc_id = aws_vpc.this.id

              route {
                cidr_block = "0.0.0.0/0"
                gateway_id = aws_internet_gateway.this.id
              }
            }

            resource "aws_route_table_association" "public_a" {
              subnet_id      = aws_subnet.public_a.id
              route_table_id = aws_route_table.public.id
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "vpc_id" {
                  value = aws_vpc.this.id
                }

                output "public_subnet_ids" {
                  value = [aws_subnet.public_a.id]
                }

                output "private_subnet_ids" {
                  value = [aws_subnet.private_a.id]
                }

                output "ansible_hosts" {
                  value = []
                }
                """
            ).strip(),
            "[]",
        ),
        header,
    )
    readme = "# Network Module\n\nGenerated public and private networking for the ECS API blueprint."
    example = dedent(
        """
        module "network" {
          source = "../../"
          region = "us-east-1"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


def _ecs_security_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(
        run,
        title="security",
        step_ids=["network"],
        inputs={"region": inputs["region"], "service_port": inputs["service_port"]},
    )
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for the API security resources", default=inputs["region"]),
                _string_variable("vpc_id", "Optional VPC id. When empty, the default VPC is used.", default=""),
                _string_variable("service_port", "Port exposed by the public API", default=inputs["service_port"]),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            data "aws_vpc" "default" {
              default = true
            }

            locals {
              target_vpc_id = var.vpc_id != "" ? var.vpc_id : data.aws_vpc.default.id
            }

            resource "aws_security_group" "load_balancer" {
              name        = "public-api-alb-sg"
              description = "ALB ingress for the public API"
              vpc_id      = local.target_vpc_id

              ingress {
                from_port   = tonumber(var.service_port)
                to_port     = tonumber(var.service_port)
                protocol    = "tcp"
                cidr_blocks = ["0.0.0.0/0"]
              }

              egress {
                from_port   = 0
                to_port     = 0
                protocol    = "-1"
                cidr_blocks = ["0.0.0.0/0"]
              }
            }

            resource "aws_security_group" "service" {
              name        = "public-api-service-sg"
              description = "Runtime ingress for the ECS service"
              vpc_id      = local.target_vpc_id

              ingress {
                from_port       = tonumber(var.service_port)
                to_port         = tonumber(var.service_port)
                protocol        = "tcp"
                security_groups = [aws_security_group.load_balancer.id]
              }

              egress {
                from_port   = 0
                to_port     = 0
                protocol    = "-1"
                cidr_blocks = ["0.0.0.0/0"]
              }
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "load_balancer_security_group_id" {
                  value = aws_security_group.load_balancer.id
                }

                output "service_security_group_id" {
                  value = aws_security_group.service.id
                }

                output "ansible_hosts" {
                  value = []
                }
                """
            ).strip(),
            "[]",
        ),
        header,
    )
    readme = "# Security Module\n\nGenerated security groups for the public ECS API blueprint."
    example = dedent(
        """
        module "security" {
          source       = "../../"
          region       = "us-east-1"
          service_port = "8080"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


def _ecs_compute_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(
        run,
        title="compute",
        step_ids=["runtime", "validate"],
        inputs={
            "region": inputs["region"],
            "service_port": inputs["service_port"],
            "desired_count": inputs["desired_count"],
        },
    )
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for the ECS runtime", default=inputs["region"]),
                _string_variable("service_port", "Port exposed by the service", default=inputs["service_port"]),
                _string_variable("desired_count", "Desired ECS task count", default=inputs["desired_count"]),
                _string_variable("container_image", "Container image for the API", default="nginx:latest"),
                _list_variable("public_subnet_ids", "Optional public subnets wired from the main stack", default=[]),
                _list_variable("service_security_group_ids", "Optional service security groups wired from the main stack", default=[]),
                _list_variable("load_balancer_security_group_ids", "Optional ALB security groups wired from the main stack", default=[]),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            data "aws_vpc" "default" {
              default = true
            }

            data "aws_subnets" "default" {
              filter {
                name   = "vpc-id"
                values = [data.aws_vpc.default.id]
              }
            }

            data "aws_security_group" "default" {
              name   = "default"
              vpc_id = data.aws_vpc.default.id
            }

            resource "aws_ecs_cluster" "this" {
              name = "public-api-cluster"
            }

            resource "aws_cloudwatch_log_group" "this" {
              name              = "/ecs/public-api"
              retention_in_days = 14
            }

            resource "aws_lb" "api" {
              name               = "public-api-alb"
              internal           = false
              load_balancer_type = "application"
              subnets            = length(var.public_subnet_ids) > 0 ? var.public_subnet_ids : data.aws_subnets.default.ids
              security_groups    = length(var.load_balancer_security_group_ids) > 0 ? var.load_balancer_security_group_ids : [data.aws_security_group.default.id]
            }

            resource "aws_lb_target_group" "api" {
              name        = "public-api-tg"
              port        = tonumber(var.service_port)
              protocol    = "HTTP"
              target_type = "ip"
              vpc_id      = data.aws_vpc.default.id

              health_check {
                path = "/"
              }
            }

            resource "aws_lb_listener" "http" {
              load_balancer_arn = aws_lb.api.arn
              port              = tonumber(var.service_port)
              protocol          = "HTTP"

              default_action {
                type             = "forward"
                target_group_arn = aws_lb_target_group.api.arn
              }
            }

            data "aws_iam_policy_document" "task_assume" {
              statement {
                actions = ["sts:AssumeRole"]

                principals {
                  type        = "Service"
                  identifiers = ["ecs-tasks.amazonaws.com"]
                }
              }
            }

            resource "aws_iam_role" "task_execution" {
              name               = "public-api-task-execution"
              assume_role_policy = data.aws_iam_policy_document.task_assume.json
            }

            resource "aws_iam_role_policy_attachment" "task_execution" {
              role       = aws_iam_role.task_execution.name
              policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
            }

            resource "aws_ecs_task_definition" "api" {
              family                   = "public-api"
              network_mode             = "awsvpc"
              requires_compatibilities = ["FARGATE"]
              cpu                      = "256"
              memory                   = "512"
              execution_role_arn       = aws_iam_role.task_execution.arn

              container_definitions = jsonencode([
                {
                  name      = "api"
                  image     = var.container_image
                  essential = true
                  portMappings = [
                    {
                      containerPort = tonumber(var.service_port)
                      hostPort      = tonumber(var.service_port)
                    }
                  ]
                  logConfiguration = {
                    logDriver = "awslogs"
                    options = {
                      awslogs-group         = aws_cloudwatch_log_group.this.name
                      awslogs-region        = var.region
                      awslogs-stream-prefix = "ecs"
                    }
                  }
                }
              ])
            }

            resource "aws_ecs_service" "api" {
              name            = "public-api"
              cluster         = aws_ecs_cluster.this.id
              task_definition = aws_ecs_task_definition.api.arn
              desired_count   = tonumber(var.desired_count)
              launch_type     = "FARGATE"

              network_configuration {
                subnets          = length(var.public_subnet_ids) > 0 ? var.public_subnet_ids : data.aws_subnets.default.ids
                assign_public_ip = true
                security_groups  = length(var.service_security_group_ids) > 0 ? var.service_security_group_ids : [data.aws_security_group.default.id]
              }

              load_balancer {
                target_group_arn = aws_lb_target_group.api.arn
                container_name   = "api"
                container_port   = tonumber(var.service_port)
              }

              depends_on = [aws_lb_listener.http]
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "service_name" {
                  value = aws_ecs_service.api.name
                }

                output "service_url" {
                  value = "http://${aws_lb.api.dns_name}"
                }

                output "ansible_hosts" {
                  value = []
                }
                """
            ).strip(),
            "[]",
        ),
        header,
    )
    readme = "# Compute Module\n\nGenerated ECS runtime and ALB for the public API blueprint."
    example = dedent(
        """
        module "compute" {
          source        = "../../"
          region        = "us-east-1"
          service_port  = "8080"
          desired_count = "2"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


def _rds_network_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(run, title="network", step_ids=["network"], inputs={"region": inputs["region"]})
    name_prefix = _sanitize_name(run.blueprint_name)
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for the app stack network", default=inputs["region"]),
                _string_variable("name_prefix", "Prefix applied to generated resource names", default=name_prefix),
                _string_variable("vpc_cidr", "CIDR block for the generated VPC", default="10.60.0.0/16"),
                _string_variable("app_subnet_cidr", "Application subnet CIDR block", default="10.60.10.0/24"),
                _string_variable("database_subnet_a_cidr", "Database subnet A CIDR block", default="10.60.20.0/24"),
                _string_variable("database_subnet_b_cidr", "Database subnet B CIDR block", default="10.60.21.0/24"),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            resource "aws_vpc" "this" {
              cidr_block           = var.vpc_cidr
              enable_dns_support   = true
              enable_dns_hostnames = true

              tags = {
                Name = "${var.name_prefix}-vpc"
              }
            }

            resource "aws_internet_gateway" "this" {
              vpc_id = aws_vpc.this.id
            }

            resource "aws_subnet" "app" {
              vpc_id                  = aws_vpc.this.id
              cidr_block              = var.app_subnet_cidr
              availability_zone       = "${var.region}a"
              map_public_ip_on_launch = true
            }

            resource "aws_subnet" "database_a" {
              vpc_id                  = aws_vpc.this.id
              cidr_block              = var.database_subnet_a_cidr
              availability_zone       = "${var.region}a"
              map_public_ip_on_launch = false
            }

            resource "aws_subnet" "database_b" {
              vpc_id                  = aws_vpc.this.id
              cidr_block              = var.database_subnet_b_cidr
              availability_zone       = "${var.region}b"
              map_public_ip_on_launch = false
            }

            resource "aws_route_table" "public" {
              vpc_id = aws_vpc.this.id

              route {
                cidr_block = "0.0.0.0/0"
                gateway_id = aws_internet_gateway.this.id
              }
            }

            resource "aws_route_table_association" "app" {
              subnet_id      = aws_subnet.app.id
              route_table_id = aws_route_table.public.id
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "vpc_id" {
                  value = aws_vpc.this.id
                }

                output "app_subnet_ids" {
                  value = [aws_subnet.app.id]
                }

                output "database_subnet_ids" {
                  value = [aws_subnet.database_a.id, aws_subnet.database_b.id]
                }

                output "ansible_hosts" {
                  value = []
                }
                """
            ).strip(),
            "[]",
        ),
        header,
    )
    readme = "# Network Module\n\nGenerated networking for the application and database stack."
    example = dedent(
        """
        module "network" {
          source = "../../"
          region = "us-west-2"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


def _rds_security_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(
        run,
        title="security",
        step_ids=["network", "validate"],
        inputs={"region": inputs["region"], "public_ingress_cidr": inputs["public_ingress_cidr"]},
    )
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for security resources", default=inputs["region"]),
                _string_variable("vpc_id", "Optional VPC id. When empty, the default VPC is used.", default=""),
                _string_variable("public_ingress_cidr", "CIDR allowed to reach the application", default=inputs["public_ingress_cidr"]),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            data "aws_vpc" "default" {
              default = true
            }

            locals {
              target_vpc_id = var.vpc_id != "" ? var.vpc_id : data.aws_vpc.default.id
            }

            resource "aws_security_group" "app" {
              name        = "stateful-app-sg"
              description = "Application ingress"
              vpc_id      = local.target_vpc_id

              ingress {
                from_port   = 80
                to_port     = 80
                protocol    = "tcp"
                cidr_blocks = [var.public_ingress_cidr]
              }

              ingress {
                from_port   = 22
                to_port     = 22
                protocol    = "tcp"
                cidr_blocks = [var.public_ingress_cidr]
              }

              egress {
                from_port   = 0
                to_port     = 0
                protocol    = "-1"
                cidr_blocks = ["0.0.0.0/0"]
              }
            }

            resource "aws_security_group" "database" {
              name        = "stateful-db-sg"
              description = "Database ingress from the application"
              vpc_id      = local.target_vpc_id

              ingress {
                from_port       = 5432
                to_port         = 5432
                protocol        = "tcp"
                security_groups = [aws_security_group.app.id]
              }

              egress {
                from_port   = 0
                to_port     = 0
                protocol    = "-1"
                cidr_blocks = ["0.0.0.0/0"]
              }
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "app_security_group_id" {
                  value = aws_security_group.app.id
                }

                output "database_security_group_id" {
                  value = aws_security_group.database.id
                }

                output "ansible_hosts" {
                  value = []
                }
                """
            ).strip(),
            "[]",
        ),
        header,
    )
    readme = "# Security Module\n\nGenerated security groups for the app and database stack."
    example = dedent(
        """
        module "security" {
          source              = "../../"
          region              = "us-west-2"
          public_ingress_cidr = "0.0.0.0/0"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


def _rds_compute_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(run, title="compute", step_ids=["stateful", "validate"], inputs={"region": inputs["region"]})
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for the application compute", default=inputs["region"]),
                _list_variable("app_subnet_ids", "Optional application subnets wired from the main stack", default=[]),
                _list_variable("app_security_group_ids", "Optional application security groups wired from the main stack", default=[]),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            data "aws_vpc" "default" {
              default = true
            }

            data "aws_subnets" "default" {
              filter {
                name   = "vpc-id"
                values = [data.aws_vpc.default.id]
              }
            }

            data "aws_security_group" "default" {
              name   = "default"
              vpc_id = data.aws_vpc.default.id
            }

            data "aws_ami" "amazon_linux" {
              most_recent = true
              owners      = ["amazon"]

              filter {
                name   = "name"
                values = ["al2023-ami-2023*-x86_64"]
              }
            }

            locals {
              target_subnet_id = length(var.app_subnet_ids) > 0 ? var.app_subnet_ids[0] : data.aws_subnets.default.ids[0]
            }

            resource "aws_instance" "app" {
              ami           = data.aws_ami.amazon_linux.id
              instance_type = "t3.small"
              subnet_id     = local.target_subnet_id
              user_data     = <<-EOF
              #!/bin/bash
              echo "stateful app host ready" >/etc/motd
              EOF

              vpc_security_group_ids = length(var.app_security_group_ids) > 0 ? var.app_security_group_ids : [data.aws_security_group.default.id]

              tags = {
                Name = "stateful-app-host"
              }
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "instance_id" {
                  value = aws_instance.app.id
                }

                output "private_ip" {
                  value = aws_instance.app.private_ip
                }

                output "ansible_hosts" {
                  value = [aws_instance.app.private_ip]
                }
                """
            ).strip(),
            _aws_instance_target_expression(
                blueprint_id=run.blueprint_id,
                resource_name="aws_instance.app",
                module_name="compute",
                display_name="stateful-app-host",
                role="stateful_app_host",
            ),
        ),
        header,
    )
    readme = "# Compute Module\n\nGenerated application host for the stateful app blueprint."
    example = dedent(
        """
        module "compute" {
          source = "../../"
          region = "us-west-2"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


def _rds_database_files(run: ProjectBlueprintRun) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(
        run,
        title="database",
        step_ids=["stateful", "validate"],
        inputs={"region": inputs["region"], "database_instance_class": inputs["database_instance_class"]},
    )
    versions = _prepend_header(_terraform_versions(), header)
    providers = _prepend_header(_terraform_provider(), header)
    variables = _prepend_header(
        "\n\n".join(
            (
                _string_variable("region", "AWS region for the database", default=inputs["region"]),
                _string_variable("database_instance_class", "RDS instance class", default=inputs["database_instance_class"]),
                _list_variable("database_subnet_ids", "Optional database subnets wired from the main stack", default=[]),
                _list_variable("database_security_group_ids", "Optional database security groups wired from the main stack", default=[]),
            )
        ),
        header,
    )
    main = _prepend_header(
        dedent(
            """
            data "aws_vpc" "default" {
              default = true
            }

            data "aws_subnets" "default" {
              filter {
                name   = "vpc-id"
                values = [data.aws_vpc.default.id]
              }
            }

            resource "random_password" "database" {
              length  = 24
              special = false
            }

            resource "aws_db_subnet_group" "this" {
              name       = "stateful-app-database"
              subnet_ids = length(var.database_subnet_ids) > 0 ? var.database_subnet_ids : data.aws_subnets.default.ids
            }

            resource "aws_db_instance" "postgres" {
              identifier             = "stateful-app-postgres"
              engine                 = "postgres"
              instance_class         = var.database_instance_class
              allocated_storage      = 20
              db_name                = "appdb"
              username               = "appuser"
              password               = random_password.database.result
              db_subnet_group_name   = aws_db_subnet_group.this.name
              vpc_security_group_ids = length(var.database_security_group_ids) > 0 ? var.database_security_group_ids : null
              skip_final_snapshot    = true
            }

            resource "aws_secretsmanager_secret" "database" {
              name = "stateful-app-database"
            }

            resource "aws_secretsmanager_secret_version" "database" {
              secret_id = aws_secretsmanager_secret.database.id
              secret_string = jsonencode({
                username = aws_db_instance.postgres.username
                password = random_password.database.result
                endpoint = aws_db_instance.postgres.address
                db_name  = aws_db_instance.postgres.db_name
              })
            }
            """
        ).strip(),
        header,
    )
    outputs = _prepend_header(
        _with_configuration_targets(
            dedent(
                """
                output "db_instance_identifier" {
                  value = aws_db_instance.postgres.id
                }

                output "db_endpoint" {
                  value = aws_db_instance.postgres.address
                }

                output "ansible_hosts" {
                  value = []
                }
                """
            ).strip(),
            "[]",
        ),
        header,
    )
    readme = "# Database Module\n\nGenerated PostgreSQL and Secrets Manager resources for the stateful app blueprint."
    example = dedent(
        """
        module "database" {
          source                  = "../../"
          region                  = "us-west-2"
          database_instance_class = "db.t4g.micro"
        }
        """
    ).strip()
    return {
        "versions.tf": versions,
        "providers.tf": providers,
        "variables.tf": variables,
        "main.tf": main,
        "outputs.tf": outputs,
        "README.md": f"{readme}\n",
        "examples/basic/main.tf": f"{example}\n",
    }


_MODULE_RENDERERS: dict[tuple[str, str], Any] = {
    ("aws-ec2-private-service", "network"): _private_service_network_files,
    ("aws-ec2-private-service", "security"): _private_service_security_files,
    ("aws-ec2-private-service", "compute"): _private_service_compute_files,
    ("aws-ecs-public-api", "network"): _ecs_network_files,
    ("aws-ecs-public-api", "security"): _ecs_security_files,
    ("aws-ecs-public-api", "compute"): _ecs_compute_files,
    ("aws-rds-app-stack", "network"): _rds_network_files,
    ("aws-rds-app-stack", "security"): _rds_security_files,
    ("aws-rds-app-stack", "compute"): _rds_compute_files,
    ("aws-rds-app-stack", "database"): _rds_database_files,
}


def _render_module_files(run: ProjectBlueprintRun, module_name: str) -> dict[str, str]:
    try:
        renderer = _MODULE_RENDERERS[(run.blueprint_id, module_name)]
    except KeyError as exc:
        raise ValueError(f"terraform_module_renderer_missing:{run.blueprint_id}:{module_name}") from exc
    return renderer(run)


def _private_stack_main(run: ProjectBlueprintRun) -> str:
    inputs = _blueprint_inputs(run)
    header = _header_comment(run, title="stack", step_ids=["network", "compute", "validate"], inputs=inputs)
    return _prepend_header(
        dedent(
            """
            module "network" {
              source = "../../modules/network"
              region = var.region
            }

            module "security" {
              source   = "../../modules/security"
              region   = var.region
              vpc_id   = module.network.vpc_id
              ssh_cidr = var.ssh_cidr
            }

            module "compute" {
              source             = "../../modules/compute"
              region             = var.region
              instance_type      = var.instance_type
              subnet_ids         = module.network.private_subnet_ids
              security_group_ids = [module.security.service_security_group_id]
            }
            """
        ).strip(),
        header,
    )


def _ecs_stack_main(run: ProjectBlueprintRun) -> str:
    inputs = _blueprint_inputs(run)
    header = _header_comment(run, title="stack", step_ids=["network", "runtime", "validate"], inputs=inputs)
    return _prepend_header(
        dedent(
            """
            module "network" {
              source = "../../modules/network"
              region = var.region
            }

            module "security" {
              source       = "../../modules/security"
              region       = var.region
              vpc_id       = module.network.vpc_id
              service_port = var.service_port
            }

            module "compute" {
              source                           = "../../modules/compute"
              region                           = var.region
              service_port                     = var.service_port
              desired_count                    = var.desired_count
              public_subnet_ids                = module.network.public_subnet_ids
              load_balancer_security_group_ids = [module.security.load_balancer_security_group_id]
              service_security_group_ids       = [module.security.service_security_group_id]
            }
            """
        ).strip(),
        header,
    )


def _rds_stack_main(run: ProjectBlueprintRun) -> str:
    inputs = _blueprint_inputs(run)
    header = _header_comment(run, title="stack", step_ids=["network", "stateful", "validate"], inputs=inputs)
    return _prepend_header(
        dedent(
            """
            module "network" {
              source = "../../modules/network"
              region = var.region
            }

            module "security" {
              source              = "../../modules/security"
              region              = var.region
              vpc_id              = module.network.vpc_id
              public_ingress_cidr = var.public_ingress_cidr
            }

            module "compute" {
              source                 = "../../modules/compute"
              region                 = var.region
              app_subnet_ids         = module.network.app_subnet_ids
              app_security_group_ids = [module.security.app_security_group_id]
            }

            module "database" {
              source                      = "../../modules/database"
              region                      = var.region
              database_instance_class     = var.database_instance_class
              database_subnet_ids         = module.network.database_subnet_ids
              database_security_group_ids = [module.security.database_security_group_id]
            }
            """
        ).strip(),
        header,
    )


def _stack_main(run: ProjectBlueprintRun) -> str:
    if run.blueprint_id == "aws-ec2-private-service":
        return _private_stack_main(run)
    if run.blueprint_id == "aws-ecs-public-api":
        return _ecs_stack_main(run)
    if run.blueprint_id == "aws-rds-app-stack":
        return _rds_stack_main(run)
    raise ValueError("terraform_stack_renderer_missing")


def render_provisioning_stack_files(
    run: ProjectBlueprintRun,
    template: dict[str, Any],
) -> dict[str, str]:
    inputs = _blueprint_inputs(run)
    header = _header_comment(run, title="stack", step_ids=[step["id"] for step in _snapshot(run).get("steps", [])], inputs=inputs)
    variables = [_string_variable("region", "AWS region for the full stack", default=inputs["region"])]
    if "instance_type" in inputs:
        variables.append(_string_variable("instance_type", "EC2 instance type", default=inputs["instance_type"]))
    if "ssh_cidr" in inputs:
        variables.append(_string_variable("ssh_cidr", "CIDR allowed to reach SSH", default=inputs["ssh_cidr"]))
    if "service_port" in inputs:
        variables.append(_string_variable("service_port", "Port exposed by the service", default=inputs["service_port"]))
    if "desired_count" in inputs:
        variables.append(_string_variable("desired_count", "Desired ECS task count", default=inputs["desired_count"]))
    if "database_instance_class" in inputs:
        variables.append(
            _string_variable("database_instance_class", "Database instance class", default=inputs["database_instance_class"])
        )
    if "public_ingress_cidr" in inputs:
        variables.append(
            _string_variable("public_ingress_cidr", "Ingress CIDR for the application", default=inputs["public_ingress_cidr"])
        )
    outputs = {
        "aws-ec2-private-service": dedent(
            """
            output "private_service_vpc_id" {
              value = module.network.vpc_id
            }

            output "private_service_host_ip" {
              value = module.compute.private_ip
            }
            """
        ).strip(),
        "aws-ecs-public-api": dedent(
            """
            output "public_api_url" {
              value = module.compute.service_url
            }
            """
        ).strip(),
        "aws-rds-app-stack": dedent(
            """
            output "stateful_app_host_ip" {
              value = module.compute.private_ip
            }

            output "stateful_database_endpoint" {
              value = module.database.db_endpoint
            }
            """
        ).strip(),
    }
    module_names = ", ".join(template["stack"]["module_order"])
    readme = dedent(
        f"""
        # Main Stack

        Generated from blueprint `{run.blueprint_id}`.

        This stack is the primary review surface and wires the generated modules together in the order `{module_names}`.
        """
    ).strip()
    provenance_lines = [
        "# Terraform Provenance Report",
        "",
        f"- Blueprint id: `{run.blueprint_id}`",
        f"- Blueprint version: `{run.blueprint_version}`",
        f"- Blueprint run id: `{run.id}`",
        f"- Stack path: `{_STACK_PATH}`",
        "",
        "## Approved Inputs",
    ]
    for key, value in sorted(inputs.items()):
        provenance_lines.append(f"- `{key}` = `{value}`")
    provenance_lines.extend(("", "## Module Mapping"))
    step_ids_by_title = {step["id"]: step["title"] for step in _snapshot(run).get("steps", []) if isinstance(step, dict)}
    for module in template["modules"]:
        titles = [step_ids_by_title.get(step_id, step_id) for step_id in module["step_ids"]]
        provenance_lines.append(
            f"- `{module['module_name']}` ({module['resource_area']}) → {', '.join(titles)}"
        )
    return {
        "versions.tf": _prepend_header(_terraform_versions(), header),
        "providers.tf": _prepend_header(_terraform_provider(), header),
        "variables.tf": _prepend_header("\n\n".join(variables), header),
        "main.tf": _stack_main(run),
        "outputs.tf": _prepend_header(
            _with_canonical_target_contract(
                outputs[run.blueprint_id],
                list(template["stack"]["module_order"]),
            ),
            header,
        ),
        "README.md": f"{readme}\n",
        "PROVENANCE.md": "\n".join(provenance_lines).strip() + "\n",
    }


def _render_generation_files(run: ProjectBlueprintRun) -> dict[str, str]:
    template = get_provisioning_terraform_template(run.blueprint_id)
    files: dict[str, str] = {}
    for relative, content in render_provisioning_stack_files(run, template).items():
        files[_stack_virtual_path(relative)] = content
    for module in template["modules"]:
        rendered = _render_module_files(run, module["module_name"])
        for relative, content in rendered.items():
            files[_module_virtual_path(module["module_name"], relative)] = content
    return files


def _generation_summary(
    run: ProjectBlueprintRun,
    template: dict[str, Any],
    generated_files: list[str],
    *,
    latest_generation: ProjectTerraformGeneration | None,
) -> dict[str, Any]:
    return {
        "headline": f"{run.blueprint_name} -> {_STACK_PATH}",
        "blueprintId": run.blueprint_id,
        "blueprintName": run.blueprint_name,
        "blueprintRunId": run.id,
        "inputs": _blueprint_inputs(run),
        "stackPath": _STACK_PATH,
        "moduleCount": len(template["modules"]),
        "fileCount": len(generated_files),
        "latestGenerationId": latest_generation.id if latest_generation else None,
        "targetContract": _target_contract_payload(),
        "targetContractSummary": _target_contract_summary(),
    }


def _preview_base_payload(
    run: ProjectBlueprintRun,
    template: dict[str, Any],
    *,
    latest_generation: ProjectTerraformGeneration | None,
) -> dict[str, Any]:
    rendered = _render_generation_files(run)
    generated_files = sorted(rendered)
    module_names = list(template["stack"]["module_order"])
    validation = {
        "status": "pass",
        "checkedModules": module_names,
        "missing": [],
        "violations": [],
        "requireAnsible": False,
        "requireTargetContract": True,
    }
    summary = _generation_summary(run, template, generated_files, latest_generation=latest_generation)
    removed_modules = _removed_modules(module_names, latest_generation)
    latest_compare = (
        blueprint_service.compare_terraform_generations(latest_generation, None) if latest_generation else None
    )
    inputs_changed = False
    if latest_generation is not None:
        previous_inputs = dict((latest_generation.summary_json or {}).get("inputs", {}))
        inputs_changed = previous_inputs != _blueprint_inputs(run)
    return {
        "status": "ok",
        "blueprintRunId": run.id,
        "stackPath": _STACK_PATH,
        "moduleNames": module_names,
        "generatedFiles": generated_files,
        "validation": validation,
        "mode": "regenerate" if latest_generation else "generate",
        "inputsChanged": inputs_changed,
        "removedModules": removed_modules,
        "summary": summary,
        "targetContract": _target_contract_payload(),
        "targetContractSummary": _target_contract_summary(),
        "validationIssues": [],
        "latestGeneration": _generation_record_to_dict(latest_generation, compare_to_previous=latest_compare)
        if latest_generation
        else None,
    }


def build_provisioning_generation_preview(
    project: Project,
    selection: dict[str, Any],
    run_snapshot: ProjectBlueprintRun,
    latest_generation: ProjectTerraformGeneration | None = None,
) -> dict[str, Any]:
    del project
    if not _resolved_required_inputs(selection):
        raise ValueError("unresolved_blueprint_inputs")
    template = get_provisioning_terraform_template(run_snapshot.blueprint_id)
    payload = _preview_base_payload(run_snapshot, template, latest_generation=latest_generation)
    token_payload = {
        "blueprintRunId": payload["blueprintRunId"],
        "moduleNames": payload["moduleNames"],
        "generatedFiles": payload["generatedFiles"],
        "removedModules": payload["removedModules"],
        "inputs": summary_inputs(payload["summary"]),
        "latestGenerationId": (payload["latestGeneration"] or {}).get("id"),
        "mode": payload["mode"],
    }
    payload["previewToken"] = blueprint_service.preview_token_from_payload(token_payload)
    return payload


def summary_inputs(summary: dict[str, Any]) -> dict[str, str]:
    return {str(key): str(value) for key, value in dict(summary.get("inputs", {})).items()}


def _write_generation_files(project_id: str, files: dict[str, str]) -> list[str]:
    written: list[str] = []
    for path, content in sorted(files.items()):
        project_files.write_text(project_id, path, content)
        written.append(path)
    return written


def _remove_stale_files(project_id: str, previous: ProjectTerraformGeneration | None, next_paths: dict[str, str]) -> list[str]:
    if previous is None:
        return []
    removed: list[str] = []
    previous_paths = _existing_module_files(project_id, previous)
    for path in sorted(set(previous_paths) - set(next_paths)):
        try:
            project_files.delete_file(project_id, path)
        except FileNotFoundError:
            continue
        removed.append(path)
    return removed


def _generation_record_to_dict(
    record: ProjectTerraformGeneration | None,
    *,
    compare_to_previous: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if record is None:
        return None
    return {
        "id": record.id,
        "projectId": record.project_id,
        "blueprintRunId": record.blueprint_run_id,
        "stackPath": record.stack_path,
        "moduleNames": list(record.module_names_json or []),
        "generatedPaths": dict(record.generated_paths_json or {}),
        "summary": dict(record.summary_json or {}),
        "targetContract": dict((record.summary_json or {}).get("targetContract", {}) or {}),
        "targetContractSummary": str((record.summary_json or {}).get("targetContractSummary") or ""),
        "provenanceReportPath": record.provenance_report_path,
        "replacesGenerationId": record.replaces_generation_id,
        "createdAt": record.created_at.isoformat() if record.created_at else None,
        "compare": compare_to_previous,
    }


async def _load_generation_context(
    session: AsyncSession,
    project_id: str,
) -> tuple[Project, dict[str, Any], ProjectBlueprintRun, ProjectTerraformGeneration | None]:
    project = await session.get(Project, project_id)
    if project is None:
        raise ValueError("project_not_found")
    selection = blueprint_service.get_active_blueprint_selection(project, "provisioning")
    if selection is None:
        raise ValueError("no_active_provisioning_blueprint")
    run_snapshot = await blueprint_service.get_latest_blueprint_run(session, project, "provisioning")
    if run_snapshot is None:
        raise ValueError("missing_blueprint_run_snapshot")
    latest_generation = await blueprint_service.get_latest_terraform_generation(session, project_id)
    return project, selection, run_snapshot, latest_generation


async def generate_provisioning_terraform(
    project_id: str,
    *,
    session: AsyncSession | None = None,
    preview_token: str | None = None,
    confirm_write: bool = False,
) -> dict[str, Any]:
    async def _run(active_session: AsyncSession) -> dict[str, Any]:
        project, selection, run_snapshot, latest_generation = await _load_generation_context(active_session, project_id)
        preview = build_provisioning_generation_preview(project, selection, run_snapshot, latest_generation)
        if not confirm_write:
            raise ValueError("terraform_generation_confirmation_required")
        if not preview_token or preview_token != preview["previewToken"]:
            raise ValueError("terraform_preview_stale")
        rendered = _render_generation_files(run_snapshot)
        removed_files = _remove_stale_files(project_id, latest_generation, {path: _digest(content) for path, content in rendered.items()})
        written_files = _write_generation_files(project_id, rendered)
        validation = validate_iac_structure(
            project_files.ensure_project_dir(project_id),
            selected_modules=preview["moduleNames"],
            require_ansible=False,
            require_target_contract=True,
        )
        if validation["status"] != "pass":
            raise ValueError("terraform_generation_validation_failed")
        compare = blueprint_service.compare_terraform_generations(latest_generation, None) if latest_generation else None
        summary = {
            **preview["summary"],
            "mode": preview["mode"],
            "removedModules": preview["removedModules"],
            "removedFiles": removed_files,
            "inputsChanged": preview["inputsChanged"],
        }
        record = await blueprint_service.create_terraform_generation_record(
            active_session,
            project_id=project_id,
            blueprint_run_id=run_snapshot.id,
            stack_path=preview["stackPath"],
            generated_paths={path: _digest(content) for path, content in rendered.items()},
            module_names=preview["moduleNames"],
            summary=summary,
            provenance_report_path=_stack_virtual_path("PROVENANCE.md"),
            replaces_generation_id=latest_generation.id if latest_generation else None,
        )
        return {
            **preview,
            "validation": {
                "status": validation["status"],
                "checkedModules": validation["checked_modules"],
                "missing": validation["missing"],
                "violations": validation["violations"],
                "requireAnsible": validation["require_ansible"],
                "requireTargetContract": validation["require_target_contract"],
            },
            "validationIssues": [*validation["missing"], *validation["violations"]],
            "writtenFiles": written_files,
            "removedFiles": removed_files,
            "provenanceReportPath": _stack_virtual_path("PROVENANCE.md"),
            "generation": _generation_record_to_dict(
                record,
                compare_to_previous=blueprint_service.compare_terraform_generations(record, latest_generation),
            ),
            "latestGeneration": _generation_record_to_dict(record),
        }

    if session is not None:
        return await _run(session)
    async with db.get_session() as managed:
        return await _run(managed)


async def preview_provisioning_terraform(
    session: AsyncSession,
    project_id: str,
) -> dict[str, Any]:
    project, selection, run_snapshot, latest_generation = await _load_generation_context(session, project_id)
    return build_provisioning_generation_preview(project, selection, run_snapshot, latest_generation)


async def list_provisioning_terraform_history(
    session: AsyncSession,
    project_id: str,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    records = await blueprint_service.list_terraform_generations(session, project_id, limit=limit)
    items: list[dict[str, Any]] = []
    for index, record in enumerate(records):
        previous = records[index + 1] if index + 1 < len(records) else None
        compare = blueprint_service.compare_terraform_generations(record, previous)
        items.append(_generation_record_to_dict(record, compare_to_previous=compare) or {})
    return items


async def get_provisioning_terraform_history_item(
    session: AsyncSession,
    project_id: str,
    generation_id: str,
) -> dict[str, Any] | None:
    record = await blueprint_service.get_terraform_generation(session, project_id, generation_id)
    if record is None:
        return None
    records = await blueprint_service.list_terraform_generations(session, project_id, limit=100)
    previous = None
    for index, item in enumerate(records):
        if item.id != generation_id:
            continue
        previous = records[index + 1] if index + 1 < len(records) else None
        break
    compare = blueprint_service.compare_terraform_generations(record, previous)
    return _generation_record_to_dict(record, compare_to_previous=compare)
