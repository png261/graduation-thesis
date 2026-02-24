"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import {
    gitGetDiff,
    gitAccept,
    gitReject,
    type FileChange,
    type GitDiffResponse,
} from "@/lib/git-api";

const fetcher = (chatId: string) => gitGetDiff(chatId);

export function usePendingChanges(chatId: string | undefined) {
    const {
        data,
        error,
        isLoading,
        mutate,
    } = useSWR<GitDiffResponse>(
        chatId ? `git-diff-${chatId}` : null,
        () => (chatId ? fetcher(chatId) : Promise.resolve({ status: "success", changes: [], hasPending: false })),
        { refreshInterval: 0 } // Manual refresh only
    );

    const changes = data?.changes ?? [];
    const hasPending = data?.hasPending ?? false;

    const [acceptingFiles, setAcceptingFiles] = useState<Set<string>>(new Set());

    const acceptFile = useCallback(
        async (filePath: string) => {
            if (!chatId) return;
            setAcceptingFiles((prev) => new Set(prev).add(filePath));
            try {
                await gitAccept(chatId, [filePath]);
                await mutate();
            } finally {
                setAcceptingFiles((prev) => {
                    const next = new Set(prev);
                    next.delete(filePath);
                    return next;
                });
            }
        },
        [chatId, mutate]
    );

    const acceptAll = useCallback(async () => {
        if (!chatId) return;
        await gitAccept(chatId);
        await mutate();
    }, [chatId, mutate]);

    const rejectAll = useCallback(async () => {
        if (!chatId) return;
        await gitReject(chatId);
        await mutate();
    }, [chatId, mutate]);

    const refresh = useCallback(() => {
        mutate();
    }, [mutate]);

    return {
        changes,
        hasPending,
        isLoading,
        error,
        acceptFile,
        acceptAll,
        rejectAll,
        refresh,
        acceptingFiles,
    };
}
