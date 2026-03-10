import { useState } from "react";

import { type CloudProvider } from "../../api/projects";

interface CreatedProject {
  id: string;
  name: string;
}

interface CreateDialogParams {
  createProject: (name: string, provider: CloudProvider) => Promise<CreatedProject>;
}

export function useProjectCreateDialog({ createProject }: CreateDialogParams) {
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createProvider, setCreateProvider] = useState<CloudProvider>("aws");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");

  const resetCreateDialog = () => {
    setCreateName("");
    setCreateProvider("aws");
    setCreateSubmitting(false);
    setCreateError("");
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    setCreateOpen(open);
    if (!open) resetCreateDialog();
  };

  const handleCreateProject = async () => {
    setCreateSubmitting(true);
    setCreateError("");
    try {
      await createProject(createName.trim() || "Untitled Project", createProvider);
      setCreateOpen(false);
      resetCreateDialog();
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setCreateSubmitting(false);
    }
  };

  return {
    createOpen,
    createName,
    setCreateName,
    createProvider,
    setCreateProvider,
    createSubmitting,
    createError,
    handleCreateDialogOpenChange,
    handleCreateProject,
  };
}
