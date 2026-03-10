import type { ProviderField } from "./types";

export const TEMPLATES = [
  {
    id: "opentofu" as const,
    label: "OpenTofu Infrastructure",
    icon: "🏗️",
    description:
      "Pre-configure this project for OpenTofu module generation. " +
      "Adds opentofu-module and opentofu-security skills, and creates modules/ & " +
      "environments/ directories.",
    details: [
      "Skill: opentofu-module (full module scaffold)",
      "Skill: opentofu-security (encryption & IAM checklist)",
      "Sub-agents: opentofu-architect, opentofu-coder, opentofu-reviewer",
      "Workspace dirs: modules/, environments/",
    ],
  },
];

export const AWS_FIELDS: ProviderField[] = [
  { key: "aws_access_key_id", label: "Access Key ID", placeholder: "AKIA…" },
  { key: "aws_secret_access_key", label: "Secret Access Key", secret: true },
  { key: "aws_region", label: "Region", placeholder: "us-east-1" },
];

export const GCP_FIELDS: ProviderField[] = [
  { key: "gcp_project_id", label: "Project ID", placeholder: "my-project" },
  { key: "gcp_region", label: "Region", placeholder: "us-central1" },
  { key: "gcp_credentials_json", label: "Service Account JSON", secret: true },
];
