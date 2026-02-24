"use client";

import { useWorkspace } from "@/hooks/use-workspace";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./ui/select";
import { PlusIcon } from "./icons";
import { Button } from "./ui/button";
import { useState } from "react";
import { toast } from "sonner";

export function WorkspaceSelector() {
    const { workspaces, currentWorkspaceId, setCurrentWorkspaceId, mutate } =
        useWorkspace();
    const [isCreating, setIsCreating] = useState(false);
    const [newWorkspaceName, setNewWorkspaceName] = useState("");

    const handleCreateWorkspace = async () => {
        if (!newWorkspaceName.trim()) return;

        try {
            const response = await fetch("/api/workspaces", {
                method: "POST",
                body: JSON.stringify({ name: newWorkspaceName }),
                headers: { "Content-Type": "application/json" },
            });

            if (response.ok) {
                const newWorkspace = await response.json();
                mutate();
                setCurrentWorkspaceId(newWorkspace.id);
                setNewWorkspaceName("");
                setIsCreating(false);
                toast.success("Workspace created");
            } else {
                toast.error("Failed to create workspace");
            }
        } catch (error) {
            toast.error("Error creating workspace");
        }
    };

    return (
        <div className="flex flex-col gap-2 pt-2 px-2 pb-4 border-b">
            <div className="flex items-center gap-2">
                <Select
                    value={currentWorkspaceId}
                    onValueChange={(value) => setCurrentWorkspaceId(value)}
                >
                    <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select workspace" />
                    </SelectTrigger>
                    <SelectContent>
                        {workspaces.map((ws) => (
                            <SelectItem key={ws.id} value={ws.id}>
                                {ws.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 h-9 w-9"
                    onClick={() => setIsCreating(!isCreating)}
                >
                    <PlusIcon size={16} />
                </Button>
            </div>

            {isCreating && (
                <div className="flex items-center gap-2 animate-in slide-in-from-top-1 duration-200">
                    <input
                        className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        placeholder="Name..."
                        value={newWorkspaceName}
                        onChange={(e) => setNewWorkspaceName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleCreateWorkspace();
                        }}
                        autoFocus
                    />
                    <Button size="sm" className="h-8" onClick={handleCreateWorkspace}>
                        Add
                    </Button>
                </div>
            )}
        </div>
    );
}
