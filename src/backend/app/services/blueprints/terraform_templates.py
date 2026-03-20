from __future__ import annotations

from app.services.agent.runtime.iac_templates import CONFIGURATION_TARGETS_OUTPUT_NAME
from app.services.blueprints.types import ProvisioningTerraformTemplate

PROVISIONING_TERRAFORM_TEMPLATES: dict[str, ProvisioningTerraformTemplate] = {
    "aws-ec2-private-service": {
        "blueprint_id": "aws-ec2-private-service",
        "stack": {
            "path": "/stacks/main",
            "module_order": ["network", "security", "compute"],
        },
        "modules": [
            {
                "module_name": "network",
                "resource_area": "network",
                "title": "Private service network",
                "description": "Provision VPC, private subnets, and internal routing for the EC2 service.",
                "step_ids": ["network"],
                "variable_keys": ["region"],
                "outputs": ["vpc_id", "private_subnet_ids", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
            {
                "module_name": "security",
                "resource_area": "security",
                "title": "Private service security",
                "description": "Provision the EC2 security group and management ingress rules.",
                "step_ids": ["compute"],
                "variable_keys": ["region", "ssh_cidr"],
                "outputs": ["service_security_group_id", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
            {
                "module_name": "compute",
                "resource_area": "compute",
                "title": "Private service compute",
                "description": "Provision the EC2 host, instance profile, and operator outputs.",
                "step_ids": ["compute", "validate"],
                "variable_keys": ["region", "instance_type"],
                "outputs": ["instance_id", "private_ip", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
        ],
    },
    "aws-ecs-public-api": {
        "blueprint_id": "aws-ecs-public-api",
        "stack": {
            "path": "/stacks/main",
            "module_order": ["network", "security", "compute"],
        },
        "modules": [
            {
                "module_name": "network",
                "resource_area": "network",
                "title": "Public API network",
                "description": "Provision public and private subnets plus internet routing for the API edge.",
                "step_ids": ["network"],
                "variable_keys": ["region"],
                "outputs": ["vpc_id", "public_subnet_ids", "private_subnet_ids", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
            {
                "module_name": "security",
                "resource_area": "security",
                "title": "Public API security",
                "description": "Provision load balancer and service security groups for the API.",
                "step_ids": ["network"],
                "variable_keys": ["region", "service_port"],
                "outputs": ["load_balancer_security_group_id", "service_security_group_id", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
            {
                "module_name": "compute",
                "resource_area": "compute",
                "title": "Public API runtime",
                "description": "Provision the ALB, ECS cluster, task definition, and service.",
                "step_ids": ["runtime", "validate"],
                "variable_keys": ["region", "service_port", "desired_count"],
                "outputs": ["service_name", "service_url", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
        ],
    },
    "aws-rds-app-stack": {
        "blueprint_id": "aws-rds-app-stack",
        "stack": {
            "path": "/stacks/main",
            "module_order": ["network", "security", "compute", "database"],
        },
        "modules": [
            {
                "module_name": "network",
                "resource_area": "network",
                "title": "Stateful app network",
                "description": "Provision app and database subnets plus VPC routing for the stack.",
                "step_ids": ["network"],
                "variable_keys": ["region"],
                "outputs": ["vpc_id", "app_subnet_ids", "database_subnet_ids", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
            {
                "module_name": "security",
                "resource_area": "security",
                "title": "Stateful app security",
                "description": "Provision application and database security groups.",
                "step_ids": ["network", "validate"],
                "variable_keys": ["region", "public_ingress_cidr"],
                "outputs": ["app_security_group_id", "database_security_group_id", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
            {
                "module_name": "compute",
                "resource_area": "compute",
                "title": "Stateful app compute",
                "description": "Provision the application EC2 host and IAM instance profile.",
                "step_ids": ["stateful", "validate"],
                "variable_keys": ["region"],
                "outputs": ["instance_id", "private_ip", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
            {
                "module_name": "database",
                "resource_area": "database",
                "title": "Stateful app database",
                "description": "Provision PostgreSQL, subnet groups, and Secrets Manager metadata.",
                "step_ids": ["stateful", "validate"],
                "variable_keys": ["region", "database_instance_class"],
                "outputs": ["db_instance_identifier", "db_endpoint", "ansible_hosts", CONFIGURATION_TARGETS_OUTPUT_NAME],
            },
        ],
    },
}


def get_provisioning_terraform_template(blueprint_id: str) -> ProvisioningTerraformTemplate:
    try:
        return PROVISIONING_TERRAFORM_TEMPLATES[blueprint_id]
    except KeyError as exc:
        raise ValueError("terraform_template_not_found") from exc
