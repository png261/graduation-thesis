import { getGitHubLoginUrl } from "../../../api/projects/index";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import type { ProjectConfigState } from "../useProjectConfigState";

export function GitHubSection({ state }: { state: ProjectConfigState }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">GitHub</CardTitle>
        <CardDescription>Connect a repository and manage pull requests.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.githubSession.authenticated && (
          <div className="flex items-center justify-between text-xs text-[var(--da-muted)]">
            <span>
              Signed in as <strong className="text-[var(--da-text)]">{state.githubSession.login}</strong>
            </span>
            <Button variant="ghost" size="sm" onClick={state.handleLogoutGitHub} disabled={state.githubBusy}>
              Logout
            </Button>
          </div>
        )}

        {!state.githubSession.authenticated ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              window.location.href = getGitHubLoginUrl();
            }}
          >
            Login with GitHub
          </Button>
        ) : !state.githubStatus?.connected ? (
          <>
            <div className="space-y-2">
              <Label>Repository</Label>
              <Select
                value={state.selectedRepo || "__none__"}
                onValueChange={(value) => {
                  const next = value === "__none__" ? "" : value;
                  state.setSelectedRepo(next);
                  const defaultBranch =
                    state.githubRepos.find((repo) => repo.full_name === next)?.default_branch || "";
                  state.setSelectedBaseBranch(defaultBranch);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select repository" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select repository...</SelectItem>
                  {state.githubRepos.map((repo) => (
                    <SelectItem key={repo.id} value={repo.full_name}>
                      {repo.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Base branch</Label>
              <Input
                value={state.selectedBaseBranch}
                onChange={(e) => state.setSelectedBaseBranch(e.target.value)}
                placeholder={state.selectedRepoDefaultBranch || "main"}
              />
            </div>

            <Button className="w-full" onClick={state.handleConnectGitHub} disabled={state.githubBusy || !state.selectedRepo}>
              {state.githubBusy ? "Connecting..." : "Connect Repository"}
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-1 rounded-md border border-[var(--da-border)] bg-[var(--da-elevated)] p-3 text-xs text-[var(--da-muted)]">
              <p>
                Repo: <code className="text-[var(--da-text)]">{state.githubStatus.repo_full_name}</code>
              </p>
              <p>
                Base: <code className="text-[var(--da-text)]">{state.githubStatus.base_branch}</code>
              </p>
              <p>
                Working: <code className="text-[var(--da-text)]">{state.githubStatus.working_branch}</code>
              </p>
            </div>

            <Button className="w-full" onClick={() => state.setPullRequestModalOpen(true)}>
              Create Pull Request
            </Button>
            <Button variant="outline" className="w-full" onClick={state.handleDisconnectGitHub} disabled={state.githubBusy}>
              {state.githubBusy ? "Disconnecting..." : "Disconnect Repository"}
            </Button>
          </>
        )}

        {state.lastPullRequestUrl && (
          <Alert className="border-green-500/40 bg-green-500/10 text-green-100">
            <AlertTitle>Pull request created</AlertTitle>
            <AlertDescription>
              <a href={state.lastPullRequestUrl} target="_blank" rel="noreferrer" className="underline">
                {state.lastPullRequestUrl}
              </a>
            </AlertDescription>
          </Alert>
        )}

        {state.githubError && (
          <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
            <AlertTitle>GitHub error</AlertTitle>
            <AlertDescription>{state.githubError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
