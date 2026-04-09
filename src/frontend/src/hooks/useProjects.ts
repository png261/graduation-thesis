import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { createProject as createProjectApi, deleteProject as deleteProjectApi, listProjects, type CloudProvider, type Project } from "../api/projects";

interface UseProjectsOptions {
  authenticated: boolean;
  userId?: string;
}

function formatLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    const lower = error.message.toLowerCase();
    if (lower.includes("timed out")) return "Loading projects timed out. Please retry.";
    if (lower.includes("cancelled") || lower.includes("aborted")) {
      return "Project request was interrupted. Please retry.";
    }
    if (lower.includes("cannot reach backend api")) return error.message;
    if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
      return "Cannot reach backend API. Start the backend or check VITE_API_URL, then retry.";
    }
    return error.message;
  }
  return "Failed to load projects";
}

function currentProjectKey(userId: string) {
  return `da_current_project:${userId}`;
}

function resolveCurrentProjectId(params: {
  loaded: Project[];
  storageKey: string | null;
  activeCurrentId: string;
}) {
  const stored = params.storageKey ? localStorage.getItem(params.storageKey) : null;
  const storedExists = stored && params.loaded.some((project) => project.id === stored);
  const keepCurrent = !!params.activeCurrentId && params.loaded.some((project) => project.id === params.activeCurrentId);
  return storedExists ? stored! : keepCurrent ? params.activeCurrentId : params.loaded[0].id;
}

async function runProjectsLoad(args: {
  storageKey: string | null;
  activeCurrentId: () => string;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setCurrentProjectIdState: Dispatch<SetStateAction<string>>;
  isInvalid: () => boolean;
}) {
  let loaded = await listProjects();
  if (args.isInvalid()) return;
  if (loaded.length < 1) loaded = [await createProjectApi("My Project", "aws")];
  if (args.isInvalid()) return;
  args.setProjects(loaded);
  const currentId = resolveCurrentProjectId({ loaded, storageKey: args.storageKey, activeCurrentId: args.activeCurrentId() });
  args.setCurrentProjectIdState(currentId);
  if (args.storageKey) localStorage.setItem(args.storageKey, currentId);
}

function useProjectsLoadEffect(args: {
  authenticated: boolean;
  storageKey: string | null;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setCurrentProjectIdState: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setLoadError: Dispatch<SetStateAction<string | null>>;
  currentProjectIdRef: MutableRefObject<string>;
  loadSeqRef: MutableRefObject<number>;
  reloadTick: number;
}) {
  const { authenticated, storageKey, setProjects, setCurrentProjectIdState, setLoading, setLoadError, currentProjectIdRef, loadSeqRef, reloadTick } = args;
  useEffect(() => {
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    const loadSeq = ++loadSeqRef.current;
    const isInvalid = () => cancelled || loadSeq !== loadSeqRef.current;
    if (!authenticated) {
      setLoadError(null);
      return cancel;
    }
    setLoading(true);
    setLoadError(null);
    void runProjectsLoad({ storageKey, activeCurrentId: () => currentProjectIdRef.current, setProjects, setCurrentProjectIdState, isInvalid })
      .catch((error) => {
        if (!isInvalid()) setLoadError(formatLoadError(error));
        console.error("useProjects: failed to load", error);
      })
      .finally(() => {
        if (!isInvalid()) setLoading(false);
      });
    return cancel;
  }, [authenticated, currentProjectIdRef, loadSeqRef, reloadTick, setCurrentProjectIdState, setLoadError, setLoading, setProjects, storageKey]);
}

function useSetCurrentProjectId(storageKey: string | null, setCurrentProjectIdState: Dispatch<SetStateAction<string>>) {
  return useCallback((id: string) => {
    if (storageKey) localStorage.setItem(storageKey, id);
    setCurrentProjectIdState(id);
  }, [setCurrentProjectIdState, storageKey]);
}

function useCreateProjectAction(args: {
  authenticated: boolean;
  loadSeqRef: MutableRefObject<number>;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setCurrentProjectId: (id: string) => void;
}) {
  return useCallback(async (name: string, provider: CloudProvider = "aws") => {
    if (!args.authenticated) throw new Error("Login required");
    args.loadSeqRef.current += 1;
    const project = await createProjectApi(name || "Untitled Project", provider);
    args.setProjects((previous) => [...previous, project]);
    args.setCurrentProjectId(project.id);
    return project;
  }, [args]);
}

function useRenameProjectAction(setProjects: Dispatch<SetStateAction<Project[]>>) {
  return useCallback((id: string, name: string) => {
    setProjects((previous) => previous.map((project) => (project.id === id ? { ...project, name: name.trim() || project.name } : project)));
  }, [setProjects]);
}

function useDeleteProjectAction(args: {
  authenticated: boolean;
  currentProjectId: string;
  storageKey: string | null;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  setCurrentProjectIdState: Dispatch<SetStateAction<string>>;
}) {
  return useCallback(async (id: string) => {
    if (!args.authenticated) throw new Error("Login required");
    await deleteProjectApi(id);
    args.setProjects((previous) => {
      const next = previous.filter((project) => project.id !== id);
      if (next.length < 1) return previous;
      if (args.currentProjectId !== id) return next;
      const nextId = next[0].id;
      if (args.storageKey) localStorage.setItem(args.storageKey, nextId);
      args.setCurrentProjectIdState(nextId);
      return next;
    });
  }, [args]);
}

export function useProjects({ authenticated, userId }: UseProjectsOptions) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const loadSeqRef = useRef(0);
  const currentProjectIdRef = useRef("");
  const storageKey = useMemo(() => (authenticated && userId ? currentProjectKey(userId) : null), [authenticated, userId]);
  useEffect(() => {
    currentProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);
  useProjectsLoadEffect({ authenticated, storageKey, setProjects, setCurrentProjectIdState, setLoading, setLoadError, currentProjectIdRef, loadSeqRef, reloadTick });
  const setCurrentProjectId = useSetCurrentProjectId(storageKey, setCurrentProjectIdState);
  const createProject = useCreateProjectAction({ authenticated, loadSeqRef, setProjects, setCurrentProjectId });
  const renameProject = useRenameProjectAction(setProjects);
  const deleteProject = useDeleteProjectAction({ authenticated, currentProjectId, storageKey, setProjects, setCurrentProjectIdState });
  const reloadProjects = useCallback(() => setReloadTick((value) => value + 1), []);
  const currentProject = projects.find((project) => project.id === currentProjectId) ?? projects[0];
  return { projects, loading, loadError, currentProject, currentProjectId, setCurrentProjectId, createProject, renameProject, deleteProject, reloadProjects };
}
