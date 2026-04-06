import { useCallback, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { openGitHubOAuthPopup } from "../../github/openGitHubOAuthPopup";
import type { ProjectConfigState } from "../useProjectConfigState";

function scheduleGitHubStatusRefresh(refreshGitHubStatus: () => Promise<void>) {
  window.setTimeout(() => void refreshGitHubStatus(), 1200);
  window.setTimeout(() => void refreshGitHubStatus(), 3500);
}

function useConnectGitHub(refreshGitHubStatus: () => Promise<void>, setError: (value: string) => void) {
  return useCallback(async () => {
    setError("");
    try {
      await openGitHubOAuthPopup();
      scheduleGitHubStatusRefresh(refreshGitHubStatus);
      await refreshGitHubStatus();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "GitHub OAuth failed");
    }
  }, [refreshGitHubStatus, setError]);
}

function GitHubSessionInfo({ login }: { login?: string }) {
  if (!login) return null;
  return (
    <div className="flex items-center justify-between text-xs text-[var(--da-muted)]">
      <span>Signed in as <strong className="text-[var(--da-text)]">{login}</strong></span>
    </div>
  );
}

function GitHubAuthPrompt({
  authError,
  onConnect,
}: {
  authError: string;
  onConnect: () => void;
}) {
  return (
    <>
      <Button variant="outline" className="w-full" onClick={onConnect}>Connect GitHub</Button>
      {authError ? <p className="text-xs text-red-400">{authError}</p> : null}
    </>
  );
}

function onRepoSelected(state: ProjectConfigState, value: string) {
  const next = value === "__none__" ? "" : value;
  state.clearPendingRepositoryConfirmation();
  state.setSelectedRepo(next);
  const defaultBranch = state.githubRepos.find((repo) => repo.full_name === next)?.default_branch || "";
  state.setSelectedBaseBranch(defaultBranch);
}

function GitHubRepoSelector({ state }: { state: ProjectConfigState }) {
  return (
    <div className="space-y-2">
      <Label>Repository</Label>
      <Select value={state.selectedRepo || "__none__"} onValueChange={(value) => onRepoSelected(state, value)}>
        <SelectTrigger>
          <SelectValue placeholder="Select repository" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Select repository...</SelectItem>
          {state.githubRepos.map((repo) => <SelectItem key={repo.id} value={repo.full_name}>{repo.full_name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function GitHubBranchInput({ state }: { state: ProjectConfigState }) {
  return (
    <div className="space-y-2">
      <Label>Base branch</Label>
      <Input value={state.selectedBaseBranch} onChange={(event) => {
        state.clearPendingRepositoryConfirmation();
        state.setSelectedBaseBranch(event.target.value);
      }} placeholder={state.selectedRepoDefaultBranch || "main"} />
    </div>
  );
}

function GitHubConnectForm({ state }: { state: ProjectConfigState }) {
  return (
      <>
        <GitHubRepoSelector state={state} />
        <GitHubBranchInput state={state} />
        <GitHubConfirmationNotice state={state} />
        <Button className="w-full" onClick={state.handleConnectGitHub} disabled={state.githubBusy || !state.selectedRepo}>
          {state.githubBusy ? "Connecting..." : state.githubActionLabel}
        </Button>
        {state.pendingRepositoryConfirmation ? <Button variant="outline" className="w-full" onClick={state.handleConfirmGitHubAction} disabled={state.githubBusy}>
          Confirm Replace Workspace
        </Button> : null}
      </>
  );
}

function GitHubConnectedState({ state }: { state: ProjectConfigState }) {
  return (
    <>
      <div className="space-y-1 rounded-md border border-[var(--da-border)] bg-[var(--da-elevated)] p-3 text-xs text-[var(--da-muted)]">
        <p>Repo: <code className="text-[var(--da-text)]">{state.githubStatus?.repo_full_name}</code></p>
        <p>Base: <code className="text-[var(--da-text)]">{state.githubStatus?.base_branch}</code></p>
        <p>Working: <code className="text-[var(--da-text)]">{state.githubStatus?.working_branch}</code></p>
      </div>
      <GitHubConfirmationNotice state={state} />
      <Button className="w-full" onClick={state.handleSyncGitHub} disabled={state.githubBusy}>
        {state.githubBusy ? "Syncing..." : "Sync Repository Baseline"}
      </Button>
      {state.pendingRepositoryConfirmation ? <Button variant="outline" className="w-full" onClick={state.handleConfirmGitHubAction} disabled={state.githubBusy}>
        Confirm Replace Workspace
      </Button> : null}
      <Button className="w-full" onClick={() => state.setPullRequestModalOpen(true)}>Create Pull Request</Button>
      <Button variant="outline" className="w-full" onClick={state.handleDisconnectGitHub} disabled={state.githubBusy}>
        {state.githubBusy ? "Disconnecting..." : "Disconnect Repository"}
      </Button>
    </>
  );
}

function GitHubConfirmationNotice({ state }: { state: ProjectConfigState }) {
  if (!state.pendingRepositoryConfirmation) return null;
  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
      <AlertTitle>Replace workspace files?</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{state.pendingRepositoryConfirmation.confirmationMessage}</p>
        <p>Only AGENTS.md, .agents/skills/, .claude/skills/, .opentofu-runtime/, and .git are preserved automatically.</p>
      </AlertDescription>
    </Alert>
  );
}

function GitHubSectionContent({
  state,
  authError,
  onConnect,
}: {
  state: ProjectConfigState;
  authError: string;
  onConnect: () => void;
}) {
  if (!state.githubSession.authenticated) return <GitHubAuthPrompt authError={authError} onConnect={onConnect} />;
  if (!state.githubStatus?.connected) return <GitHubConnectForm state={state} />;
  return <GitHubConnectedState state={state} />;
}

function GitHubResultAlerts({ state }: { state: ProjectConfigState }) {
  return (
    <>
      {state.lastPullRequestUrl ? <Alert className="border-green-500/40 bg-green-500/10 text-green-100">
        <AlertTitle>Pull request created</AlertTitle>
        <AlertDescription>
          <a href={state.lastPullRequestUrl} target="_blank" rel="noreferrer" className="underline">{state.lastPullRequestUrl}</a>
        </AlertDescription>
      </Alert> : null}
      {state.githubError ? <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
        <AlertTitle>GitHub error</AlertTitle>
        <AlertDescription>{state.githubError}</AlertDescription>
      </Alert> : null}
    </>
  );
}

export function GitHubSection({ state }: { state: ProjectConfigState }) {
  const [authError, setAuthError] = useState("");
  const handleConnect = useConnectGitHub(state.refreshGitHubStatus, setAuthError);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">GitHub</CardTitle>
        <CardDescription>Connect a repository, sync the workspace baseline, and manage pull requests.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <GitHubSessionInfo login={state.githubSession.login} />
        <GitHubSectionContent state={state} authError={authError} onConnect={handleConnect} />
        <GitHubResultAlerts state={state} />
      </CardContent>
    </Card>
  );
}
