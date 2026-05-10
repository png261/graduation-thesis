import * as fs from "fs"
import * as path from "path"
import * as yaml from "yaml"

const MAX_STACK_NAME_BASE_LENGTH = 35

export type DeploymentType = "docker" | "zip"

/**
 * Network mode for the AgentCore Runtime.
 * - PUBLIC: Runtime is accessible over the public internet (default).
 * - VPC: Runtime is deployed into a user-provided VPC for private network isolation.
 */
export type NetworkMode = "PUBLIC" | "VPC"

/**
 * VPC configuration for deploying the AgentCore Runtime into an existing VPC.
 * When omitted and VPC networking is required, the stack creates a managed VPC.
 */
export interface VpcConfig {
  /** The ID of the existing VPC to deploy into (e.g. "vpc-0abc1234def56789a"). */
  vpc_id?: string
  /** List of subnet IDs within the VPC where the runtime will be placed. */
  subnet_ids?: string[]
  /** Optional list of security group IDs. If omitted, a default security group is created. */
  security_group_ids?: string[]
}

export interface S3FilesConfig {
  /** Enable shared S3-backed file storage mounted into AgentCore Runtime. */
  enabled: boolean
  /** Runtime mount path. AgentCore requires /mnt/<single-segment>. Defaults to /mnt/s3. */
  mount_path: string
  /** Optional S3 key prefix backing the file system. */
  prefix?: string
  /** Access point root exposed to the agent. Defaults to /. */
  root_directory: string
  /** POSIX user id for access point file operations. Defaults to 1000. */
  uid: string
  /** POSIX group id for access point file operations. Defaults to 1000. */
  gid: string
}

export interface OpenAIConfig {
  /** OpenAI API base URL. Defaults to https://api.openai.com/v1 */
  base_url: string
  /** OpenAI model ID to use. Defaults to gpt-4o */
  model_id: string
}

export interface GitHubConfig {
  /** GitHub App slug used in https://github.com/apps/<slug>/installations/new. */
  app_slug: string
  /** GitHub App numeric app id used for JWT creation. */
  app_id: string
  /** AgentCore Identity API key credential provider containing the app private key. */
  credential_provider_name: string
}

export interface AppConfig {
  stack_name_base: string
  admin_user_email?: string | null
  backend: {
    deployment_type: DeploymentType
    /** Network mode for the AgentCore Runtime. Defaults to "PUBLIC". */
    network_mode: NetworkMode
    /** VPC configuration. Required when network_mode is "VPC". */
    vpc?: VpcConfig
    /**
     * Enable long-term memory (SemanticMemoryStrategy) for the agent.
     * When true, the agent extracts and retrieves facts across sessions.
     * This incurs additional costs: $0.75/1,000 records stored + $0.50/1,000 retrievals.
     * Defaults to false.
     */
    use_long_term_memory: boolean
    /**
     * Number of facts to retrieve per turn when long-term memory is enabled.
     * Maps to the top_k parameter of RetrievalConfig. Defaults to 10.
     */
    ltm_top_k: number
    /**
     * Minimum similarity threshold for long-term memory retrieval.
     * Maps to the relevance_score parameter of RetrievalConfig. Defaults to 0.3.
     */
    ltm_relevance_score: number
    /** OpenAI configuration for the agent model. */
    openai?: OpenAIConfig
    /** GitHub App configuration for repository workspaces. */
    github?: GitHubConfig
    s3_files: S3FilesConfig
  }
}

export class ConfigManager {
  private config: AppConfig

  constructor(configFile: string) {
    this.config = this._loadConfig(configFile)
  }

