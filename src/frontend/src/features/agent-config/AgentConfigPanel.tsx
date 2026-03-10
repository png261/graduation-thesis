import { useEffect, useRef, useState } from "react";

import {
  buildSkillContent,
  deleteSkill,
  getMemory,
  listSkills,
  type Skill,
  updateMemory,
  upsertSkill,
} from "../../api/projects/index";
import { CredentialsTab } from "./CredentialsTab";
import { IconClose, IconEdit, IconTrash } from "./icons";
import { SkillForm } from "./SkillForm";
import { TemplatesTab } from "./TemplatesTab";
import type { AgentConfigTab } from "./types";

export function AgentConfigPanel({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AgentConfigTab>("templates");

  const [memory, setMemory] = useState("");
  const [memorySaving, setMemorySaving] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [editingSkill, setEditingSkill] = useState<Skill | null | "new">(null);

  useEffect(() => {
    getMemory(projectId).then(setMemory).catch(console.error);
    listSkills(projectId).then(setSkills).catch(console.error);
  }, [projectId]);

  const saveMemory = async () => {
    setMemorySaving(true);
    try {
      await updateMemory(projectId, memory);
      setMemorySaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setMemorySaved(false), 2000);
    } finally {
      setMemorySaving(false);
    }
  };

  const handleSaveSkill = async (name: string, description: string, body: string) => {
    const content = buildSkillContent(name, description, body);
    await upsertSkill(projectId, name, content, description);
    const updated = await listSkills(projectId);
    setSkills(updated);
    setEditingSkill(null);
  };

  const handleDeleteSkill = async (skillName: string) => {
    if (!confirm(`Delete skill "${skillName}"?`)) return;
    await deleteSkill(projectId, skillName);
    setSkills((current) => current.filter((skill) => skill.name !== skillName));
  };

  return (
    <>
      <div className="fixed inset-0 z-20 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      <aside className="fixed inset-y-0 right-0 z-30 flex w-[480px] flex-col bg-haze shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/8 px-5 py-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-tide/70">Agent Config</p>
            <h2 className="text-base font-semibold text-ink">{projectName}</h2>
          </div>
          <button
            className="rounded-lg p-1.5 text-ink/40 hover:bg-black/8 hover:text-ink"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>

        <div className="flex border-b border-black/8">
          {([
            ["templates", "🚀 Templates"],
            ["memory", "📋 Memory"],
            ["skills", "⚡ Skills"],
            ["credentials", "🔑 Credentials"],
          ] as [AgentConfigTab, string][]).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                tab === value ? "border-b-2 border-tide text-tide" : "text-ink/50 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "templates" && (
            <TemplatesTab
              projectId={projectId}
              onInit={() => {
                getMemory(projectId).then(setMemory).catch(console.error);
                listSkills(projectId).then(setSkills).catch(console.error);
              }}
            />
          )}

          {tab === "memory" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-ink/50">
                <strong className="text-ink/80">AGENT.md</strong> memory. It is loaded at the start of
                each conversation and created when you save this form.
              </p>
              <textarea
                className="h-[calc(100vh-260px)] w-full resize-none rounded-xl border border-black/10 bg-white px-4 py-3 font-mono text-sm outline-none focus:border-tide/60 focus:ring-1 focus:ring-tide/30"
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                spellCheck={false}
              />
              <div className="flex items-center justify-end gap-3">
                {memorySaved && <span className="text-xs text-green-600">✓ Saved</span>}
                <button
                  className="rounded-lg bg-tide px-4 py-1.5 text-sm text-white hover:bg-tide/80 disabled:opacity-50"
                  onClick={saveMemory}
                  disabled={memorySaving}
                >
                  {memorySaving ? "Saving…" : "Save memory"}
                </button>
              </div>
            </div>
          )}

          {tab === "skills" && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-ink/50">
                <strong className="text-ink/80">Skills</strong> are structured workflows the agent can
                invoke (Agent Skills spec). Each skill lives in{" "}
                <code className="rounded bg-black/5 px-1">skills/{"{name}"}/SKILL.md</code>.
              </p>

              {editingSkill !== null ? (
                <SkillForm
                  initial={editingSkill === "new" ? undefined : editingSkill}
                  onSave={handleSaveSkill}
                  onCancel={() => setEditingSkill(null)}
                />
              ) : (
                <>
                  {skills.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-black/10 py-8 text-center text-sm text-ink/40">
                      No skills yet. Add one to extend the agent's capabilities.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {skills.map((skill) => (
                        <li
                          key={skill.name}
                          className="flex items-start gap-3 rounded-xl border border-black/8 bg-white px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-sm font-medium text-ink">{skill.name}</p>
                            {skill.description && <p className="mt-0.5 text-xs text-ink/50">{skill.description}</p>}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button
                              className="rounded p-1 text-ink/40 hover:bg-black/5 hover:text-ink"
                              title="Edit"
                              onClick={() => setEditingSkill(skill)}
                            >
                              <IconEdit />
                            </button>
                            <button
                              className="rounded p-1 text-ink/40 hover:bg-red-50 hover:text-red-500"
                              title="Delete"
                              onClick={() => handleDeleteSkill(skill.name)}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <button
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-tide/40 py-2.5 text-sm text-tide hover:bg-tide/5"
                    onClick={() => setEditingSkill("new")}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z" />
                    </svg>
                    Add skill
                  </button>
                </>
              )}
            </div>
          )}

          {tab === "credentials" && <CredentialsTab projectId={projectId} />}
        </div>
      </aside>
    </>
  );
}
