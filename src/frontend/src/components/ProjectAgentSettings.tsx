import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  buildSkillContent,
  deleteSkill,
  getMemory,
  getProjectActiveBlueprints,
  getProjectBlueprintRun,
  listProjectConfigurationAnsibleHistory,
  listProjectProvisioningTerraformHistory,
  listSkills,
  type ProjectAnsibleGenerationRecord,
  type ProjectActiveBlueprintSelection,
  type ProjectActiveBlueprints,
  type ProjectBlueprintRunSnapshot,
  type ProjectTerraformGenerationRecord,
  type Skill,
  updateMemory,
  upsertSkill,
} from "../api/projects/index";
import {
  AnsibleGenerationActionArea,
  BlueprintProvenancePanel,
  TerraformGenerationActionArea,
} from "./assistant-ui/blueprint-provenance-card";
import {
  formatAnsibleGenerationHistorySummary,
  formatAnsibleGenerationTime,
} from "../features/project-config/ansibleGenerationState";
import {
  formatTerraformGenerationHistorySummary,
  formatTerraformGenerationTime,
} from "../features/project-config/terraformGenerationState";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

type AgentTab = "memory" | "skills";
type EditingSkill = Skill | "new" | null;
const EMPTY_ACTIVE_BLUEPRINTS: ProjectActiveBlueprints = {
  provisioning: null,
  configuration: null,
};

interface SkillFormProps {
  initial?: Skill;
  onSave: (name: string, description: string, body: string) => Promise<void>;
  onCancel: () => void;
}

