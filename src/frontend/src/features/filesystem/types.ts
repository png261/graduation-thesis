export interface TreeFile {
  type: "file";
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
}

export interface TreeFolder {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeFolder;

export type WorkflowProblemMode = "plan" | "apply" | "pipeline" | "security";

export interface WorkflowProblem {
  id: string;
  mode: WorkflowProblemMode;
  message: string;
  module?: string;
  stage?: string;
  severity?: string;
  path?: string;
  line?: number;
  ruleId?: string;
  source?: "misconfig" | "secret" | "deploy-gate";
  at: string;
}
