import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";

interface RepoOption {
  id: number;
  full_name: string;
  default_branch: string;
}

interface ImportRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  busy: boolean;
  error: string;
  connected: boolean;
  actionLabel: string;
  pendingConfirmationMessage: string;
  session: { authenticated: boolean; login?: string };
  repos: RepoOption[];
  repoName: string;
  onRepoNameChange: (value: string) => void;
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
  onLogin: () => void;
  onSubmit: () => void;
}

function resolveDefaultBranch(repos: RepoOption[], repoName: string) {
  return repos.find((repo) => repo.full_name === repoName)?.default_branch || "main";
}

function handleRepoSelection(
  value: string,
  repos: RepoOption[],
  onRepoNameChange: (value: string) => void,
  onBaseBranchChange: (value: string) => void,
) {
  const next = value === "__none__" ? "" : value;
  onRepoNameChange(next);
  const selected = repos.find((repo) => repo.full_name === next);
  onBaseBranchChange(selected?.default_branch || "");
}

function ImportRepoLoadingState({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return <p className="text-sm text-[var(--da-muted)]">Loading GitHub state...</p>;
}

function ImportRepoAuthPrompt({ onLogin }: { onLogin: () => void }) {
  return <Button type="button" variant="outline" className="w-full" onClick={onLogin}>Connect GitHub</Button>;
}

function ImportRepoForm({
  connected,
  session,
  repos,
  repoName,
  baseBranch,
  onRepoNameChange,
  onBaseBranchChange,
}: {
  connected: boolean;
  session: { authenticated: boolean; login?: string };
  repos: RepoOption[];
  repoName: string;
  baseBranch: string;
  onRepoNameChange: (value: string) => void;
  onBaseBranchChange: (value: string) => void;
}) {
  return (
    <>
      <ImportRepoSessionLabel login={session.login} />
      <ImportRepoModeSummary connected={connected} />
      <ImportRepoSelector connected={connected} repos={repos} repoName={repoName} onRepoNameChange={onRepoNameChange} onBaseBranchChange={onBaseBranchChange} />
      <ImportRepoBaseBranchInput connected={connected} repos={repos} repoName={repoName} baseBranch={baseBranch} onBaseBranchChange={onBaseBranchChange} />
    </>
  );
}

function ImportRepoModeSummary({ connected }: { connected: boolean }) {
  if (!connected) return null;
  return <p className="text-xs text-[var(--da-muted)]">The connected repository will be synced back into the workspace baseline.</p>;
}

function ImportRepoSessionLabel({ login }: { login?: string }) {
  return <p className="text-xs text-[var(--da-muted)]">Signed in as <strong className="text-[var(--da-text)]">{login}</strong></p>;
}

function ImportRepoSelector({
  connected,
  repos,
  repoName,
  onRepoNameChange,
  onBaseBranchChange,
}: {
  connected: boolean;
  repos: RepoOption[];
  repoName: string;
  onRepoNameChange: (value: string) => void;
  onBaseBranchChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Repository</Label>
      <Select value={repoName || "__none__"} onValueChange={(value) => handleRepoSelection(value, repos, onRepoNameChange, onBaseBranchChange)} disabled={connected}>
        <SelectTrigger>
          <SelectValue placeholder="Select repository" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Select repository...</SelectItem>
          {repos.map((repo) => <SelectItem key={repo.id} value={repo.full_name}>{repo.full_name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ImportRepoBaseBranchInput({
  connected,
  repos,
  repoName,
  baseBranch,
  onBaseBranchChange,
}: {
  connected: boolean;
  repos: RepoOption[];
  repoName: string;
  baseBranch: string;
  onBaseBranchChange: (value: string) => void;
}) {
  const defaultBranch = resolveDefaultBranch(repos, repoName);
  return (
    <div className="space-y-2">
      <Label>Base branch</Label>
      <Input value={baseBranch} onChange={(event) => onBaseBranchChange(event.target.value)} placeholder={defaultBranch} disabled={connected} />
    </div>
  );
}

function ImportRepoDialogBody(props: ImportRepoDialogProps) {
  return (
    <div className="space-y-3">
      <ImportRepoLoadingState loading={props.loading} />
      {!props.loading && !props.session.authenticated ? <ImportRepoAuthPrompt onLogin={props.onLogin} /> : null}
      {!props.loading && props.session.authenticated ? <ImportRepoForm connected={props.connected} session={props.session} repos={props.repos} repoName={props.repoName} baseBranch={props.baseBranch} onRepoNameChange={props.onRepoNameChange} onBaseBranchChange={props.onBaseBranchChange} /> : null}
      {props.pendingConfirmationMessage ? <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-100">
        <AlertTitle>Replace workspace files?</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{props.pendingConfirmationMessage}</p>
          <p>Only AGENTS.md, .agents/skills/, .claude/skills/, .opentofu-runtime/, and .git are preserved automatically.</p>
        </AlertDescription>
      </Alert> : null}
      {props.error ? <Alert className="border-red-500/40 bg-red-500/10 text-red-100">
        <AlertTitle>Import failed</AlertTitle>
        <AlertDescription>{props.error}</AlertDescription>
      </Alert> : null}
    </div>
  );
}

function ImportRepoDialogFooter({
  busy,
  loading,
  authenticated,
  repoName,
  actionLabel,
  onOpenChange,
  onSubmit,
}: {
  busy: boolean;
  loading: boolean;
  authenticated: boolean;
  repoName: string;
  actionLabel: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
      <Button onClick={onSubmit} disabled={busy || loading || !authenticated || !repoName}>{busy ? `${actionLabel}...` : actionLabel}</Button>
    </DialogFooter>
  );
}

export function ImportRepoDialog(props: ImportRepoDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from GitHub</DialogTitle>
          <DialogDescription>Connect this project to a repository and make it the workspace baseline before later generation work.</DialogDescription>
        </DialogHeader>
        <ImportRepoDialogBody {...props} />
        <ImportRepoDialogFooter busy={props.busy} loading={props.loading} authenticated={props.session.authenticated} repoName={props.repoName} actionLabel={props.actionLabel} onOpenChange={props.onOpenChange} onSubmit={props.onSubmit} />
      </DialogContent>
    </Dialog>
  );
}