function extractSkillBody(content?: string): string {
  if (!content) return "";
  return content.replace(/^---[\s\S]*?---\n?/, "").trimStart();
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function useSavedFlag(timeoutMs: number) {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markSaved = useCallback(() => {
    setSaved(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { saved, markSaved };
}

function useProjectAgentData(projectId: string) {
  const [memory, setMemory] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeBlueprints, setActiveBlueprints] = useState<ProjectActiveBlueprints>(EMPTY_ACTIVE_BLUEPRINTS);
  const [latestBlueprintRun, setLatestBlueprintRun] = useState<ProjectBlueprintRunSnapshot | null>(null);

  const reload = useCallback(async () => {
    const [nextMemory, nextSkills, blueprintState] = await Promise.all([
      getMemory(projectId),
      listSkills(projectId),
      loadBlueprintState(projectId),
    ]);
    setMemory(nextMemory);
    setSkills(nextSkills);
    setActiveBlueprints(blueprintState.activeBlueprints);
    setLatestBlueprintRun(blueprintState.latestBlueprintRun);
  }, [projectId]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  return {
    memory,
    setMemory,
    skills,
    setSkills,
    activeBlueprints,
    latestBlueprintRun,
    reload,
  };
}

function useTerraformGenerationHistory(projectId: string) {
  const [history, setHistory] = useState<ProjectTerraformGenerationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setHistory(await listProjectProvisioningTerraformHistory(projectId));
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load Terraform generation history");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  return { error, history, latest: history[0] ?? null, loading, reload };
}

function useAnsibleGenerationHistory(projectId: string) {
  const [history, setHistory] = useState<ProjectAnsibleGenerationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setHistory(await listProjectConfigurationAnsibleHistory(projectId));
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load Ansible generation history");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  return { error, history, latest: history[0] ?? null, loading, reload };
}

function selectionTimestamp(selection: ProjectActiveBlueprintSelection | null) {
  return selection?.latestRunCreatedAt ? Date.parse(selection.latestRunCreatedAt) : 0;
}

function latestBlueprintSelection(activeBlueprints: ProjectActiveBlueprints) {
  const selections = [activeBlueprints.provisioning, activeBlueprints.configuration].filter(
    (item): item is ProjectActiveBlueprintSelection => item !== null,
  );
  selections.sort((left, right) => selectionTimestamp(right) - selectionTimestamp(left));
  return selections[0] ?? null;
}

async function loadBlueprintState(projectId: string) {
  const activeBlueprints = await getProjectActiveBlueprints(projectId);
  const latestSelection = latestBlueprintSelection(activeBlueprints);
  if (!latestSelection?.latestRunId) {
    return { activeBlueprints, latestBlueprintRun: null };
  }
  return {
    activeBlueprints,
    latestBlueprintRun: await getProjectBlueprintRun(projectId, latestSelection.latestRunId),
  };
}

function useMemorySaveAction(projectId: string, memory: string) {
  const [saving, setSaving] = useState(false);
  const { saved, markSaved } = useSavedFlag(1800);

  const saveMemory = useCallback(async () => {
    setSaving(true);
    try {
      await updateMemory(projectId, memory);
      markSaved();
    } finally {
      setSaving(false);
    }
  }, [markSaved, memory, projectId]);

  return { saving, saved, saveMemory };
}

function useSkillActions(projectId: string, setSkills: React.Dispatch<React.SetStateAction<Skill[]>>, setEditingSkill: (value: EditingSkill) => void) {
  const saveSkill = useCallback(async (name: string, description: string, body: string) => {
    const content = buildSkillContent(name, description, body);
    await upsertSkill(projectId, name, content, description);
    setSkills(await listSkills(projectId));
    setEditingSkill(null);
  }, [projectId, setEditingSkill, setSkills]);

  const deleteSkillByName = useCallback(async (skillName: string) => {
    if (!confirm(`Delete skill \"${skillName}\"?`)) return;
    await deleteSkill(projectId, skillName);
    setSkills((prev) => prev.filter((skill) => skill.name !== skillName));
  }, [projectId, setSkills]);

  return { saveSkill, deleteSkillByName };
}

function SkillNameField({ name, isEdit, setName }: { name: string; isEdit: boolean; setName: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="skill-name">Skill name</Label>
      <Input id="skill-name" value={name} onChange={(event) => setName(event.target.value)} disabled={isEdit} placeholder="e.g. opentofu-review" />
    </div>
  );
}

function SkillDescriptionField({ description, setDescription }: { description: string; setDescription: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="skill-description">Description</Label>
      <Input id="skill-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="When and why this skill should be used" />
    </div>
  );
}

function SkillBodyField({ body, setBody }: { body: string; setBody: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="skill-body">Instructions</Label>
      <Textarea id="skill-body" className="min-h-48 font-mono text-xs" value={body} onChange={(event) => setBody(event.target.value)} placeholder="# Skill\n\n## When to use\n..." spellCheck={false} />
    </div>
  );
}

function SkillErrorAlert({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
      <AlertTitle>Save failed</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}

function useSkillFormState(initial: Skill | undefined, onSave: SkillFormProps["onSave"]) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(() => extractSkillBody(initial?.content));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = useCallback(async () => {
    const normalizedName = normalizeSkillName(name);
    if (!normalizedName) return setError("Name is required");
    setSaving(true);
    setError("");
    try {
      await onSave(normalizedName, description, body);
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save skill");
    } finally {
      setSaving(false);
    }
  }, [body, description, name, onSave]);

  return { name, description, body, saving, error, setName, setDescription, setBody, save };
}

function SkillForm({ initial, onSave, onCancel }: SkillFormProps) {
  const isEdit = !!initial;
  const form = useSkillFormState(initial, onSave);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Edit Skill" : "Create Skill"}</CardTitle>
        <CardDescription>Skill instructions are saved in `skills/{"{name}"}/SKILL.md`.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SkillNameField name={form.name} isEdit={isEdit} setName={form.setName} />
        <SkillDescriptionField description={form.description} setDescription={form.setDescription} />
        <SkillBodyField body={form.body} setBody={form.setBody} />
        <SkillErrorAlert error={form.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={form.save} disabled={form.saving}>{form.saving ? "Saving..." : "Save skill"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MemoryTabContent({ memory, setMemory, saved, saving, saveMemory }: { memory: string; setMemory: (value: string) => void; saved: boolean; saving: boolean; saveMemory: () => void }) {
  return (
    <TabsContent value="memory" className="space-y-3 pt-3">
      <Textarea className="min-h-72 font-mono text-sm" value={memory} onChange={(event) => setMemory(event.target.value)} spellCheck={false} />
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-green-300">Saved</span>}
        <Button onClick={saveMemory} disabled={saving}>{saving ? "Saving..." : "Save Memory"}</Button>
      </div>
    </TabsContent>
  );
}

function EmptySkillsState() {
  return (
    <Alert>
      <AlertTitle>No skills yet</AlertTitle>
      <AlertDescription>Add your first skill to extend agent behaviors.</AlertDescription>
    </Alert>
  );
}

function SkillRow({ skill, onEdit, onDelete }: { skill: Skill; onEdit: (value: Skill) => void; onDelete: (name: string) => void }) {
  return (
    <Card className="bg-[var(--da-elevated)]">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium text-[var(--da-text)]">{skill.name}</p>
          {skill.description && <p className="mt-1 text-xs text-[var(--da-muted)]">{skill.description}</p>}
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => onEdit(skill)}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => onDelete(skill.name)}><Trash2 className="h-4 w-4 text-red-300" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SkillsList({ skills, onEdit, onDelete }: { skills: Skill[]; onEdit: (value: Skill) => void; onDelete: (name: string) => void }) {
  if (skills.length < 1) return <EmptySkillsState />;
  return <div className="space-y-2">{skills.map((skill) => <SkillRow key={skill.name} skill={skill} onEdit={onEdit} onDelete={onDelete} />)}</div>;
}

function SkillsTabContent(props: {
  editingSkill: EditingSkill;
  setEditingSkill: (value: EditingSkill) => void;
  skills: Skill[];
  saveSkill: (name: string, description: string, body: string) => Promise<void>;
  deleteSkillByName: (name: string) => void;
}) {
  const { editingSkill, setEditingSkill, skills, saveSkill, deleteSkillByName } = props;
  if (editingSkill !== null) {
    return (
      <TabsContent value="skills" className="space-y-3 pt-3">
        <SkillForm initial={editingSkill === "new" ? undefined : editingSkill} onSave={saveSkill} onCancel={() => setEditingSkill(null)} />
      </TabsContent>
    );
  }

  return (
    <TabsContent value="skills" className="space-y-3 pt-3">
      <SkillsList skills={skills} onEdit={setEditingSkill} onDelete={deleteSkillByName} />
      <Button variant="outline" className="w-full" onClick={() => setEditingSkill("new")}>
        <Plus className="h-4 w-4" />
        Add Skill
      </Button>
    </TabsContent>
  );
}

function ProjectAgentTabs({ setTab }: { setTab: (value: AgentTab) => void }) {
  return (
    <TabsList className="grid w-full grid-cols-2">
      <TabsTrigger value="memory" onClick={() => setTab("memory")}>Memory</TabsTrigger>
      <TabsTrigger value="skills" onClick={() => setTab("skills")}>Skills</TabsTrigger>
    </TabsList>
  );
}

function EmptyBlueprintState() {
  return (
    <Alert>
      <AlertDescription>No blueprint approved yet</AlertDescription>
    </Alert>
  );
}

function selectionBlueprint(selection: ProjectActiveBlueprintSelection) {
  return {
    id: selection.blueprintId,
    kind: selection.kind,
    name: selection.blueprintName,
    summary: selection.summary,
    resourcesOrActions: selection.resourcesOrActions,
    requiredInputs: selection.requiredInputs,
    steps: selection.steps,
  };
}

function BlueprintSelectionSection({
  label,
  selection,
}: {
  label: string;
  selection: ProjectActiveBlueprintSelection | null;
}) {
  if (!selection) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--da-text)]">{label}</p>
        <EmptyBlueprintState />
      </div>
    );
  }
  return (
    <BlueprintProvenancePanel
      heading={label}
      blueprint={selectionBlueprint(selection)}
      note={selection.selectedAt ? `Approved at ${selection.selectedAt}` : null}
    />
  );
}

function LatestBlueprintSnapshotSection({
  run,
}: {
  run: ProjectBlueprintRunSnapshot | null;
}) {
  if (!run) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-[var(--da-text)]">Latest Blueprint Snapshot</p>
        <EmptyBlueprintState />
      </div>
    );
  }
  return (
    <BlueprintProvenancePanel
      heading="Latest Blueprint Snapshot"
      blueprint={run.snapshot}
      note={run.createdAt ? `Snapshot created at ${run.createdAt}` : null}
    />
  );
}

function EmptyTerraformState({ message }: { message: string }) {
  return (
    <Alert>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function LatestTerraformGenerationSection(props: {
  error: string;
  generation: ProjectTerraformGenerationRecord | null;
  loading: boolean;
}) {
  const { error, generation, loading } = props;
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[var(--da-text)]">Latest Terraform Generation</p>
      {error ? (
        <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
          <AlertTitle>History failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading && !generation ? <EmptyTerraformState message="Loading Terraform generation history..." /> : null}
      {!loading && !generation ? <EmptyTerraformState message="No Terraform generation has been recorded yet." /> : null}
      {generation ? (
        <Card className="border-[var(--da-border)] bg-[var(--da-elevated)]">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--da-text)]">{generation.summary.headline}</p>
                <p className="mt-1 text-sm text-[var(--da-muted)]">
                  {formatTerraformGenerationHistorySummary(generation)}
                </p>
              </div>
              <Badge variant="outline">{formatTerraformGenerationTime(generation.createdAt)}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {generation.moduleNames.map((module) => (
                <Badge key={module} variant="secondary">
                  {module}
                </Badge>
              ))}
            </div>
            <div className="space-y-1 text-sm text-[var(--da-muted)]">
              <p>Stack path: {generation.stackPath}</p>
              <p>Provenance report: {generation.provenanceReportPath}</p>
              <p>Most recent compare summary: {formatTerraformGenerationHistorySummary(generation)}</p>
            </div>
            {generation.targetContract ? (
              <div className="rounded border border-white/10 bg-black/20 p-3 text-sm text-[var(--da-muted)]">
                <p className="font-semibold text-white">Terraform target contract</p>
                <p className="mt-2">Schema version: {generation.targetContract.schemaVersion}</p>
                <p>Module output: {generation.targetContract.moduleOutputName}</p>
                <p>Canonical output: {generation.targetContract.canonicalOutputName}</p>
                <p>Legacy output: {generation.targetContract.legacyOutputName}</p>
                <p>Deduped by: {generation.targetContract.dedupeKey}</p>
                <p>Required fields: {generation.targetContract.requiredFields.join(", ")}</p>
                <p>Optional fields: {generation.targetContract.optionalFields.join(", ")}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function GenerationHistorySection(props: {
  history: ProjectTerraformGenerationRecord[];
  loading: boolean;
}) {
  const { history, loading } = props;
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[var(--da-text)]">Generation History</p>
      {loading && history.length < 1 ? <EmptyTerraformState message="Loading generation history..." /> : null}
      {!loading && history.length < 1 ? <EmptyTerraformState message="Terraform generation history will appear after the first successful write." /> : null}
      {history.length > 0 ? (
        <div className="space-y-3">
          {history.map((generation) => (
            <Card key={generation.id} className="border-[var(--da-border)] bg-[var(--da-elevated)]">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--da-text)]">{generation.summary.headline}</p>
                    <p className="mt-1 text-sm text-[var(--da-muted)]">
                      {formatTerraformGenerationHistorySummary(generation)}
                    </p>
                  </div>
                  <Badge variant="outline">{formatTerraformGenerationTime(generation.createdAt)}</Badge>
                </div>
                <p className="text-xs text-[var(--da-muted)]">Generation ID: {generation.id}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LatestAnsibleGenerationSection(props: {
  error: string;
  generation: ProjectAnsibleGenerationRecord | null;
  loading: boolean;
}) {
  const { error, generation, loading } = props;
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[var(--da-text)]">Latest Ansible Generation</p>
      {error ? (
        <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
          <AlertTitle>History failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading && !generation ? <EmptyTerraformState message="Loading Ansible generation history..." /> : null}
      {!loading && !generation ? <EmptyTerraformState message="No Ansible generation has been recorded yet." /> : null}
      {generation ? (
        <Card className="border-[var(--da-border)] bg-[var(--da-elevated)]">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--da-text)]">{generation.summary.headline}</p>
                <p className="mt-1 text-sm text-[var(--da-muted)]">
                  {formatAnsibleGenerationHistorySummary(generation)}
                </p>
              </div>
              <Badge variant="outline">{formatAnsibleGenerationTime(generation.createdAt)}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {generation.targetModules.map((module) => (
                <Badge key={module} variant="secondary">
                  {module}
                </Badge>
              ))}
            </div>
            <div className="space-y-1 text-sm text-[var(--da-muted)]">
              <p>Playbook path: {generation.playbookPath}</p>
              <p>Provenance report: {generation.provenanceReportPath}</p>
              <p>Most recent compare summary: {formatAnsibleGenerationHistorySummary(generation)}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function AnsibleGenerationHistorySection(props: {
  history: ProjectAnsibleGenerationRecord[];
  loading: boolean;
}) {
  const { history, loading } = props;
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[var(--da-text)]">Generation History</p>
      {loading && history.length < 1 ? <EmptyTerraformState message="Loading generation history..." /> : null}
      {!loading && history.length < 1 ? <EmptyTerraformState message="Ansible generation history will appear after the first successful write." /> : null}
      {history.length > 0 ? (
        <div className="space-y-3">
          {history.map((generation) => (
            <Card key={generation.id} className="border-[var(--da-border)] bg-[var(--da-elevated)]">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--da-text)]">{generation.summary.headline}</p>
                    <p className="mt-1 text-sm text-[var(--da-muted)]">
                      {formatAnsibleGenerationHistorySummary(generation)}
                    </p>
                  </div>
                  <Badge variant="outline">{formatAnsibleGenerationTime(generation.createdAt)}</Badge>
                </div>
                <p className="text-xs text-[var(--da-muted)]">Generation ID: {generation.id}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectAgentSettings({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<AgentTab>("memory");
  const [editingSkill, setEditingSkill] = useState<EditingSkill>(null);
  const data = useProjectAgentData(projectId);
  const terraformHistory = useTerraformGenerationHistory(projectId);
  const ansibleHistory = useAnsibleGenerationHistory(projectId);
  const memoryState = useMemorySaveAction(projectId, data.memory);
  const skillActions = useSkillActions(projectId, data.setSkills, setEditingSkill);
  const stableSetMemory = useMemo(() => (value: string) => data.setMemory(value), [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Settings</CardTitle>
        <CardDescription>Manage project memory, reusable skills, and approved blueprints.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={tab} onValueChange={(value) => setTab(value as AgentTab)}>
          <ProjectAgentTabs setTab={setTab} />
          <MemoryTabContent memory={data.memory} setMemory={stableSetMemory} saved={memoryState.saved} saving={memoryState.saving} saveMemory={() => void memoryState.saveMemory()} />
          <SkillsTabContent editingSkill={editingSkill} setEditingSkill={setEditingSkill} skills={data.skills} saveSkill={skillActions.saveSkill} deleteSkillByName={(name) => void skillActions.deleteSkillByName(name)} />
        </Tabs>
        <Separator />
        <div className="space-y-6">
          {data.activeBlueprints.provisioning ? (
            <BlueprintProvenancePanel
              heading="Active Provisioning Blueprint"
              blueprint={selectionBlueprint(data.activeBlueprints.provisioning)}
              footer={
                <TerraformGenerationActionArea
                  blueprint={selectionBlueprint(data.activeBlueprints.provisioning)}
                  latestGeneration={terraformHistory.latest}
                  onGenerated={() => void terraformHistory.reload()}
                  projectId={projectId}
                />
              }
              note={
                data.activeBlueprints.provisioning.selectedAt
                  ? `Approved at ${data.activeBlueprints.provisioning.selectedAt}`
                  : null
              }
            />
          ) : (
            <BlueprintSelectionSection
              label="Active Provisioning Blueprint"
              selection={data.activeBlueprints.provisioning}
            />
          )}
          {data.activeBlueprints.configuration ? (
            <BlueprintProvenancePanel
              heading="Active Configuration Blueprint"
              blueprint={selectionBlueprint(data.activeBlueprints.configuration)}
              footer={
                <AnsibleGenerationActionArea
                  blueprint={selectionBlueprint(data.activeBlueprints.configuration)}
                  latestGeneration={ansibleHistory.latest}
                  onGenerated={() => void ansibleHistory.reload()}
                  projectId={projectId}
                />
              }
              note={
                data.activeBlueprints.configuration.selectedAt
                  ? `Approved at ${data.activeBlueprints.configuration.selectedAt}`
                  : null
              }
            />
          ) : (
            <BlueprintSelectionSection
              label="Active Configuration Blueprint"
              selection={data.activeBlueprints.configuration}
            />
          )}
          <LatestBlueprintSnapshotSection run={data.latestBlueprintRun} />
          <LatestTerraformGenerationSection
            error={terraformHistory.error}
            generation={terraformHistory.latest}
            loading={terraformHistory.loading}
          />
          <GenerationHistorySection
            history={terraformHistory.history}
            loading={terraformHistory.loading}
          />
          <LatestAnsibleGenerationSection
            error={ansibleHistory.error}
            generation={ansibleHistory.latest}
            loading={ansibleHistory.loading}
          />
          <AnsibleGenerationHistorySection
            history={ansibleHistory.history}
            loading={ansibleHistory.loading}
          />
        </div>
      </CardContent>
    </Card>
  );
}
