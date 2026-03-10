import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  createProject as createProjectApi,
  deleteProject as deleteProjectApi,
  listProjects,
  type CloudProvider,
  type Project,
} from "../api/projects";

interface UseProjectsOptions {
  authenticated: boolean;
  userId?: string;
}

function currentProjectKey(userId: string) {
  return `da_current_project:${userId}`;
}

function makeGuestProject(name: string, id?: string): Project {
  return {
    id: id ?? `guest-${crypto.randomUUID()}`,
    name,
    provider: "aws",
    createdAt: new Date().toISOString(),
  };
}

export function useProjects({ authenticated, userId }: UseProjectsOptions) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectIdState] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const loadSeqRef = useRef(0);
  const currentProjectIdRef = useRef("");

  const storageKey = useMemo(
    () => (authenticated && userId ? currentProjectKey(userId) : null),
    [authenticated, userId],
  );

  useEffect(() => {
    currentProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  useEffect(() => {
    let cancelled = false;
    const loadSeq = ++loadSeqRef.current;

    if (!authenticated) {
      const guestProject = makeGuestProject("Guest Session", "guest-session");
      setProjects([guestProject]);
      setCurrentProjectIdState(guestProject.id);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    (async () => {
      try {
        let loaded = await listProjects();
        if (cancelled || loadSeq !== loadSeqRef.current) return;

        if (loaded.length === 0) {
          const def = await createProjectApi("My Project", "aws");
          loaded = [def];
        }

        if (cancelled || loadSeq !== loadSeqRef.current) return;

        setProjects(loaded);

        const stored = storageKey ? localStorage.getItem(storageKey) : null;
        const exists = stored && loaded.some((p) => p.id === stored);
        const activeCurrentId = currentProjectIdRef.current;
        const keepCurrent =
          !!activeCurrentId && loaded.some((project) => project.id === activeCurrentId);
        const currentId = exists ? stored! : keepCurrent ? activeCurrentId : loaded[0].id;
        setCurrentProjectIdState(currentId);
        if (storageKey) localStorage.setItem(storageKey, currentId);
      } catch (err) {
        console.error("useProjects: failed to load", err);
      } finally {
        if (!cancelled && loadSeq === loadSeqRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, userId, storageKey]);

  const setCurrentProjectId = useCallback(
    (id: string) => {
      if (storageKey) localStorage.setItem(storageKey, id);
      setCurrentProjectIdState(id);
    },
    [storageKey],
  );

  const createProject = useCallback(
    async (name: string, provider: CloudProvider = "aws"): Promise<Project> => {
      if (!authenticated) {
        const project = makeGuestProject(name || "Guest Project");
        setProjects((prev) => [...prev, project]);
        setCurrentProjectIdState(project.id);
        return project;
      }

      // Invalidate in-flight initial loads so they cannot overwrite this explicit selection.
      loadSeqRef.current += 1;
      const project = await createProjectApi(name || "Untitled Project", provider);
      setProjects((prev) => [...prev, project]);
      setCurrentProjectId(project.id);
      return project;
    },
    [authenticated, setCurrentProjectId],
  );

  const renameProject = useCallback((id: string, name: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)),
    );
  }, []);

  const deleteProject = useCallback(
    async (id: string) => {
      if (authenticated) {
        await deleteProjectApi(id);
      }
      setProjects((prev) => {
        const next = prev.filter((p) => p.id !== id);
        if (next.length === 0) return prev;
        if (currentProjectId === id) {
          const nextId = next[0].id;
          if (storageKey) localStorage.setItem(storageKey, nextId);
          setCurrentProjectIdState(nextId);
        }
        return next;
      });
    },
    [authenticated, currentProjectId, storageKey],
  );

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? projects[0];

  return {
    projects,
    loading,
    currentProject,
    currentProjectId,
    setCurrentProjectId,
    createProject,
    renameProject,
    deleteProject,
  };
}
