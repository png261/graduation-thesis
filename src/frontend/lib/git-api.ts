// Git version control API client
// Talks to the Python backend's git endpoints

export type FileChange = {
    filePath: string;
    diff: string;
    additions: number;
    deletions: number;
    oldContent: string | null;
    newContent: string | null;
};

export type GitCommit = {
    hash: string;
    fullHash: string;
    message: string;
    date: string;
    files: string[];
    fileCount: number;
};

export type GitDiffResponse = {
    status: string;
    changes: FileChange[];
    hasPending: boolean;
};

// Initialize git repo for a project
export async function gitInit(chatId: string): Promise<{ status: string; head?: string }> {
    const res = await fetch(`/api/project/${chatId}/git/init`, {
        method: "POST",
    });
    return res.json();
}

// Create pending branch with agent changes
export async function gitCreatePending(
    chatId: string,
    files: Record<string, string>,
    message = "Agent changes"
): Promise<{ status: string }> {
    const res = await fetch(`/api/project/${chatId}/git/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, message }),
    });
    return res.json();
}

// Get diff between main and pending
export async function gitGetDiff(chatId: string): Promise<GitDiffResponse> {
    const res = await fetch(`/api/project/${chatId}/git/diff`);
    return res.json();
}

// Accept changes (all or specific files)
export async function gitAccept(
    chatId: string,
    files?: string[]
): Promise<{ status: string }> {
    const res = await fetch(`/api/project/${chatId}/git/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: files ?? null }),
    });
    return res.json();
}

// Reject all pending changes
export async function gitReject(chatId: string): Promise<{ status: string }> {
    const res = await fetch(`/api/project/${chatId}/git/reject`, {
        method: "POST",
    });
    return res.json();
}

// Get commit history
export async function gitGetHistory(
    chatId: string
): Promise<{ status: string; commits: GitCommit[] }> {
    const res = await fetch(`/api/project/${chatId}/git/history`);
    return res.json();
}

// Checkout a specific commit
export async function gitCheckout(
    chatId: string,
    commitHash: string
): Promise<{ status: string; files: Record<string, string> }> {
    const res = await fetch(`/api/project/${chatId}/git/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit_hash: commitHash }),
    });
    return res.json();
}
