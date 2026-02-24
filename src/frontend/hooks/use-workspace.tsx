"use client";

import {
    createContext,
    useContext,
    useState,
    useEffect,
    ReactNode,
    useCallback,
} from "react";
import { type Workspace } from "@/lib/db/schema";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";

interface WorkspaceContextType {
    currentWorkspaceId: string | undefined;
    setCurrentWorkspaceId: (id: string | undefined) => void;
    workspaces: Workspace[];
    isLoading: boolean;
    mutate: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
    undefined
);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const [currentWorkspaceId, setCurrentWorkspaceId] = useState<
        string | undefined
    >(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("currentWorkspaceId") || undefined;
        }
        return undefined;
    });

    const {
        data: workspaces = [],
        isLoading,
        mutate,
    } = useSWR<Workspace[]>("/api/workspaces", fetcher);

    const handleSetCurrentWorkspaceId = useCallback((id: string | undefined) => {
        setCurrentWorkspaceId(id);
        if (id) {
            localStorage.setItem("currentWorkspaceId", id);
        } else {
            localStorage.removeItem("currentWorkspaceId");
        }
    }, []);

    // Default to first workspace if none selected and workspaces available
    useEffect(() => {
        if (
            !currentWorkspaceId &&
            workspaces.length > 0 &&
            !isLoading
        ) {
            handleSetCurrentWorkspaceId(workspaces[0].id);
        }
    }, [workspaces, currentWorkspaceId, isLoading, handleSetCurrentWorkspaceId]);

    return (
        <WorkspaceContext.Provider
            value={{
                currentWorkspaceId,
                setCurrentWorkspaceId: handleSetCurrentWorkspaceId,
                workspaces,
                isLoading,
                mutate,
            }}
        >
            {children}
        </WorkspaceContext.Provider>
    );
}

export function useWorkspace() {
    const context = useContext(WorkspaceContext);
    if (context === undefined) {
        throw new Error("useWorkspace must be used within a WorkspaceProvider");
    }
    return context;
}
