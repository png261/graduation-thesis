import { useState } from "react";

import { type CloudProvider } from "../../api/projects";

interface CreatedProject {
  id: string;
  name: string;
}

interface CreateDialogParams {
  createProject: (name: string, provider: CloudProvider) => Promise<CreatedProject>;
}

function useCreateDialogState() {
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createProvider, setCreateProvider] = useState<CloudProvider>("aws");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  return { createOpen, setCreateOpen, createName, setCreateName, createProvider, setCreateProvider, createSubmitting, setCreateSubmitting, createError, setCreateError };
}

function buildCreateDialogResult(
  state: ReturnType<typeof useCreateDialogState>,
  handleCreateDialogOpenChange: (open: boolean) => void,
  handleCreateProject: () => Promise<void>,
) {
  return {
    createOpen: state.createOpen,
    createName: state.createName,
    setCreateName: state.setCreateName,
    createProvider: state.createProvider,
    setCreateProvider: state.setCreateProvider,
    createSubmitting: state.createSubmitting,
    createError: state.createError,
    handleCreateDialogOpenChange,
    handleCreateProject,
  };
}

export function useProjectCreateDialog({ createProject }: CreateDialogParams) {
  const state = useCreateDialogState();

  const resetCreateDialog = () => {
    state.setCreateName("");
    state.setCreateProvider("aws");
    state.setCreateSubmitting(false);
    state.setCreateError("");
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    state.setCreateOpen(open);
    if (!open) resetCreateDialog();
  };

  const handleCreateProject = async () => {
    state.setCreateSubmitting(true);
    state.setCreateError("");
    try {
      await createProject(state.createName.trim() || "Untitled Project", state.createProvider);
      state.setCreateOpen(false);
      resetCreateDialog();
    } catch (e: unknown) {
      state.setCreateError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      state.setCreateSubmitting(false);
    }
  };

  return buildCreateDialogResult(state, handleCreateDialogOpenChange, handleCreateProject);
}
