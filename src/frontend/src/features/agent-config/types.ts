export type AgentConfigTab = "memory" | "skills" | "templates" | "credentials";

export interface ProviderField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}
