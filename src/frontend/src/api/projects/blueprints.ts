import { apiJson, apiRequest } from "../client";
import type {
  BlueprintKind,
  ProjectActiveBlueprintSelection,
  ProjectAnsibleGenerationPreview,
  ProjectAnsibleGenerationRecord,
  ProjectAnsibleGenerationResult,
  ProjectBlueprintCatalogItem,
  ProjectBlueprintRunSnapshot,
  ProjectTerraformGenerationPreview,
  ProjectTerraformGenerationRecord,
  ProjectTerraformGenerationResult,
} from "./types";

interface BlueprintCatalogResponse {
  blueprints: ProjectBlueprintCatalogItem[];
}

interface ActiveBlueprintsResponse {
  provisioning: ProjectActiveBlueprintSelection | null;
  configuration: ProjectActiveBlueprintSelection | null;
}

interface BlueprintRunResponse {
  run: ProjectBlueprintRunSnapshot;
}

interface TerraformPreviewResponse extends ProjectTerraformGenerationPreview {}

interface TerraformGenerateResponse extends ProjectTerraformGenerationResult {}

interface TerraformHistoryResponse {
  items: ProjectTerraformGenerationRecord[];
}

interface AnsiblePreviewResponse extends ProjectAnsibleGenerationPreview {}

interface AnsibleGenerateResponse extends ProjectAnsibleGenerationResult {}

interface AnsibleHistoryResponse {
  items: ProjectAnsibleGenerationRecord[];
}

export async function listProjectBlueprintCatalog(
  projectId: string,
  kind?: BlueprintKind,
): Promise<ProjectBlueprintCatalogItem[]> {
  const suffix = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  const res = await apiRequest(`/api/projects/${projectId}/blueprints/catalog${suffix}`, {
    credentials: "include",
  });
  const data = await apiJson<BlueprintCatalogResponse>(res);
  return data.blueprints;
}

export async function getProjectActiveBlueprints(
  projectId: string,
): Promise<ActiveBlueprintsResponse> {
  const res = await apiRequest(`/api/projects/${projectId}/blueprints/active`, {
    credentials: "include",
  });
  return apiJson<ActiveBlueprintsResponse>(res);
}

export async function setProjectActiveBlueprint(
  projectId: string,
  body: {
    kind: BlueprintKind;
    blueprintId: string;
    inputs?: Record<string, string>;
  },
): Promise<ActiveBlueprintsResponse> {
  const res = await apiRequest(`/api/projects/${projectId}/blueprints/active`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: body.kind,
      blueprint_id: body.blueprintId,
      inputs: body.inputs ?? {},
    }),
  });
  return apiJson<ActiveBlueprintsResponse>(res);
}

export async function createProjectBlueprintRun(
  projectId: string,
  body: {
    threadId: string;
    kind: BlueprintKind;
    blueprintId: string;
    inputs?: Record<string, string>;
  },
): Promise<ProjectBlueprintRunSnapshot> {
  const res = await apiRequest(`/api/projects/${projectId}/blueprints/runs`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      thread_id: body.threadId,
      kind: body.kind,
      blueprint_id: body.blueprintId,
      inputs: body.inputs ?? {},
    }),
  });
  const data = await apiJson<BlueprintRunResponse>(res);
  return data.run;
}

export async function getProjectBlueprintRun(
  projectId: string,
  runId: string,
): Promise<ProjectBlueprintRunSnapshot> {
  const res = await apiRequest(`/api/projects/${projectId}/blueprints/runs/${runId}`, {
    credentials: "include",
  });
  const data = await apiJson<BlueprintRunResponse>(res);
  return data.run;
}

export async function previewProjectProvisioningTerraform(
  projectId: string,
): Promise<ProjectTerraformGenerationPreview> {
  const res = await apiRequest(`/api/projects/${projectId}/blueprints/provisioning/terraform/preview`, {
    method: "POST",
    credentials: "include",
  });
  return apiJson<TerraformPreviewResponse>(res);
}

export async function generateProjectProvisioningTerraform(
  projectId: string,
  body: {
    previewToken: string;
    confirmWrite: boolean;
  },
): Promise<ProjectTerraformGenerationResult> {
  const res = await apiRequest(`/api/projects/${projectId}/blueprints/provisioning/terraform/generate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      preview_token: body.previewToken,
      confirm_write: body.confirmWrite,
    }),
  });
  return apiJson<TerraformGenerateResponse>(res);
}

export async function listProjectProvisioningTerraformHistory(
  projectId: string,
  limit = 20,
): Promise<ProjectTerraformGenerationRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await apiRequest(
    `/api/projects/${projectId}/blueprints/provisioning/terraform/history?${params.toString()}`,
    { credentials: "include" },
  );
  const data = await apiJson<TerraformHistoryResponse>(res);
  return data.items;
}

export async function previewProjectConfigurationAnsible(
  projectId: string,
): Promise<ProjectAnsibleGenerationPreview> {
  const res = await apiRequest(`/api/projects/${projectId}/blueprints/configuration/ansible/preview`, {
    method: "POST",
    credentials: "include",
  });
  return apiJson<AnsiblePreviewResponse>(res);
}

export async function generateProjectConfigurationAnsible(
  projectId: string,
  body: {
    previewToken: string;
    confirmWrite: boolean;
  },
): Promise<ProjectAnsibleGenerationResult> {
  const res = await apiRequest(`/api/projects/${projectId}/blueprints/configuration/ansible/generate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      preview_token: body.previewToken,
      confirm_write: body.confirmWrite,
    }),
  });
  return apiJson<AnsibleGenerateResponse>(res);
}

export async function listProjectConfigurationAnsibleHistory(
  projectId: string,
  limit = 20,
): Promise<ProjectAnsibleGenerationRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await apiRequest(
    `/api/projects/${projectId}/blueprints/configuration/ansible/history?${params.toString()}`,
    { credentials: "include" },
  );
  const data = await apiJson<AnsibleHistoryResponse>(res);
  return data.items;
}
