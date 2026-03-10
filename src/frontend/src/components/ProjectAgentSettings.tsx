import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  buildSkillContent,
  deleteSkill,
  getMemory,
  initTemplate,
  listSkills,
  type Skill,
  updateMemory,
  upsertSkill,
} from "../api/projects/index";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";

interface SkillFormProps {
  initial?: Skill;
  onSave: (name: string, description: string, body: string) => Promise<void>;
  onCancel: () => void;
}

function SkillForm({ initial, onSave, onCancel }: SkillFormProps) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(() => {
    if (!initial?.content) return "";
    return initial.content.replace(/^---[\s\S]*?---\n?/, "").trimStart();
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    const trimmedName = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(trimmedName, description, body);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save skill");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Edit Skill" : "Create Skill"}</CardTitle>
        <CardDescription>Skill instructions are saved in `skills/{"{name}"}/SKILL.md`.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="skill-name">Skill name</Label>
          <Input
            id="skill-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isEdit}
            placeholder="e.g. opentofu-review"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="skill-description">Description</Label>
          <Input
            id="skill-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="When and why this skill should be used"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="skill-body">Instructions</Label>
          <Textarea
            id="skill-body"
            className="min-h-48 font-mono text-xs"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="# Skill\n\n## When to use\n..."
            spellCheck={false}
          />
        </div>

        {error && (
          <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
            <AlertTitle>Save failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save skill"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

const TEMPLATES = [
  {
    id: "opentofu" as const,
    label: "OpenTofu Infrastructure",
    description:
      "Install opentofu-focused skills and scaffold module/environments structure.",
    details: [
      "Skills: opentofu-module, opentofu-security",
      "Sub-agents for architect/coder/reviewer",
      "Workspace dirs: modules/, environments/",
    ],
  },
];

export function ProjectAgentSettings({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<"templates" | "memory" | "skills">("templates");
  const [memory, setMemory] = useState("");
  const [memorySaving, setMemorySaving] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingSkill, setEditingSkill] = useState<Skill | null | "new">(null);
  const [templateBusy, setTemplateBusy] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState("");
  const memoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = async () => {
    const [nextMemory, nextSkills] = await Promise.all([getMemory(projectId), listSkills(projectId)]);
    setMemory(nextMemory);
    setSkills(nextSkills);
  };

  useEffect(() => {
    reload().catch(() => undefined);
    return () => {
      if (memoryTimer.current) clearTimeout(memoryTimer.current);
    };
  }, [projectId]);

  const saveMemory = async () => {
    setMemorySaving(true);
    try {
      await updateMemory(projectId, memory);
      setMemorySaved(true);
      if (memoryTimer.current) clearTimeout(memoryTimer.current);
      memoryTimer.current = setTimeout(() => setMemorySaved(false), 1800);
    } finally {
      setMemorySaving(false);
    }
  };

  const handleSaveSkill = async (name: string, description: string, body: string) => {
    const content = buildSkillContent(name, description, body);
    await upsertSkill(projectId, name, content, description);
    const next = await listSkills(projectId);
    setSkills(next);
    setEditingSkill(null);
  };

  const handleDeleteSkill = async (skillName: string) => {
    if (!confirm(`Delete skill \"${skillName}\"?`)) return;
    await deleteSkill(projectId, skillName);
    setSkills((prev) => prev.filter((s) => s.name !== skillName));
  };

  const applyTemplate = async (templateId: "opentofu") => {
    setTemplateBusy(templateId);
    setTemplateError("");
    try {
      await initTemplate(projectId, templateId);
      await reload();
    } catch (e: unknown) {
      setTemplateError(e instanceof Error ? e.message : "Failed to apply template");
    } finally {
      setTemplateBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Settings</CardTitle>
        <CardDescription>Manage project memory, reusable skills, and starter templates.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "templates" | "memory" | "skills")}> 
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-3 pt-3">
            {templateError && (
              <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
                <AlertTitle>Template failed</AlertTitle>
                <AlertDescription>{templateError}</AlertDescription>
              </Alert>
            )}
            {TEMPLATES.map((tmpl) => (
              <Card key={tmpl.id} className="bg-[var(--da-elevated)]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{tmpl.label}</CardTitle>
                  <CardDescription>{tmpl.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    {tmpl.details.map((d) => (
                      <div key={d} className="flex items-center gap-2 text-sm text-[var(--da-muted)]">
                        <Badge variant="secondary">Item</Badge>
                        <span>{d}</span>
                      </div>
                    ))}
                  </div>
                  <Button disabled={templateBusy === tmpl.id} onClick={() => applyTemplate(tmpl.id)}>
                    {templateBusy === tmpl.id ? "Applying..." : "Apply Template"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="memory" className="space-y-3 pt-3">
            <Textarea
              className="min-h-72 font-mono text-sm"
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
              spellCheck={false}
            />
            <div className="flex items-center justify-end gap-3">
              {memorySaved && <span className="text-xs text-green-300">Saved</span>}
              <Button onClick={saveMemory} disabled={memorySaving}>
                {memorySaving ? "Saving..." : "Save Memory"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="skills" className="space-y-3 pt-3">
            {editingSkill !== null ? (
              <SkillForm
                initial={editingSkill === "new" ? undefined : editingSkill}
                onSave={handleSaveSkill}
                onCancel={() => setEditingSkill(null)}
              />
            ) : (
              <>
                {skills.length === 0 ? (
                  <Alert>
                    <AlertTitle>No skills yet</AlertTitle>
                    <AlertDescription>Add your first skill to extend agent behaviors.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    {skills.map((skill) => (
                      <Card key={skill.name} className="bg-[var(--da-elevated)]">
                        <CardContent className="flex items-start justify-between gap-3 p-4">
                          <div className="min-w-0">
                            <p className="font-mono text-sm font-medium text-[var(--da-text)]">{skill.name}</p>
                            {skill.description && <p className="mt-1 text-xs text-[var(--da-muted)]">{skill.description}</p>}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" onClick={() => setEditingSkill(skill)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => handleDeleteSkill(skill.name)}>
                              <Trash2 className="h-4 w-4 text-red-300" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                <Button variant="outline" className="w-full" onClick={() => setEditingSkill("new")}> 
                  <Plus className="h-4 w-4" />
                  Add Skill
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
