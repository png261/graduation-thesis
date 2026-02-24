"use client";

import { CheckIcon, XIcon, FileIcon, LoaderIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FileChange } from "@/lib/git-api";

export function PendingChangesBar({
    changes,
    onAcceptFile,
    onAcceptAll,
    onRejectAll,
    onSelectFile,
    activeFile,
    acceptingFiles,
}: {
    changes: FileChange[];
    onAcceptFile: (filePath: string) => void;
    onAcceptAll: () => void;
    onRejectAll: () => void;
    onSelectFile: (filePath: string) => void;
    activeFile?: string;
    acceptingFiles: Set<string>;
}) {
    if (changes.length === 0) return null;

    const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
    const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);

    return (
        <div className="border-t bg-muted/30">
            {/* File list */}
            <div className="max-h-[200px] overflow-y-auto">
                {changes.map((change) => (
                    <div
                        key={change.filePath}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors ${activeFile === change.filePath ? "bg-accent/20" : ""
                            }`}
                        onClick={() => onSelectFile(change.filePath)}
                    >
                        <FileIcon size={14} className="text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate font-mono text-xs">
                            {change.filePath}
                        </span>
                        <span className="text-green-500 text-xs font-mono">
                            +{change.additions}
                        </span>
                        <span className="text-red-500 text-xs font-mono">
                            -{change.deletions}
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={(e) => {
                                e.stopPropagation();
                                onAcceptFile(change.filePath);
                            }}
                            disabled={acceptingFiles.has(change.filePath)}
                        >
                            {acceptingFiles.has(change.filePath) ? (
                                <LoaderIcon size={12} className="animate-spin" />
                            ) : (
                                <CheckIcon size={12} className="text-green-500" />
                            )}
                        </Button>
                    </div>
                ))}
            </div>

            {/* Bottom actions bar */}
            <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                    <span>{changes.length} file{changes.length > 1 ? "s" : ""} changed</span>
                    <span className="text-green-500">+{totalAdditions}</span>
                    <span className="text-red-500">-{totalDeletions}</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-red-500 hover:text-red-600"
                        onClick={onRejectAll}
                    >
                        <XIcon size={12} className="mr-1" />
                        Reject All
                    </Button>
                    <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={onAcceptAll}
                    >
                        <CheckIcon size={12} className="mr-1" />
                        Accept All
                    </Button>
                </div>
            </div>
        </div>
    );
}
