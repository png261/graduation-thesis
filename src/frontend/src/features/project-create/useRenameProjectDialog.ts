import { useEffect, useState } from "react";

export function useRenameProjectDialog({
  currentProjectName,
  onRename,
  currentProjectId,
}: {
  currentProjectName: string;
  currentProjectId: string;
  onRename: (id: string, name: string) => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    setRenameDraft(currentProjectName);
  }, [currentProjectName]);

  const handleRenameProject = () => {
    if (!currentProjectId) return;
    onRename(currentProjectId, renameDraft.trim() || currentProjectName);
    setRenameOpen(false);
  };

  return {
    renameOpen,
    setRenameOpen,
    renameDraft,
    setRenameDraft,
    handleRenameProject,
  };
}
