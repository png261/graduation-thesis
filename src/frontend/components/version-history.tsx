"use client";

import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { HistoryIcon, GitCommitIcon, ChevronRightIcon, RotateCcwIcon, LoaderIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gitGetHistory, gitCheckout, type GitCommit } from "@/lib/git-api";

export function VersionHistory({
    chatId,
    onRestore,
}: {
    chatId: string | undefined;
    onRestore: () => void;
}) {
    const [commits, setCommits] = useState<GitCommit[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isRestoring, setIsRestoring] = useState(false);

    useEffect(() => {
        if (chatId) {
            loadHistory();
        }
    }, [chatId]);

    const loadHistory = async () => {
        if (!chatId) return;
        setIsLoading(true);
        try {
            const res = await gitGetHistory(chatId);
            if (res.status === "success") {
                setCommits(res.commits);
            }
        } catch (e) {
            console.error("Failed to load history", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRestore = async (hash: string) => {
        if (!chatId) return;
        setIsRestoring(true);
        try {
            await gitCheckout(chatId, hash);
            onRestore();
            await loadHistory();
        } catch (e) {
            console.error("Failed to restore", e);
        } finally {
            setIsRestoring(false);
        }
    };

    if (!chatId) return null;

    return (
        <div className="flex flex-col h-full border-l bg-background w-[300px] shrink-0">
            <div className="flex items-center gap-2 p-3 border-b">
                <HistoryIcon size={16} className="text-muted-foreground" />
                <h3 className="font-medium text-sm">Version History</h3>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {isLoading ? (
                    <div className="flex justify-center p-4">
                        <LoaderIcon size={16} className="animate-spin text-muted-foreground" />
                    </div>
                ) : commits.length === 0 ? (
                    <div className="text-center p-4 text-xs text-muted-foreground">
                        No history yet
                    </div>
                ) : (
                    <div className="flex flex-col relative before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-border p-1">
                        {commits.map((commit, i) => (
                            <div key={commit.hash} className="relative flex gap-3 pb-6 last:pb-0 group">
                                <div className="relative mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border bg-background z-10">
                                    <div className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-primary' : 'bg-muted-foreground'}`} />
                                </div>

                                <div className="flex flex-col flex-1 gap-1 -mt-0.5">
                                    <div className="flex items-center justify-between">
                                        <span className="font-mono text-xs font-semibold">{commit.hash}</span>
                                        <span className="text-[10px] text-muted-foreground">
                                            {formatDistanceToNow(new Date(commit.date), { addSuffix: true })}
                                        </span>
                                    </div>
                                    <p className="text-xs text-foreground/80 line-clamp-2">
                                        {commit.message}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                                        {commit.fileCount} file{commit.fileCount !== 1 ? 's' : ''} changed
                                    </p>
                                </div>

                                {i !== 0 && (
                                    <div className="opacity-0 group-hover:opacity-100 absolute right-0 top-1 transition-opacity">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-6 text-[10px] px-2 h-7"
                                            onClick={() => handleRestore(commit.hash)}
                                            disabled={isRestoring}
                                        >
                                            <RotateCcwIcon size={10} className="mr-1.5" />
                                            Restore
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
