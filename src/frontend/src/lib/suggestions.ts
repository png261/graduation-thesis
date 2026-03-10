export interface Suggestion {
  text: string;   // short label shown on the button
  prompt: string; // full prompt sent to the agent
}

// ---------------------------------------------------------------------------
// OpenTofu infrastructure suggestions — always shown
// ---------------------------------------------------------------------------
export const SUGGESTIONS: Suggestion[] = [
  {
    text: "🌐 AWS VPC + Subnets",
    prompt:
      "Create a production-ready AWS VPC OpenTofu module with:\n" +
      "- 3 public subnets and 3 private subnets across 3 AZs\n" +
      "- Internet Gateway and NAT Gateway (one per AZ)\n" +
      "- Route tables for public and private subnets\n" +
      "- VPC Flow Logs enabled\n" +
      "- Variables: vpc_cidr, azs, public_cidrs, private_cidrs, name, tags\n" +
      "Save to modules/vpc/. Include all required files.",
  },
  {
    text: "☸️ EKS Cluster",
    prompt:
      "Create an OpenTofu module for an AWS EKS cluster with:\n" +
      "- Managed node group (configurable instance type, min/max/desired size)\n" +
      "- IRSA (IAM Roles for Service Accounts) enabled\n" +
      "- Cluster autoscaler IAM policy\n" +
      "- Security groups for cluster and nodes\n" +
      "- Variables: cluster_name, cluster_version, vpc_id, subnet_ids, node_instance_type\n" +
      "Save to modules/eks/. Include all required files.",
  },
  {
    text: "🗄️ RDS PostgreSQL",
    prompt:
      "Create an OpenTofu module for an AWS RDS PostgreSQL instance with:\n" +
      "- Multi-AZ deployment option\n" +
      "- Encrypted storage with KMS key\n" +
      "- Automated backups and maintenance window\n" +
      "- Security group limiting access to a CIDR list\n" +
      "- Parameter group and subnet group\n" +
      "- Variables: identifier, engine_version, instance_class, db_name, username, vpc_id, subnet_ids\n" +
      "Save to modules/rds/. Include all required files.",
  },
  {
    text: "🔍 Review OpenTofu code",
    prompt:
      "Use the opentofu-reviewer sub-agent to review all .tf files in the workspace.\n" +
      "Check for:\n" +
      "- HCL correctness and valid resource arguments\n" +
      "- Security issues (hardcoded secrets, open security groups, missing encryption)\n" +
      "- Best practices (naming, tagging, DRY code, variable types and descriptions)\n" +
      "- Completeness (all required files exist, all variables and outputs documented)\n" +
      "Produce a full report with PASS/FAIL verdict.",
  },
];

// Re-export for backward compat
export const OPENTOFU_SUGGESTIONS = SUGGESTIONS;
export const GENERAL_SUGGESTIONS = SUGGESTIONS;

export function getSuggestions(_projectName: string): Suggestion[] {
  return SUGGESTIONS;
}
