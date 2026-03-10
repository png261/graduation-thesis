import { useState } from "react";

export function useDeleteProjectState(onDeleteProject: () => Promise<void>) {
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handleDeleteProject = async () => {
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await onDeleteProject();
    } catch (error: unknown) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete project");
    } finally {
      setDeleteBusy(false);
    }
  };

  return {
    deleteBusy,
    deleteError,
    handleDeleteProject,
  };
}
