import { useState } from "react";

import type { Skill } from "../../api/projects/index";

export function SkillForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Skill;
  onSave: (name: string, description: string, body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(() => {
    if (!initial?.content) return "";
    const afterFm = initial.content.replace(/^---[\s\S]*?---\n?/, "").trimStart();
    return afterFm;
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
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-ink/60">
          Skill name
          <span className="ml-1 font-normal text-ink/40">(lowercase, hyphens only)</span>
        </label>
        <input
          className="w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-tide/60 focus:ring-1 focus:ring-tide/30 disabled:opacity-50"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isEdit}
          placeholder="e.g. code-reviewer"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ink/60">Description</label>
        <input
          className="w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm outline-none focus:border-tide/60 focus:ring-1 focus:ring-tide/30"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this skill does and when to use it"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-ink/60">Instructions</label>
        <textarea
          className="h-40 w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-tide/60 focus:ring-1 focus:ring-tide/30"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="# Skill Name&#10;&#10;## When to Use&#10;...&#10;&#10;## How to Execute&#10;..."
          spellCheck={false}
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          className="rounded-lg px-3 py-1.5 text-sm text-ink/60 hover:bg-black/5"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="rounded-lg bg-tide px-4 py-1.5 text-sm text-white hover:bg-tide/80 disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save skill"}
        </button>
      </div>
    </div>
  );
}
