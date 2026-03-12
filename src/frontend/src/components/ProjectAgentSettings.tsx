import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  buildSkillContent,
  deleteSkill,
  getMemory,
  listSkills,
  type Skill,
  updateMemory,
  upsertSkill,
} from "../api/projects/index";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

type AgentTab = "memory" | "skills";
type EditingSkill = Skill | "new" | null;

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

  const reload = useCallback(async () => {
    const [nextMemory, nextSkills] = await Promise.all([getMemory(projectId), listSkills(projectId)]);
    setMemory(nextMemory);
    setSkills(nextSkills);
  }, [projectId]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [reload]);

  return { memory, setMemory, skills, setSkills, reload };
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

export function ProjectAgentSettings({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<AgentTab>("memory");
  const [editingSkill, setEditingSkill] = useState<EditingSkill>(null);
  const data = useProjectAgentData(projectId);
  const memoryState = useMemorySaveAction(projectId, data.memory);
  const skillActions = useSkillActions(projectId, data.setSkills, setEditingSkill);
  const stableSetMemory = useMemo(() => (value: string) => data.setMemory(value), [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Settings</CardTitle>
        <CardDescription>Manage project memory and reusable skills.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(value) => setTab(value as AgentTab)}>
          <ProjectAgentTabs setTab={setTab} />
          <MemoryTabContent memory={data.memory} setMemory={stableSetMemory} saved={memoryState.saved} saving={memoryState.saving} saveMemory={() => void memoryState.saveMemory()} />
          <SkillsTabContent editingSkill={editingSkill} setEditingSkill={setEditingSkill} skills={data.skills} saveSkill={skillActions.saveSkill} deleteSkillByName={(name) => void skillActions.deleteSkillByName(name)} />
        </Tabs>
      </CardContent>
    </Card>
  );
}
