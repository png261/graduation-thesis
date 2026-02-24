"use client";

import { CheckIcon, FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FileChange } from "@/lib/git-api";

export function ChatChangesSummary({
    changes,
    onAcceptAll,
    isAccepting,
}: {
    changes: FileChange[];
    onAcceptAll: () => void;
    isAccepting: boolean;
}) {
    if (!changes || changes.length === 0) return null;

    const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
    const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);

    return (
        <div className="w-full mt-4 flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b">
                <h4 className="font-semibold text-sm">Suggested Changes</h4>
                <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">
                        {changes.length} file{changes.length > 1 ? "s" : ""}
                    </span>
                    <span className="text-green-500 font-medium">+{totalAdditions}</span>
                    <span className="text-red-500 font-medium">-{totalDeletions}</span>
                </div>
            </div>

            <div className="flex flex-col gap-1 max-h-[150px] overflow-y-auto">
                {changes.map((change) => (
                    <div key={change.filePath} className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50">
                        <div className="flex items-center gap-2 overflow-hidden">
                            <FileIcon size={14} className="text-muted-foreground shrink-0" />
                            <span className="text-xs font-mono truncate">{change.filePath}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-xs font-mono">
                            <span className="text-green-500">+{change.additions}</span>
                            <span className="text-red-500">-{change.deletions}</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className="pt-3 border-t flex justify-end">
                <Button
                    size="sm"
                    className="w-full sm:w-auto h-8 text-xs bg-green-600 hover:bg-green-700 text-white"
                    onClick={onAcceptAll}
                    disabled={isAccepting}
                >
                    <CheckIcon size={14} className="mr-1.5" />
                    {isAccepting ? "Accepting..." : "Accept All Changes"}
                </Button>
            </div>
        </div>
    );
}