  private _loadConfig(configFile: string): AppConfig {
    let configPath: string

    // Uses the specified configFile if the file exists
    // otherwise fallsback to existing behavior where the configFile should be
    // named config.yaml and be in the infra-cdk directory. Throws an error if the
    // configFile does not exist and is not the default "config.yaml"
    if (fs.existsSync(configFile)) {
      configPath = configFile
    } else {
      if (path.basename(configFile) !== "config.yaml") {
        throw new Error(`Configuration file '${configFile}' not found.`)
      }
      const defaultConfigPath = path.join(__dirname, "..", "..", configFile) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      configPath = defaultConfigPath
    }
    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Configuration file ${configPath} does not exist. Please create config.yaml file.`
      )
    }

    try {
      const fileContent = fs.readFileSync(configPath, "utf8")
      const parsedConfig = yaml.parse(fileContent) as AppConfig

      const deploymentType = parsedConfig.backend?.deployment_type || "zip"
      if (deploymentType !== "docker" && deploymentType !== "zip") {
        throw new Error(
          `Invalid deployment_type '${deploymentType}' in ${configPath}. Must be 'docker' or 'zip'.`
        )
      }

      const stackNameBase = parsedConfig.stack_name_base
      if (!stackNameBase) {
        throw new Error(`stack_name_base is required in ${configPath}`)
      }
      if (stackNameBase.length > MAX_STACK_NAME_BASE_LENGTH) {
        throw new Error(
          `stack_name_base '${stackNameBase}' is too long (${stackNameBase.length} chars). ` +
            `Maximum length is ${MAX_STACK_NAME_BASE_LENGTH} characters due to AWS AgentCore runtime naming constraints.`
        )
      }

      const s3FilesConfig = parsedConfig.backend?.s3_files
      const s3FilesEnabled = parsedConfig.backend?.s3_files?.enabled !== false

      // Validate network_mode if provided. S3 Files mounts require VPC runtime networking,
      // so enabling shared files makes VPC the effective default.
      const networkMode = s3FilesEnabled ? "VPC" : parsedConfig.backend?.network_mode || "PUBLIC"
      if (networkMode !== "PUBLIC" && networkMode !== "VPC") {
        throw new Error(
          `Invalid network_mode '${networkMode}' in ${configPath}. Must be 'PUBLIC' or 'VPC'.`
        )
      }

      // Validate provided VPC configuration. If network_mode is VPC and no VPC is provided,
      // BackendStack creates a managed VPC for the runtime and S3 Files mount targets.
      const vpcConfig = parsedConfig.backend?.vpc
      if (vpcConfig) {
        if (!vpcConfig.vpc_id) {
          throw new Error(
            `backend.vpc.vpc_id is required in ${configPath} when backend.vpc is provided.`
          )
        }
        if (!vpcConfig.subnet_ids || vpcConfig.subnet_ids.length === 0) {
          throw new Error(
            `backend.vpc.subnet_ids must contain at least one subnet ID in ${configPath} when backend.vpc is provided.`
          )
        }
      }
      if (s3FilesEnabled) {
        if (networkMode !== "VPC") {
          throw new Error(
            `backend.network_mode must be 'VPC' in ${configPath} when backend.s3_files.enabled is true.`
          )
        }
        const mountPath = s3FilesConfig?.mount_path ?? "/mnt/s3"
        if (!/^\/mnt\/[a-zA-Z0-9._-]+\/?$/.test(mountPath)) {
          throw new Error(
            `Invalid backend.s3_files.mount_path '${mountPath}' in ${configPath}. Must match /mnt/<name>.`
          )
        }
      }

      return {
        stack_name_base: stackNameBase,
        admin_user_email: parsedConfig.admin_user_email || null,
        backend: {
          deployment_type: deploymentType,
          network_mode: networkMode,
          vpc: vpcConfig,
          use_long_term_memory: parsedConfig.backend?.use_long_term_memory === true,
          ltm_top_k: parsedConfig.backend?.ltm_top_k ?? 10,
          ltm_relevance_score: parsedConfig.backend?.ltm_relevance_score ?? 0.3,
          openai: parsedConfig.backend?.openai
            ? {
                base_url: parsedConfig.backend.openai.base_url || "https://api.openai.com/v1",
                model_id: parsedConfig.backend.openai.model_id || "gpt-4o",
              }
            : undefined,
          github: {
            app_slug: parsedConfig.backend?.github?.app_slug || "",
            app_id: parsedConfig.backend?.github?.app_id || "",
            credential_provider_name:
              parsedConfig.backend?.github?.credential_provider_name ||
              `${stackNameBase}-github-app`,
          },
          s3_files: {
            enabled: s3FilesEnabled,
            mount_path: s3FilesConfig?.mount_path ?? "/mnt/s3",
            prefix: s3FilesConfig?.prefix,
            root_directory: s3FilesConfig?.root_directory ?? "/",
            uid: String(s3FilesConfig?.uid ?? "1000"),
            gid: String(s3FilesConfig?.gid ?? "1000"),
          },
        },
      }
    } catch (error) {
      throw new Error(`Failed to parse configuration file ${configPath}: ${error}`)
    }
  }

  public getProps(): AppConfig {
    return this.config
  }

  public get(key: string, defaultValue?: any): any {
    const keys = key.split(".")
    let value: any = this.config

    for (const k of keys) {
      if (typeof value === "object" && value !== null && k in value) {
        // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop — iterates over a trusted local YAML config object, not user-controlled input
        value = value[k]
      } else {
        return defaultValue
      }
    }

    return value
  }
}
